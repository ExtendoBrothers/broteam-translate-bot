/**
 * Candidate Generator — Manual Mode Fork
 *
 * Generates 4 translation candidates for a given tweet:
 *  3 × random language chains  +  1 × oldschool (deterministic) chain
 * All candidates are scored with the humor scorer and heuristic evaluator.
 * The best candidate is flagged with `isBestCandidate = true`.
 *
 * This module is intentionally decoupled from the auto-posting pipeline.
 * It is used only by the dashboard server in manual mode.
 */

import { Tweet } from '../types';
import { translateText } from '../translator/googleTranslate';
import { scoreHumor } from '../utils/humorScorer';
import { evaluateHeuristics } from '../utils/heuristicEvaluator';
import { logger } from '../utils/logger';
import { config } from '../config';

// Number of pivot languages per chain. Default 6 keeps runtime under ~1 min per chain.
const CANDIDATE_CHAIN_DEPTH = Number(process.env.CANDIDATE_CHAIN_DEPTH || '6');

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
  /** Set when the chain throws an unrecoverable error */
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

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

/** Run a single translation chain through the given pivot languages, ending in English. */
async function runChain(
  inputText: string,
  pivotLanguages: string[],
  chainLabel: string
): Promise<{ result: string; error?: string }> {
  const shouldUppercase = isAllCaps(inputText);
  let current = shouldUppercase ? inputText.toLowerCase() : inputText;
  let fromLang = 'en';

  for (const targetLang of pivotLanguages) {
    if (targetLang === 'en') continue; // skip en mid-chain pivots
    try {
      const result = await translateText(current, targetLang, fromLang);
      if (!result || result.trim() === '') {
        logger.warn(`[${chainLabel}] Empty result translating to ${targetLang}, keeping previous`);
        continue;
      }
      current = result;
      fromLang = targetLang;
      logger.debug(`[${chainLabel}] ···${targetLang}: ${current.substring(0, 60)}…`);
    } catch (err) {
      logger.warn(`[${chainLabel}] Error at ${targetLang}: ${err}`);
      // continue with remaining languages
    }
  }

  // Always return to English
  if (fromLang !== 'en') {
    try {
      const finalEn = await translateText(current, 'en', fromLang);
      if (finalEn && finalEn.trim()) {
        current = finalEn;
      }
    } catch (err) {
      logger.warn(`[${chainLabel}] Failed final → en step: ${err}`);
    }
  }

  if (shouldUppercase) {
    current = current.toUpperCase();
  }

  return { result: current };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate all 4 translation candidates for a single tweet.
 * Chains run sequentially to avoid overloading LibreTranslate.
 * Returns candidates with humor/heuristic scores; best candidate is flagged.
 */
export async function generateCandidates(tweet: Tweet): Promise<Candidate[]> {
  const availableLangs = config.LANGUAGES.filter(l => l !== 'en');

  // Determine language paths for each of the 4 chains
  const chainDefs: { label: string; languages: string[] }[] = [
    { label: 'Random-1', languages: shuffleArray(availableLangs).slice(0, CANDIDATE_CHAIN_DEPTH) },
    { label: 'Random-2', languages: shuffleArray(availableLangs).slice(0, CANDIDATE_CHAIN_DEPTH) },
    { label: 'Random-3', languages: shuffleArray(availableLangs).slice(0, CANDIDATE_CHAIN_DEPTH) },
    {
      label: 'Oldschool',
      languages: (
        config.OLDSCHOOL_LANGUAGES.length > 0
          ? config.OLDSCHOOL_LANGUAGES.filter(l => l !== 'en')
          : shuffleArray(availableLangs)
      ).slice(0, CANDIDATE_CHAIN_DEPTH)
    },
  ];

  const candidates: Candidate[] = [];

  // Run chains sequentially
  for (let i = 0; i < chainDefs.length; i++) {
    const { label, languages } = chainDefs[i];
    logger.info(`[CANDIDATE_GEN] Chain ${i + 1}/4 "${label}" langs: ${languages.join('→')}`);

    let result = tweet.text;
    let error: string | undefined;

    try {
      const chainOut = await runChain(tweet.text, languages, label);
      result = chainOut.result;
      error = chainOut.error;
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
      error,
    });
  }

  // Score each candidate
  for (const candidate of candidates) {
    try {
      const humor = await scoreHumor(candidate.result, tweet.text);
      candidate.humorScore = Math.max(0, Math.min(1, humor.score));
    } catch {
      candidate.humorScore = 0;
    }

    try {
      const heuristics = evaluateHeuristics(candidate.result, tweet.text);
      // Normalise: heuristic scores can be negative (penalties); clamp to 0–1
      candidate.heuristicScore = Math.max(0, Math.min(1, (heuristics.score + 5) / 10));
    } catch {
      candidate.heuristicScore = 0;
    }

    candidate.combinedScore = 0.6 * candidate.humorScore + 0.4 * candidate.heuristicScore;
  }

  // Flag the single best candidate
  const bestIdx = candidates.reduce(
    (best, curr, idx) => curr.combinedScore > candidates[best].combinedScore ? idx : best,
    0
  );
  candidates[bestIdx].isBestCandidate = true;

  logger.info(
    `[CANDIDATE_GEN] Done. Best: "${candidates[bestIdx].chainLabel}" ` +
    `(score ${candidates[bestIdx].combinedScore.toFixed(3)})`
  );

  return candidates;
}
