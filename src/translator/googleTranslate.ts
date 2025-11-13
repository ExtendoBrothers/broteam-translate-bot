/**
 * LibreTranslate client (no Google/Cloud deps).
 * Uses global fetch (Node 18+) or falls back to node-fetch.
 * Supports:
 *  - LIBRETRANSLATE_URL (defaults to http://127.0.0.1:5000/translate for local instance)
 *  - LIBRETRANSLATE_API_KEY (optional) — added to request body as "api_key"
 */

import { logger } from '../utils/logger';
import { normalizeNFC, protectTokens, restoreTokens } from './tokenizer';

// Default to local instance using 127.0.0.1 (avoids IPv6 issues)
const LIBRE_URL = process.env.LIBRETRANSLATE_URL || 'http://127.0.0.1:5000/translate';
const LIBRE_API_KEY = process.env.LIBRETRANSLATE_API_KEY || process.env.LIBRETRANSLATE_KEY || '';

async function fetchWithTimeout(input: RequestInfo, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(input as any, { ...init, signal: controller.signal } as any);
    return res as any;
  } finally {
    clearTimeout(id);
  }
}

function splitProtectedIntoChunks(protectedText: string, maxLen = 220): string[] {
  if (protectedText.length <= maxLen) return [protectedText];
  const parts = protectedText.split(/(\s+)/); // keep whitespace tokens
  const chunks: string[] = [];
  let current = '';
  for (const p of parts) {
    if (!p) continue;
    if ((current + p).length > maxLen && current.length > 0) {
      chunks.push(current);
      current = p.trimStart();
    } else {
      current += p;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function doTranslateOnce(q: string, targetLanguage: string, timeoutMs: number): Promise<string> {
  const bodyPayload: any = {
    q,
    source: 'auto',
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
    throw new Error(`LibreTranslate error ${status}: ${body}`);
  }
  const data = await res.json();
  return (data?.translatedText as string) || (data?.translated_text as string) || '';
}

export async function translateText(text: string, targetLanguage: string): Promise<string> {
  if (!text) return '';

  // Normalize and protect tokens before translation
  text = normalizeNFC(text);
  const sanitized = protectTokens(text);

  const MAX_RETRIES = 3;
  const BASE_TIMEOUT_MS = 15000; // 15s per attempt
  let lastErr: any;
  let triedChunkFallback = false;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const raw = await doTranslateOnce(sanitized, targetLanguage, BASE_TIMEOUT_MS);
      return restoreTokens(raw);
    } catch (error: any) {
      lastErr = error;
      const statusMatch = /LibreTranslate error (\d+)/.exec(error?.message || '');
      const status = statusMatch ? parseInt(statusMatch[1], 10) : undefined;
      const isAbort = error?.name === 'AbortError' || /aborted|timeout/i.test(error?.message || '');
      const isNetwork = /ECONNRESET|ENOTFOUND|EAI_AGAIN|ECONNREFUSED/i.test(error?.message || '');
      const retriable = isAbort || isNetwork || [408, 429, 500, 502, 503, 504].includes(status || 0);
      if (attempt < MAX_RETRIES && retriable) {
        const backoff = Math.min(5000, 500 * Math.pow(2, attempt - 1));
        const jitter = Math.floor(Math.random() * 250);
        const wait = backoff + jitter;
        logger.warn(`Translate retry ${attempt}/${MAX_RETRIES - 1} after ${wait}ms due to: ${error?.message || error}`);
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
        } catch (e: any) {
          lastErr = e;
        }
      }
      break;
    }
  }

  const errMsg = (lastErr as any)?.message || String(lastErr);
  throw new Error(`Translation failed (LibreTranslate at ${LIBRE_URL}): ${errMsg}`);
}