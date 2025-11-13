/**
 * LibreTranslate client (no Google/Cloud deps).
 * Uses global fetch (Node 18+) or falls back to node-fetch.
 * Supports:
 *  - LIBRETRANSLATE_URL (defaults to http://127.0.0.1:5000/translate for local instance)
 *  - LIBRETRANSLATE_API_KEY (optional) — added to request body as "api_key"
 */

import { logger } from '../utils/logger';

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

export async function translateText(text: string, targetLanguage: string): Promise<string> {
  if (!text) return '';

  // Normalize to NFC before processing to reduce cross-hop artifacts
  try { text = text.normalize('NFC'); } catch { /* noop */ }

  // Tokenize and protect sensitive spans so translators don't mangle them.
  // Order matters: protect code blocks first to avoid inner replacements.
  const patterns: Array<{ type: string; regex: RegExp }> = [
    { type: 'CODEBLK', regex: /```[\s\S]*?```/g },
    { type: 'CODE', regex: /`[^`]+`/g },
    { type: 'URL', regex: /(https?:\/\/[^\s)\]}]+)|(www\.[^\s)\]}]+)/gi },
    { type: 'EMAIL', regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
    { type: 'MENTION', regex: /\B@[a-zA-Z0-9_]{1,15}\b/g },
    { type: 'HASHTAG', regex: /\B#[\p{L}0-9_]+/gu },
    { type: 'CASHTAG', regex: /\B\$[A-Za-z]{1,6}\b/g },
  ];

  let tokenIndex = 0;
  const replacements: Array<{ token: string; value: string }> = [];
  let sanitized = text;

  for (const { type, regex } of patterns) {
    sanitized = sanitized.replace(regex, (match: string) => {
      tokenIndex += 1;
      const b64 = Buffer.from(match, 'utf8').toString('base64');
      const token = `{{XTOK:${type}:${tokenIndex}:${b64}}}`;
      replacements.push({ token, value: match });
      return token;
    });
  }

  const bodyPayload: any = {
    q: sanitized,
    source: 'auto',
    target: targetLanguage,
    format: 'text',
  };
  if (LIBRE_API_KEY) bodyPayload.api_key = LIBRE_API_KEY;

  const MAX_RETRIES = 3;
  const BASE_TIMEOUT_MS = 15000; // 15s per attempt
  let lastErr: any;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetchWithTimeout(LIBRE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload),
      }, BASE_TIMEOUT_MS);

      if (!res.ok) {
        const body = await res.text();
        const status = res.status;
        const retriable = [408, 429, 500, 502, 503, 504].includes(status);
        if (!retriable || attempt === MAX_RETRIES) {
          throw new Error(`LibreTranslate error ${status}: ${body}`);
        }
        throw new Error(`Retriable LibreTranslate error ${status}: ${body}`);
      }

      const data = await res.json();
      let restored = (data?.translatedText as string) || (data?.translated_text as string) || '';

      // Backward compatibility for prior placeholder style (XURL)
      restored = restored.replace(/XURL:([A-Za-z0-9+/=]+)/g, (_m, p1) => {
        try { return Buffer.from(p1, 'base64').toString('utf8'); } catch { return _m; }
      });

      // Restore all generic XTOK placeholders regardless of surrounding punctuation/braces
      restored = restored.replace(/XTOK:([A-Z]+):(\d+):([A-Za-z0-9+/=]+)/g, (_m, type, _idx, b64) => {
        try { return Buffer.from(b64, 'base64').toString('utf8'); } catch { return _m; }
      });

      // Clean up any leftover wrapper chars that translators might add around tokens
      restored = restored
        .replace(/\{+\s*([^{}\s][^{}]*?)\s*\}+/g, '$1')
        .replace(/\[+\s*([^\[\]\s][^\[\]]*?)\s*\]+/g, '$1')
        .replace(/<+\s*([^<>\s][^<>]*?)\s*>+/g, '$1')
        .replace(/\(+\s*([^()\s][^()]*)\s*\)+/g, '$1')
        // Also strip stray leading/trailing wrappers around common token types
        .replace(/[\[{(<]+(?=(https?:\/\/\S))/g, '')
        .replace(/(?<=https?:\/\/\S)[\]})>]+/g, '')
        .replace(/[\[{(<]+(?=(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b))/gi, '')
        .replace(/(?:(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b))[\]})>]+/gi, (m) => m.replace(/[\]})>]+$/,' ' ).trimEnd())
        .replace(/[\[{(<]+(?=@[a-zA-Z0-9_]{1,15}\b)/g, '')
        .replace(/(@[a-zA-Z0-9_]{1,15}\b)[\]})>]+/g, '$1')
        .replace(/[\[{(<]+(?=#[\p{L}0-9_]+)/gu, '')
        .replace(/(#[\p{L}0-9_]+)[\]})>]+/gu, '$1')
        .replace(/[\[{(<]+(?=\$[A-Za-z]{1,6}\b)/g, '')
        .replace(/(\$[A-Za-z]{1,6}\b)[\]})>]+/g, '$1');

      try { restored = restored.normalize('NFC'); } catch { /* noop */ }
      return restored;
    } catch (error: any) {
      lastErr = error;
      const isAbort = error?.name === 'AbortError' || /aborted|timeout/i.test(error?.message || '');
      const isNetwork = /ECONNRESET|ENOTFOUND|EAI_AGAIN|ECONNREFUSED/i.test(error?.message || '');
      const retriable = isAbort || isNetwork || /Retriable LibreTranslate error/.test(error?.message || '');
      if (attempt < MAX_RETRIES && retriable) {
        const backoff = Math.min(5000, 500 * Math.pow(2, attempt - 1));
        const jitter = Math.floor(Math.random() * 250);
        const wait = backoff + jitter;
        logger.warn(`Translate retry ${attempt}/${MAX_RETRIES - 1} after ${wait}ms due to: ${error?.message || error}`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      break;
    }
  }

  const errMsg = (lastErr as any)?.message || String(lastErr);
  throw new Error(`Translation failed (LibreTranslate at ${LIBRE_URL}): ${errMsg}`);
}