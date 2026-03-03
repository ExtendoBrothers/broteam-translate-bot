/**
 * Candidate Generator — Manual Mode Fork
 *
 * Generates 4 translation candidates for a given tweet.
 * Full feature parity with translateAndPostWorker's translation pipeline:
 *
 *  - 12 pivot languages per chain (configurable via CANDIDATE_CHAIN_DEPTH)
 *  - Circuit breaker per language (5 failures → 1 h cooldown)
 *  - Alt-lang retry on problematic per-hop results
 *  - Stuck-chain detection (4 consecutive identical results → break early)
 *  - Jittered delay between translation hops (configurable via TRANSLATION_HOP_DELAY_MS)
 *  - Full isAcceptable() quality gate (length, language, repetition, spam checks)
 *  - Up to 33 retry attempts per chain until result passes quality gate
 *  - Fallback: picks funniest English result if all attempts exhaust
 *
 *  3 × random language chains  +  1 × oldschool (deterministic) chain.
 *  All candidates are scored with the humor scorer and heuristic evaluator.
 *  The best candidate is flagged with `isBestCandidate = true`.
 *
 * This module is intentionally decoupled from the auto-posting pipeline.
 * It is used only by the dashboard server in manual mode.
 */

import fs from 'fs';
import path from 'path';
import { Tweet } from '../types';
import { translateText } from '../translator/googleTranslate';
import { scoreHumor } from '../utils/humorScorer';
import { evaluateHeuristics } from '../utils/heuristicEvaluator';
import { logger, rotateLogFile } from '../utils/logger';
import { config } from '../config';
import { isSpammyResult } from '../utils/spamFilter';
import { detectLanguageByLexicon, getEnglishMatchPercentage } from '../translator/lexicon';

// @ts-expect-error - langdetect has no TypeScript definitions
import * as langdetect from 'langdetect';

// Number of pivot languages per chain. Default 12 matches translateAndPostWorker.
const DEFAULT_CANDIDATE_CHAIN_DEPTH = 12;
const rawCandidateChainDepth = process.env.CANDIDATE_CHAIN_DEPTH;
const parsedCandidateChainDepth = rawCandidateChainDepth
  ? Number.parseInt(rawCandidateChainDepth, 10)
  : DEFAULT_CANDIDATE_CHAIN_DEPTH;
const CANDIDATE_CHAIN_DEPTH =
  Number.isFinite(parsedCandidateChainDepth) && parsedCandidateChainDepth >= 1
    ? parsedCandidateChainDepth
    : DEFAULT_CANDIDATE_CHAIN_DEPTH;

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface Candidate {
  /** 0-based index into the 4 candidates */
  chainIndex: number;
  /** Human-readable label ("Random-1", "Random-2", "Random-3", "Oldschool") */
  chainLabel: string;
  /** Ordered list of pivot languages used in this chain */
  languages: string[];
  /** Final translated text (always returned to English) */
  result: string;
  /** Humor probability 0.0–1.0 from ML/heuristic scorer */
  humorScore: number;
  /** Heuristic quality score 0.0–1.0 */
  heuristicScore: number;
  /** Weighted: 0.6 × humor + 0.4 × heuristic */
  combinedScore: number;
  /** True for the single highest-scoring candidate */
  isBestCandidate: boolean;
  /** ML humor score + extended heuristic bonuses — used for best-candidate selection */
  unifiedHumorScore?: number;
  /** Whether the result was detected as English (humor model only scores English) */
  isEnglish?: boolean;
  /** differenceScore + 2 × unexpectednessScore — tiebreaker when unified scores are equal */
  tieBreaker?: number;
  /** Number of chain attempts before an acceptable result was found */
  attempts?: number;
  /**
   * Non-empty when the final result failed the quality gate but was the best
   * available fallback. Shown as warnings on the dashboard card.
   */
  acceptabilityWarnings?: string[];
  /** Set when the chain throws an unrecoverable error */
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Debug log helper
// ─────────────────────────────────────────────────────────────────────────────

function appendToDebugLog(content: string): void {
  try {
    const debugLogPath = path.join(process.cwd(), 'translation-logs', 'translation-debug.log');
    rotateLogFile(debugLogPath, 10 * 1024 * 1024); // 10 MB
    fs.appendFileSync(debugLogPath, content, 'utf8');
  } catch {
    // non-fatal — never crash the pipeline over a log write
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Circuit breaker
// ─────────────────────────────────────────────────────────────────────────────

interface CircuitState { failures: number; openedAt?: number; }
const circuit: Record<string, CircuitState> = {};
const FAILURE_THRESHOLD = 5;
const CIRCUIT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

function isCircuitOpen(lang: string): boolean {
  const state = circuit[lang];
  if (!state || state.failures < FAILURE_THRESHOLD || !state.openedAt) return false;
  if (Date.now() - state.openedAt >= CIRCUIT_COOLDOWN_MS) {
    circuit[lang] = { failures: 0, openedAt: undefined };
    return false;
  }
  return true;
}

function recordFailure(lang: string): void {
  if (lang === 'en') return;
  const state = circuit[lang] || { failures: 0 };
  state.failures += 1;
  if (state.failures === FAILURE_THRESHOLD && !state.openedAt) {
    state.openedAt = Date.now();
    logger.warn(`[CIRCUIT] Opened for ${lang} after ${state.failures} failures; skipping for ${CIRCUIT_COOLDOWN_MS / 60000}m`);
  }
  circuit[lang] = state;
}

function recordSuccess(lang: string): void {
  const state = circuit[lang];
  if (state && state.failures > 0) {
    circuit[lang] = { failures: 0, openedAt: undefined };
    logger.info(`[CIRCUIT] Reset for ${lang} after successful translation`);
  }
}

/** Reset all circuit breaker state. Exported for tests only — do not call in production. */
export function _resetCircuitBreaker(): void {
  for (const key of Object.keys(circuit)) {
    delete circuit[key];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** Returns per-hop delay in ms. Reads env var at call-time so tests can set it to 0. */
function getHopDelay(): number {
  const raw = process.env.TRANSLATION_HOP_DELAY_MS;
  const parsed = Number(raw ?? '5000');
  const base = Number.isFinite(parsed) ? parsed : 5000;
  if (base === 0) return 0;
  return base + Math.floor(Math.random() * 1200);
}

function shuffleArray<T>(array: T[]): T[] {
  const arr = array.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function isAllCaps(text: string): boolean {
  const letters = text.replace(/[^a-zA-Z]/g, '');
  return letters.length > 5 && letters === letters.toUpperCase();
}

async function retryWithDifferentLang(
  input: string,
  badResult: string,
  excludeLangs: string[]
): Promise<string | null> {
  const allLangs = config.LANGUAGES.filter(l => !excludeLangs.includes(l));
  for (const lang of allLangs) {
    try {
      const result = await translateText(input, lang);
      if (result && result.trim() !== badResult && result.trim() !== '' && result.trim() !== '/') {
        logger.info(`[CANDIDATE_GEN] Recovered using alt lang ${lang}: ${result.substring(0, 50)}…`);
        return result;
      }
    } catch (e) {
      logger.warn(`[CANDIDATE_GEN] Retry with alt lang ${lang} failed: ${e}`);
    }
  }
  return null;
}

function differenceScore(a: string, b: string): number {
  const setA = new Set(a.toLowerCase().split(/\W+/));
  const setB = new Set(b.toLowerCase().split(/\W+/));
  const union = new Set([...setA, ...setB]);
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  return union.size - intersection.size;
}

function unexpectednessScore(result: string, original: string): number {
  const origWords = new Set(original.toLowerCase().split(/\W+/));
  const resultWords = new Set(result.toLowerCase().split(/\W+/));
  let unexpected = 0;
  for (const w of resultWords) {
    if (!origWords.has(w) && w.length > 2) unexpected++;
  }
  return unexpected;
}

// ─────────────────────────────────────────────────────────────────────────────
// Quality gate — full port of isAcceptable() from translateAndPostWorker
// ─────────────────────────────────────────────────────────────────────────────

function isAcceptable(
  finalResult: string,
  originalText: string
): { acceptable: boolean; reason: string } {
  const trimmed = finalResult.trim();
  const originalTrimmed = originalText.trim();
  const tokenPattern = /__XTOK_[A-Z]+_\d+_[A-Za-z0-9+/=]+__/g;

  const textOnly = trimmed
    .replace(tokenPattern, '')
    .replace(/@[a-zA-Z0-9_-]+/g, '')
    .replace(/#[a-zA-Z0-9_]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const originalTextOnly = originalTrimmed
    .replace(tokenPattern, '')
    .replace(/@[a-zA-Z0-9_-]+/g, '')
    .replace(/#[a-zA-Z0-9_]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const tooShort = textOnly.length < Math.ceil(0.33 * originalTextOnly.length);
  const empty = textOnly.length <= 1;
  const punctuationOnly = /^[\p{P}\p{S}]+$/u.test(textOnly);
  const sameAsInput = textOnly === originalTextOnly;
  const problematicChar = ['/', ':', '.', '', ' '].includes(textOnly) || textOnly.startsWith('/');
  const tooLong = trimmed.length > 288;

  // Repetition / spam pattern checks
  const spamPatterns = [
    /(\w+)\s+\1\s+\1/,
    /(\w{3,})\s+\1\s+\1\s+\1/,
    /(.)\1{4,}/,
    /(\w{2,})-\1-\1-\1/i,
    /(\w{3,})\1\1\1/i,
  ];
  let repetitive = spamPatterns.some(p => p.test(textOnly));

  if (!repetitive && textOnly.length > 20) {
    for (let len = 3; len <= 8; len++) {
      if (new RegExp(`(.{${len}})\\1{3,}`, 'i').test(textOnly.replace(/\s+/g, ''))) {
        repetitive = true;
        break;
      }
    }
  }

  if (!repetitive) {
    const parts = textOnly.split('-').map(p => p.trim().toLowerCase());
    if (parts.length >= 4) {
      const counts: Record<string, number> = {};
      for (const part of parts) {
        if (part.length >= 2) {
          counts[part] = (counts[part] || 0) + 1;
          if (counts[part] >= 4) { repetitive = true; break; }
        }
      }
    }
  }

  if (!repetitive) {
    const wc: Record<string, number> = {};
    for (const w of textOnly.split(/\s+/)) {
      if (!w) continue;
      wc[w] = (wc[w] || 0) + 1;
      if (wc[w] > 10) { repetitive = true; break; }
    }
  }

  // Language detection — non-Latin script quick-reject, then lexicon, then langdetect fallback
  const hasCyrillic = /[\u0400-\u04FF]/.test(textOnly);
  const hasArabic = /[\u0600-\u06FF]/.test(textOnly);
  const hasCJK = /[\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF]/.test(textOnly);

  let detectedLang = 'und';

  if (hasCyrillic || hasArabic || hasCJK) {
    detectedLang = 'non-latin';
  } else {
    const lexiconResult = detectLanguageByLexicon(textOnly);
    detectedLang = lexiconResult || 'und';
    const englishMatchPct = getEnglishMatchPercentage(textOnly);

    // Validate borderline English (50–70% match) with langdetect
    if (detectedLang === 'en' && englishMatchPct >= 50 && englishMatchPct < 70) {
      try {
        const detections = langdetect.detect(textOnly);
        if (!detections?.length || detections[0].lang !== 'en' || detections[0].prob < 0.8) {
          detectedLang = 'und';
        }
      } catch { /* ignore */ }
    }

    // Fallback to langdetect when lexicon is inconclusive
    if (detectedLang === 'und' && textOnly.split(/\W+/).filter(w => w.length > 2).length > 0) {
      const englishMatchPct2 = getEnglishMatchPercentage(textOnly);
      try {
        const detections = langdetect.detect(textOnly);
        if (
          detections?.length > 0 &&
          detections[0].lang === 'en' &&
          detections[0].prob > 0.8 &&
          (!detections[1] || detections[1].prob <= detections[0].prob - 0.1) &&
          englishMatchPct2 >= 20
        ) {
          detectedLang = detections[0].lang;
        }
      } catch { /* ignore */ }
    }
  }

  const notEnglish = detectedLang !== 'en';

  const reasons: string[] = [];
  if (tooShort) reasons.push(`Too short: ${textOnly.length} < 33% of input (${originalTextOnly.length})`);
  if (tooLong) reasons.push(`Too long: ${trimmed.length} > 288 chars`);
  if (empty) reasons.push('Empty output');
  if (punctuationOnly) reasons.push('Punctuation only');
  if (sameAsInput) reasons.push('Same as input');
  if (notEnglish) reasons.push(`Not English: detected ${detectedLang}`);
  if (problematicChar) reasons.push('Problematic character');
  if (repetitive) reasons.push('Repetitive/spammy content');

  const acceptable = reasons.length === 0;
  appendToDebugLog(`[DEBUG][CANDIDATE_GEN] isAcceptable=${acceptable} reason='${reasons.join('; ')}'\n`);
  return { acceptable, reason: reasons.join('; ') };
}

// ─────────────────────────────────────────────────────────────────────────────
// Single chain execution with circuit breaker, stuck-detection, alt-lang retry
// ─────────────────────────────────────────────────────────────────────────────

async function executeTranslationChain(
  inputText: string,
  languages: string[],
  chainLabel: string
): Promise<{ result: string; attempted: boolean }> {
  const shouldUppercase = isAllCaps(inputText);
  let translationChain = shouldUppercase ? inputText.toLowerCase() : inputText;
  let currentSource = 'en';
  let consecutiveSame = 0;
  let previousResult = translationChain;
  let translationAttempted = false;

  for (const lang of languages) {
    if (lang === 'en' && currentSource === 'en') continue; // skip no-op en→en
    if (lang !== 'en' && isCircuitOpen(lang)) {
      logger.warn(`[${chainLabel}] Skipping ${lang} — circuit open`);
      continue;
    }
    try {
      let result = await translateText(translationChain, lang, currentSource);
      const trimmedResult = result.trim();

      // Alt-lang retry on obviously broken results
      if (['/', ':', '.', '', ' '].includes(trimmedResult) || trimmedResult.startsWith('/')) {
        logger.warn(`[${chainLabel}] Problematic result for ${lang}: '${result}'. Trying alt lang.`);
        const altResult = await retryWithDifferentLang(translationChain, trimmedResult, [lang]);
        if (altResult) result = altResult;
      }

      // Stuck-chain detection: 4+ consecutive identical results → break early but keep progress
      if (result === previousResult) {
        consecutiveSame++;
        if (consecutiveSame >= 4) {
          logger.warn(`[${chainLabel}] Chain stuck after 4 identical results — breaking early`);
          break;
        }
      } else {
        consecutiveSame = 0;
      }
      previousResult = result;
      translationChain = result;
      currentSource = lang;
      recordSuccess(lang);
      translationAttempted = true;
      logger.info(`[${chainLabel}] ···${lang}: ${translationChain.substring(0, 60)}…`);
      appendToDebugLog(`[DEBUG][${chainLabel}][${lang}] ${translationChain.replace(/\n/g, ' ')}\n`);
    } catch (err) {
      logger.error(`[${chainLabel}] Failed at ${lang}: ${err}`);
      recordFailure(lang);
    }
    await delay(getHopDelay());
  }

  // Final → English step
  if (currentSource !== 'en' && translationAttempted) {
    try {
      logger.info(`[${chainLabel}] Final step: → en from ${currentSource}`);
      const finalEn = await translateText(translationChain, 'en', currentSource);
      translationChain = finalEn;
      if (shouldUppercase) translationChain = translationChain.toUpperCase();
      appendToDebugLog(`[DEBUG][${chainLabel}][final-en] ${translationChain.replace(/\n/g, ' ')}\n`);
    } catch (err) {
      logger.error(`[${chainLabel}] Failed final → en: ${err}`);
    }
  }

  if (shouldUppercase) {
    translationChain = translationAttempted ? translationChain.toUpperCase() : inputText;
  }

  return { result: translationChain, attempted: translationAttempted };
}

// ─────────────────────────────────────────────────────────────────────────────
// Chain with retries — up to maxRetries attempts until isAcceptable passes
// ─────────────────────────────────────────────────────────────────────────────

async function runChainWithRetries(
  inputText: string,
  languages: string[],
  chainLabel: string,
  maxRetries = 33
): Promise<{ result: string; attempts: number; acceptabilityWarnings: string[] }> {
  let attempts = 0;
  let acceptable = false;
  let finalResult = inputText;
  const englishResults: string[] = [];
  let chainNeverAttempted = false;

  while (!acceptable && attempts < maxRetries) {
    attempts++;
    logger.info(`[${chainLabel}] Attempt ${attempts}/${maxRetries}…`);

    const chainResult = await executeTranslationChain(inputText, languages, chainLabel);
    if (!chainResult.attempted) {
      // All languages were skipped (circuits open, empty list, or depth resolves to 0).
      // Retrying immediately cannot fix this — break rather than burning through all retries.
      logger.warn(
        `[${chainLabel}] Chain not attempted — all languages skipped (circuits open or empty list). Aborting retries.`
      );
      chainNeverAttempted = true;
      break;
    }

    finalResult = chainResult.result;
    const check = isAcceptable(finalResult, inputText);
    const spammy = isSpammyResult(finalResult);
    acceptable = check.acceptable && !spammy;

    if (acceptable) {
      logger.info(`[${chainLabel}] ✓ Acceptable after ${attempts} attempt(s)`);
    } else {
      const reasons = spammy ? `${check.reason}; spammy content` : check.reason;
      logger.warn(`[${chainLabel}] Attempt ${attempts} unacceptable: ${reasons}`);
    }

    // Maintain pool of English results for best-of fallback
    const textOnly = finalResult
      .replace(/__XTOK_[A-Z]+_\d+_[A-Za-z0-9+/=]+__/g, '')
      .replace(/@[a-zA-Z0-9_-]+/g, '')
      .replace(/#[a-zA-Z0-9_]+/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (detectLanguageByLexicon(textOnly) === 'en') {
      englishResults.push(finalResult);
    }
  }

  if (!acceptable) {
    if (chainNeverAttempted) {
      logger.error(
        `[${chainLabel}] Chain never attempted — no translation possible (all circuits open or language list empty)`
      );
      return {
        result: inputText,
        attempts,
        acceptabilityWarnings: [
          'chain not attempted: all languages skipped (circuits open or empty list)',
        ],
      };
    }

    logger.error(`[${chainLabel}] No acceptable result after ${maxRetries} attempts`);

    if (englishResults.length > 0) {
      // Pick the funniest English result collected across all attempts
      let bestScore = -1;
      let funniest = englishResults[0];
      for (const res of englishResults) {
        const score = differenceScore(res, inputText) + unexpectednessScore(res, inputText) * 2;
        if (score > bestScore) { bestScore = score; funniest = res; }
      }
      logger.warn(`[${chainLabel}] Using funniest English fallback (score: ${bestScore.toFixed(2)})`);
      finalResult = funniest;
    }

    const check = isAcceptable(finalResult, inputText);
    const spammy = isSpammyResult(finalResult);
    return {
      result: finalResult,
      attempts,
      acceptabilityWarnings: [
        ...check.reason.split('; '),
        ...(spammy ? ['spammy content'] : []),
      ].filter(Boolean),
    };
  }

  return { result: finalResult, attempts, acceptabilityWarnings: [] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate all 4 translation candidates for a single tweet.
 * Chains run sequentially to avoid overloading LibreTranslate.
 * Each chain retries up to 33× until isAcceptable() passes.
 * Returns candidates with humor/heuristic scores; best candidate is flagged.
 */
export async function generateCandidates(tweet: Tweet): Promise<Candidate[]> {
  const availableLangs = config.LANGUAGES.filter(l => l !== 'en');

  const chainDefs: { label: string; languages: string[] }[] = [
    { label: 'Random-1', languages: shuffleArray(availableLangs).slice(0, CANDIDATE_CHAIN_DEPTH) },
    { label: 'Random-2', languages: shuffleArray(availableLangs).slice(0, CANDIDATE_CHAIN_DEPTH) },
    { label: 'Random-3', languages: shuffleArray(availableLangs).slice(0, CANDIDATE_CHAIN_DEPTH) },
    {
      label: 'Oldschool',
      languages: config.OLDSCHOOL_LANGUAGES.length > 0
        ? config.OLDSCHOOL_LANGUAGES  // use full sequence including 'en' bounce-backs
        : shuffleArray(availableLangs).slice(0, CANDIDATE_CHAIN_DEPTH),
    },
  ];

  const candidates: Candidate[] = [];

  for (let i = 0; i < chainDefs.length; i++) {
    const { label, languages } = chainDefs[i];
    logger.info(`[CANDIDATE_GEN] Chain ${i + 1}/4 "${label}" langs: ${languages.join('→')}`);

    let result = tweet.text;
    let error: string | undefined;
    let attempts = 0;
    let acceptabilityWarnings: string[] = [];

    try {
      const out = await runChainWithRetries(tweet.text, languages, label);
      result = out.result;
      attempts = out.attempts;
      acceptabilityWarnings = out.acceptabilityWarnings;
    } catch (err) {
      error = String(err);
      logger.error(`[CANDIDATE_GEN] Chain "${label}" threw unhandled error: ${err}`);
    }

    candidates.push({
      chainIndex: i,
      chainLabel: label,
      languages,
      result,
      humorScore: 0,
      heuristicScore: 0,
      combinedScore: 0,
      isBestCandidate: false,
      attempts,
      acceptabilityWarnings,
      error,
    });
  }

  // ── Score each candidate (humor model + heuristics) ──────────────────────
  for (const candidate of candidates) {
    let humorRaw = 0;
    try {
      const humor = await scoreHumor(candidate.result, tweet.text);
      candidate.humorScore = Math.max(0, Math.min(1, humor.score));
      humorRaw = humor.score;
    } catch {
      candidate.humorScore = 0;
    }

    let heuristicEval = { score: 0, details: [] as string[] };
    try {
      heuristicEval = evaluateHeuristics(candidate.result, tweet.text);
      candidate.heuristicScore = Math.max(0, Math.min(1, (heuristicEval.score + 5) / 10));
    } catch {
      candidate.heuristicScore = 0;
    }

    candidate.combinedScore = 0.6 * candidate.humorScore + 0.4 * candidate.heuristicScore;

    // ── Language detection (same logic as isAcceptable / translateAndPostWorker) ──
    const tokenPattern = /__XTOK_[A-Z]+_\d+_[A-Za-z0-9+/=]+__/g;
    const textOnly = candidate.result
      .replace(tokenPattern, '')
      .replace(/@[a-zA-Z0-9_-]+/g, '')
      .replace(/#[a-zA-Z0-9_]+/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    const hasCyrillic = /[\u0400-\u04FF]/.test(textOnly);
    const hasArabic   = /[\u0600-\u06FF]/.test(textOnly);
    const hasCJK      = /[\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF]/.test(textOnly);
    let detectedLang  = 'und';

    if (hasCyrillic || hasArabic || hasCJK) {
      detectedLang = 'non-latin';
    } else {
      const lexiconResult   = detectLanguageByLexicon(textOnly);
      detectedLang          = lexiconResult || 'und';
      const englishMatchPct = getEnglishMatchPercentage(textOnly);

      if (detectedLang === 'en' && englishMatchPct >= 50 && englishMatchPct < 70) {
        try {
          const d = langdetect.detect(textOnly);
          if (!d?.length || d[0].lang !== 'en' || d[0].prob < 0.8) detectedLang = 'und';
        } catch { /* ignore */ }
      }

      if (detectedLang === 'und' && textOnly.split(/\W+/).filter(w => w.length > 2).length > 0) {
        const pct = getEnglishMatchPercentage(textOnly);
        try {
          const d = langdetect.detect(textOnly);
          if (d?.length && d[0].lang === 'en' && d[0].prob > 0.8 &&
              (!d[1] || d[1].prob <= d[0].prob - 0.1) && pct >= 20) {
            detectedLang = d[0].lang;
          }
        } catch { /* ignore */ }
      }
    }

    candidate.isEnglish  = detectedLang === 'en';
    candidate.tieBreaker = differenceScore(candidate.result, tweet.text)
                         + unexpectednessScore(candidate.result, tweet.text) * 2;

    // ── Extended heuristic bonuses (ported from translateAndPostWorker) ────
    let bonus = 0;
    const bonusLog: string[] = [];

    // Oldschool chain preference
    if (candidate.chainLabel === 'Oldschool') {
      bonus += 0.05;
      bonusLog.push('Oldschool +0.050');
    }

    // Length bonus (~0.05 for 100+ chars)
    const lengthBonus = Math.max(0, (candidate.result.length - 30) * 0.0005);
    if (lengthBonus > 0) { bonus += lengthBonus; bonusLog.push(`length +${lengthBonus.toFixed(4)}`); }

    // Coherence bonus: sentence endings + verb presence
    const text = candidate.result.trim();
    const lowerText = text.toLowerCase();
    const hasSentenceEnd = /[.!?]$/.test(text);
    const VERBS = ['is','are','was','were','has','have','had','do','does','did','will','would','can','could','should','may','might'];
    const hasVerb = lowerText.split(/\s+/).some(w => VERBS.includes(w));
    const coherenceBonus = (hasSentenceEnd ? 0.01 : 0) + (hasVerb ? 0.01 : 0);
    if (coherenceBonus > 0) { bonus += coherenceBonus; bonusLog.push(`coherence +${coherenceBonus.toFixed(3)}`); }

    // Garbage penalty: low word diversity
    const words = lowerText.split(/\s+/).filter(w => w.length > 0);
    const diversityRatio = words.length > 0 ? new Set(words).size / words.length : 1;
    if (diversityRatio < 0.7) { bonus -= 0.02; bonusLog.push('garbage -0.020'); }

    // Contradiction bonus
    const CONTRADICTIONS = [
      /\b(nice|good|delicious)\b.*\b(crime|bad|evil)\b/,
      /\b(smart|intelligent)\b.*\b(stupid|dumb)\b/,
      /\b(fast|quick)\b.*\b(slow)\b/,
      /\b(hot)\b.*\b(cold)\b/,
    ];
    if (CONTRADICTIONS.some(p => p.test(lowerText))) { bonus += 0.015; bonusLog.push('contradiction +0.015'); }

    // Self-deprecation bonus
    const hasFirstPerson = /\b(i|me|my|mine)\b/.test(lowerText);
    const hasNegativeSelf = /\b(stupid|dumb|autistic|idiot|moron|retard)\b/.test(lowerText);
    const hasSelfCriticism = /\b(gave myself|have given myself|am)\b.*\b(autism|stupid|dumb)\b/.test(lowerText);
    if ((hasFirstPerson && hasNegativeSelf) || hasSelfCriticism) { bonus += 0.012; bonusLog.push('self-dep +0.012'); }

    // Absurdity bonus
    if (/\b(impossible|absurd|nonsensical|ridiculous|insane|crazy|delusional)\b/.test(lowerText)) { bonus += 0.008; bonusLog.push('absurd +0.008'); }
    if (/\b(million|billion|trillion|infinite|endless|eternal|ultimate|supreme)\b/.test(lowerText)) { bonus += 0.005; bonusLog.push('extreme +0.005'); }
    if (/\b(flying pigs|square circle|cold heat|dark light)\b/.test(lowerText)) { bonus += 0.010; bonusLog.push('impossible +0.010'); }

    // User-defined heuristic evaluation (raw score, same as old worker)
    if (heuristicEval.score !== 0) {
      bonus += heuristicEval.score;
      bonusLog.push(`heuristic ${heuristicEval.score > 0 ? '+' : ''}${heuristicEval.score.toFixed(3)}`);
    }

    const appliedBonus = Math.min(bonus, 0.15);
    candidate.unifiedHumorScore = Math.min(1.0, humorRaw + appliedBonus);

    if (bonusLog.length > 0) {
      logger.info(`[CANDIDATE_GEN][HEURISTIC] ${candidate.chainLabel}: humor ${humorRaw.toFixed(3)} → unified ${candidate.unifiedHumorScore.toFixed(3)} (${bonusLog.join(', ')})`);
    }
  }

  // ── Best-candidate selection: English preference → unified score → tiebreaker ──
  let bestIdx = 0;
  for (let i = 1; i < candidates.length; i++) {
    const curr = candidates[i];
    const best = candidates[bestIdx];
    if (curr.isEnglish && !best.isEnglish)  { bestIdx = i; continue; }
    if (!curr.isEnglish && best.isEnglish)  { continue; }
    const currU = curr.unifiedHumorScore ?? curr.combinedScore;
    const bestU = best.unifiedHumorScore ?? best.combinedScore;
    if (currU > bestU) { bestIdx = i; continue; }
    if (currU === bestU && (curr.tieBreaker ?? 0) > (best.tieBreaker ?? 0)) { bestIdx = i; }
  }
  candidates[bestIdx].isBestCandidate = true;

  logger.info(
    `[CANDIDATE_GEN] ✨ Best: "${candidates[bestIdx].chainLabel}" ` +
    `unified=${candidates[bestIdx].unifiedHumorScore?.toFixed(3)} ` +
    `combined=${candidates[bestIdx].combinedScore.toFixed(3)} ` +
    `en=${candidates[bestIdx].isEnglish}`
  );

  return candidates;
}
