/**
 * LibreTranslate client (no Google/Cloud deps).
 * Uses global fetch (Node 18+) or falls back to node-fetch.
 * Supports:
 *  - LIBRETRANSLATE_URL (defaults to http://127.0.0.1:5000/translate for local instance)
 *  - LIBRETRANSLATE_API_KEY (optional) — added to request body as "api_key"
 */

import { logger } from '../utils/logger';
import { normalizeNFC, protectTokens, restoreTokens } from './tokenizer';
import * as fs from 'fs';
import * as path from 'path';

// @ts-expect-error - langdetect has no TypeScript definitions
import * as langdetect from 'langdetect';

// Clean ASS subtitle formatting codes from translation responses
function cleanSubtitleCodes(text: string): string {
  // Remove ASS subtitle formatting codes like \FN黑体\FS22\BORD1\SHAD0\ etc.
  // These codes start with backslash followed by letters/numbers and end with space or end of string
  return text.replace(/\\[A-Za-z0-9]+(?:[^\s\\]|$)/g, '').trim();
}

// Default to local instance using 127.0.0.1 (avoids IPv6 issues)
const LIBRE_URL = process.env.LIBRETRANSLATE_URL || 'http://127.0.0.1:5000/translate';
const LIBRE_API_KEY = process.env.LIBRETRANSLATE_API_KEY || process.env.LIBRETRANSLATE_KEY || '';

async function fetchWithTimeout(input: RequestInfo, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(input, { ...init, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

// Split text by tokens and translate only non-token segments
async function translateWithTokenProtection(text: string, targetLanguage: string, sourceLanguage?: string): Promise<string> {
  // Split text by tokens, preserving both text and tokens
  const segments = text.split(/(__XTOK_[A-Z]+_\d+_[A-Za-z0-9+/=]+__|__XNL__)/g);
  
  // Translate only the text segments (odd indices after split)
  const translatedSegments = await Promise.all(
    segments.map(async (segment, index) => {
      // Even indices are text segments, odd indices are tokens
      if (index % 2 === 0 && segment.trim()) {
        // This is a text segment - translate it, preserving leading/trailing whitespace
        const leadingWhitespace = segment.match(/^\s*/)?.[0] || '';
        const trailingWhitespace = segment.match(/\s*$/)?.[0] || '';
        const trimmedSegment = segment.trim();
        if (trimmedSegment) {
          const translated = await doTranslateOnce(trimmedSegment, targetLanguage, 30000, sourceLanguage);
          return leadingWhitespace + translated + trailingWhitespace;
        }
        return segment;
      }
      // This is a token or empty segment - return as-is
      return segment;
    })
  );
  
  return translatedSegments.join('');
}
function splitProtectedIntoChunks(protectedText: string, maxLen = 10000): string[] {
  if (protectedText.length <= maxLen) return [protectedText];
  // Split by length only, not by sentences, to avoid cutting off at punctuation
  const chunks: string[] = [];
  for (let i = 0; i < protectedText.length; i += maxLen) {
    chunks.push(protectedText.substring(i, i + maxLen));
  }
  return chunks;
}

// LibreTranslate supported language codes (ISO 639-1)
const LIBRE_SUPPORTED = [
  'en', 'ar', 'az', 'zh', 'cs', 'de', 'es', 'fr', 'hi', 'it', 'ja', 'ko', 'pl', 'pt', 'ru', 'tr', 'uk', 'vi', 'nl', 'el', 'he', 'id', 'fa', 'sv', 'fi', 'hu', 'ro', 'sk', 'th', 'bg', 'hr', 'lt', 'sl', 'et', 'sr', 'ms', 'bn', 'ur', 'ta', 'te', 'ml', 'kn', 'gu', 'mr', 'pa', 'sw', 'tl', 'my', 'km', 'lo', 'am', 'zu', 'xh', 'st', 'so', 'yo', 'ig', 'ha', 'eu', 'gl', 'ca', 'is', 'ga', 'mt', 'lb', 'mk', 'sq', 'bs', 'af', 'hy', 'ka', 'be', 'mn', 'ky', 'kk', 'uz', 'tt', 'tk', 'ps', 'sd', 'si', 'ne', 'as', 'or', 'my', 'dz', 'bo', 'ug', 'ku', 'ckb', 'ky', 'kk', 'uz', 'tt', 'tk', 'ps', 'sd', 'si', 'ne', 'as', 'or', 'my', 'dz', 'bo', 'ug', 'ku', 'ckb'
];

async function doTranslateOnce(q: string, targetLanguage: string, timeoutMs: number, sourceLanguage?: string): Promise<string> {
  // Use provided source language, or detect it
  let detectedSource = sourceLanguage || 'auto';
  if (!sourceLanguage) {
    // For English target, always use 'auto' to avoid source language issues
    if (targetLanguage === 'en') {
      detectedSource = 'auto';
    } else {
      try {
        const detections = langdetect.detect(q);
        if (detections && detections.length > 0 && detections[0].prob > 0.5) {
          const detectedCode = detections[0].lang;
          if (detectedCode && detectedCode !== 'und' && LIBRE_SUPPORTED.includes(detectedCode)) {
            detectedSource = detectedCode;
          } else {
            detectedSource = 'auto';
          }
        }
      } catch (e) {
        logger.warn(`langdetect language detection failed: ${e}`);
      }
    }
  }
  let lastError: any = null;
  for (const trySource of [detectedSource, 'auto']) {
    const bodyPayload: Record<string, unknown> = {
      q,
      source: trySource,
      target: targetLanguage,
      format: 'text',
    };
    if (LIBRE_API_KEY) bodyPayload.api_key = LIBRE_API_KEY;

    // Debug log the API request
    fs.appendFileSync(path.join(process.cwd(), 'translation-logs', 'translation-debug.log'), `[DEBUG] LibreTranslate request: source=${trySource}, target=${targetLanguage}, q="${q.substring(0, 100)}..."\n`, 'utf8');

    const res = await fetchWithTimeout(LIBRE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyPayload),
    }, timeoutMs);

    if (!res.ok) {
      const body = await res.text();
      const status = res.status;
      // If not supported, retry with 'auto' (unless already tried)
      if (trySource !== 'auto' && /not supported|not\s+available|unsupported/i.test(body)) {
        logger.warn(`LibreTranslate source language '${trySource}' not supported, retrying with 'auto'`);
        lastError = new Error(`LibreTranslate error ${status}: ${body}`);
        continue;
      }
      throw new Error(`LibreTranslate error ${status}: ${body}`);
    }
    const data = await res.json();
    const rawText = (data?.translatedText as string) || (data?.translated_text as string) || '';
    return cleanSubtitleCodes(rawText);
  }
  if (lastError) throw lastError;
  throw new Error('LibreTranslate failed for all source language attempts');
}

export async function translateText(text: string, targetLanguage: string, sourceLanguage?: string): Promise<string> {
  if (!text) return '';

  // Protect newlines before translation
  text = text.replace(/\n/g, '__XNL__');

  // Normalize and protect tokens before translation
  text = normalizeNFC(text);
  const sanitized = protectTokens(text);

  const MAX_RETRIES = 5;
  const BASE_TIMEOUT_MS = 30000; // 30s per attempt (increased from 15s)
  let lastErr: unknown;
  let triedChunkFallback = false;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // For English target, don't specify source to let LibreTranslate auto-detect
      const effectiveSource = targetLanguage === 'en' ? undefined : sourceLanguage;
      const raw = await translateWithTokenProtection(sanitized, targetLanguage, effectiveSource);
      return restoreTokens(raw).replace(/__XNL__/g, '\n');
    } catch (error: unknown) {
      lastErr = error;
      const errMsg = (error as Error)?.message || '';
      const statusMatch = /LibreTranslate error (\d+)/.exec(errMsg);
      const status = statusMatch ? parseInt(statusMatch[1], 10) : undefined;
      const isAbort = (error as Error)?.name === 'AbortError' || /aborted|timeout/i.test(errMsg);
      const isNetwork = /ECONNRESET|ENOTFOUND|EAI_AGAIN|ECONNREFUSED/i.test(errMsg);
      const retriable = isAbort || isNetwork || [408, 429, 500, 502, 503, 504].includes(status || 0);
      if (attempt < MAX_RETRIES && retriable) {
        // Use much longer backoff for 500 errors (server overload)
        const is500 = status === 500;
        const baseBackoff = is500 ? 10000 : 500;
        const backoff = Math.min(is500 ? 20000 : 5000, baseBackoff * Math.pow(2, attempt - 1));
        const jitter = Math.floor(Math.random() * (is500 ? 2000 : 250));
        const wait = backoff + jitter;
        logger.warn(`Translate retry ${attempt}/${MAX_RETRIES - 1} after ${wait}ms due to: ${errMsg || error}`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      // Fallback: try chunked translation if not yet attempted
      if (!triedChunkFallback) {
        triedChunkFallback = true;
        try {
          const chunks = splitProtectedIntoChunks(sanitized, 220);
          const outPieces: string[] = [];
          for (const ch of chunks) {
            const effectiveSource = targetLanguage === 'en' ? undefined : sourceLanguage;
            const piece = await doTranslateOnce(ch, targetLanguage, BASE_TIMEOUT_MS, effectiveSource);
            outPieces.push(piece);
            await new Promise(r => setTimeout(r, 150));
          }
          const rawJoined = outPieces.join('');
          return restoreTokens(rawJoined).replace(/__XNL__/g, '\n');
        } catch (e: unknown) {
          lastErr = e;
        }
      }
      break;
    }
  }

  const errMsg = (lastErr as Error)?.message || String(lastErr);
  throw new Error(`Translation failed (LibreTranslate at ${LIBRE_URL}): ${errMsg}`);
}