/**
 * LibreTranslate client (no Google/Cloud deps).
 * Uses global fetch (Node 18+) or falls back to node-fetch.
 * Supports:
 *  - LIBRETRANSLATE_URL (defaults to http://127.0.0.1:5000/translate for local instance)
 *  - LIBRETRANSLATE_API_KEY (optional) — added to request body as "api_key"
 */

import { logger } from '../utils/logger';
import { normalizeNFC, protectTokens, restoreTokens } from './tokenizer';
import * as franc from 'franc';

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
async function translateWithTokenProtection(text: string, targetLanguage: string): Promise<string> {
  // Split text by tokens, preserving both text and tokens
  const segments = text.split(/(__XTOK_[A-Z]+_\d+_[A-Za-z0-9+/=]+__)/g);
  
  // Translate only the text segments (odd indices after split)
  const translatedSegments = await Promise.all(
    segments.map(async (segment, index) => {
      // Even indices are text segments, odd indices are tokens
      if (index % 2 === 0 && segment.trim()) {
        // This is a text segment - translate it
        return await doTranslateOnce(segment, targetLanguage, 15000);
      }
      // This is a token or empty segment - return as-is
      return segment;
    })
  );
  
  return translatedSegments.join('');
}
function splitProtectedIntoChunks(protectedText: string, maxLen = 220): string[] {
  if (protectedText.length <= maxLen) return [protectedText];
  // Split into sentence-like segments including trailing punctuation + whitespace
  const sentenceSegments = protectedText.match(/[^.!?]+[.!?]*\s*/g) || [protectedText];
  const primaryChunks: string[] = [];
  let current = '';
  for (const seg of sentenceSegments) {
    if (!current) {
      current = seg;
      continue;
    }
    if ((current + seg).length <= maxLen) {
      current += seg;
    } else {
      primaryChunks.push(current);
      current = seg;
    }
  }
  if (current) primaryChunks.push(current);
  // Second pass: ensure no chunk exceeds maxLen; if it does, word-split that chunk
  const finalChunks: string[] = [];
  for (const chunk of primaryChunks) {
    if (chunk.length <= maxLen) {
      finalChunks.push(chunk);
      continue;
    }
    const parts = chunk.split(/(\s+)/); // keep whitespace tokens
    let acc = '';
    for (const p of parts) {
      if (!p) continue;
      if ((acc + p).length > maxLen && acc) {
        finalChunks.push(acc);
        acc = p.trimStart();
      } else {
        acc += p;
      }
    }
    if (acc) finalChunks.push(acc);
  }
  return finalChunks;
}

// Map franc ISO 639-3 codes to LibreTranslate supported language codes
const LIBRE_SUPPORTED = [
  'en', 'ar', 'az', 'zh', 'cs', 'de', 'es', 'fr', 'hi', 'it', 'ja', 'ko', 'pl', 'pt', 'ru', 'tr', 'uk', 'vi', 'nl', 'el', 'he', 'id', 'fa', 'sv', 'fi', 'hu', 'ro', 'sk', 'th', 'bg', 'hr', 'lt', 'sl', 'et', 'sr', 'ms', 'bn', 'ur', 'ta', 'te', 'ml', 'kn', 'gu', 'mr', 'pa', 'sw', 'tl', 'my', 'km', 'lo', 'am', 'zu', 'xh', 'st', 'so', 'yo', 'ig', 'ha', 'eu', 'gl', 'ca', 'is', 'ga', 'mt', 'lb', 'mk', 'sq', 'bs', 'af', 'hy', 'ka', 'be', 'mn', 'ky', 'kk', 'uz', 'tt', 'tk', 'ps', 'sd', 'si', 'ne', 'as', 'or', 'my', 'dz', 'bo', 'ug', 'ku', 'ckb', 'ky', 'kk', 'uz', 'tt', 'tk', 'ps', 'sd', 'si', 'ne', 'as', 'or', 'my', 'dz', 'bo', 'ug', 'ku', 'ckb'
];
const FRANC_TO_LIBRE: Record<string, string> = {
  'eng': 'en', 'ara': 'ar', 'aze': 'az', 'zho': 'zh', 'ces': 'cs', 'deu': 'de', 'spa': 'es', 'fra': 'fr', 'hin': 'hi', 'ita': 'it', 'jpn': 'ja', 'kor': 'ko', 'pol': 'pl', 'por': 'pt', 'rus': 'ru', 'tur': 'tr', 'ukr': 'uk', 'vie': 'vi', 'nld': 'nl', 'ell': 'el', 'heb': 'he', 'ind': 'id', 'fas': 'fa', 'swe': 'sv', 'fin': 'fi', 'hun': 'hu', 'ron': 'ro', 'slk': 'sk', 'tha': 'th', 'bul': 'bg', 'hrv': 'hr', 'lit': 'lt', 'slv': 'sl', 'est': 'et', 'srp': 'sr', 'msa': 'ms', 'ben': 'bn', 'urd': 'ur', 'tam': 'ta', 'tel': 'te', 'mal': 'ml', 'kan': 'kn', 'guj': 'gu', 'mar': 'mr', 'pan': 'pa', 'swa': 'sw', 'tgl': 'tl', 'mya': 'my', 'khm': 'km', 'lao': 'lo', 'amh': 'am', 'zul': 'zu', 'xho': 'xh', 'sot': 'st', 'som': 'so', 'yor': 'yo', 'ibo': 'ig', 'hau': 'ha', 'eus': 'eu', 'glg': 'gl', 'cat': 'ca', 'isl': 'is', 'gle': 'ga', 'mlt': 'mt', 'ltz': 'lb', 'mkd': 'mk', 'sqi': 'sq', 'bos': 'bs', 'afr': 'af', 'hye': 'hy', 'kat': 'ka', 'bel': 'be', 'mon': 'mn', 'kir': 'ky', 'kaz': 'kk', 'uzb': 'uz', 'tat': 'tt', 'tuk': 'tk', 'pus': 'ps', 'snd': 'sd', 'sin': 'si', 'nep': 'ne', 'asm': 'as', 'ori': 'or', 'dzo': 'dz', 'bod': 'bo', 'uig': 'ug', 'kur': 'ku', 'ckb': 'ckb'
};

async function doTranslateOnce(q: string, targetLanguage: string, timeoutMs: number): Promise<string> {
  // Use franc to detect the source language (ISO 639-3)
  let detectedSource = 'auto';
  try {
    const francCode = franc.franc(q, { minLength: 3 });
    if (francCode && francCode !== 'und') {
      const libreCode = FRANC_TO_LIBRE[francCode];
      if (libreCode && LIBRE_SUPPORTED.includes(libreCode)) {
        detectedSource = libreCode;
      } else {
        detectedSource = 'auto';
      }
    }
  } catch (e) {
    logger.warn(`franc language detection failed: ${e}`);
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
    return (data?.translatedText as string) || (data?.translated_text as string) || '';
  }
  if (lastError) throw lastError;
  throw new Error('LibreTranslate failed for all source language attempts');
}

export async function translateText(text: string, targetLanguage: string): Promise<string> {
  if (!text) return '';

  // Normalize and protect tokens before translation
  text = normalizeNFC(text);
  const sanitized = protectTokens(text);

  const MAX_RETRIES = 3;
  const BASE_TIMEOUT_MS = 15000; // 15s per attempt
  let lastErr: unknown;
  let triedChunkFallback = false;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const raw = await translateWithTokenProtection(sanitized, targetLanguage);
      return restoreTokens(raw);
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
            const piece = await doTranslateOnce(ch, targetLanguage, BASE_TIMEOUT_MS);
            outPieces.push(piece);
            await new Promise(r => setTimeout(r, 150));
          }
          const rawJoined = outPieces.join('');
          return restoreTokens(rawJoined);
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