// src/utils/languageWeights.ts
// Persistent language weight tracking for weighted random chain selection.
// Tracks per-language positive (manual user selection) and negative (failed
// acceptability check) counts, persisted to translation-logs/language-weights.json.
// Weights are used to bias the Fisher-Yates shuffle toward languages that have
// historically produced good results.
//
// Write strategy: updates are accumulated in an in-memory cache and flushed to
// disk with a 200ms debounce, matching the monthlyUsageTracker pattern. This
// avoids blocking synchronous file I/O on every retry in the chain loop.
// In test environments (NODE_ENV=test) the flush happens synchronously so that
// existing test assertions remain unaffected.

import * as fs from 'fs';
import * as path from 'path';
import { atomicWriteJsonSync, safeReadJsonSync } from './safeFileOps';
import { onShutdown } from './gracefulShutdown';

const WEIGHTS_FILE = path.join(process.cwd(), 'translation-logs', 'language-weights.json');
const DEBOUNCE_MS  = 200;
const isTestEnv    = process.env.NODE_ENV === 'test';

interface LangStats {
  positives: number;
  negatives: number;
}

type WeightsData = Record<string, LangStats>;

// ─────────────────────────────────────────────────────────────────────────────
// In-memory cache
// ─────────────────────────────────────────────────────────────────────────────

let memCache: WeightsData | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function loadWeights(): WeightsData {
  if (memCache === null) {
    memCache = safeReadJsonSync<WeightsData>(WEIGHTS_FILE, {});
  }
  // Return a deep copy so callers can mutate freely without corrupting the cache
  return JSON.parse(JSON.stringify(memCache)) as WeightsData;
}

/**
 * Flush the in-memory cache to disk immediately (synchronous).
 * Used by the debounce timer, graceful shutdown, and test mode.
 */
export function flushWeights(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (memCache === null) return;
  const dir = path.dirname(WEIGHTS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  atomicWriteJsonSync(WEIGHTS_FILE, memCache);
}

function saveWeights(data: WeightsData): void {
  // Commit changes back into the cache
  memCache = data;

  if (isTestEnv) {
    // Flush synchronously in tests so assertions don't need fake timers
    flushWeights();
    return;
  }

  // Debounce disk writes to avoid blocking the event loop during retry loops
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushWeights, DEBOUNCE_MS);
}

function ensureLang(data: WeightsData, lang: string): void {
  if (!data[lang]) {
    data[lang] = { positives: 0, negatives: 0 };
  }
}

/**
 * Compute the selection weight for a language.
 * Weight = max(0.1, 1.0 + positives * 0.04 - negatives * 0.01)
 * A language with no history has weight 1.0 (neutral).
 * Each positive nudges the weight up by 0.04; each negative nudges it down by 0.01.
 * One positive therefore absorbs 4 retries. Minimum weight is 0.1 (reached after
 * 90 net negatives) so all languages stay in the pool permanently.
 */
function computeWeight(stats: LangStats): number {
  return Math.max(0.1, 1.0 + stats.positives * 0.04 - stats.negatives * 0.01);
}

// Register a graceful-shutdown handler to flush any pending debounced write
if (!isTestEnv) {
  onShutdown(async () => { flushWeights(); });
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Weighted random permutation via iterated weighted selection without replacement.
 * Each round a language is drawn with probability proportional to its weight,
 * then removed from the pool; this biases higher-weight languages toward the
 * front of the result without ever excluding any language.
 * Uses persistent stats if available; falls back to uniform weight 1.0 for
 * any language not yet recorded.
 */
export function weightedShuffle(langs: string[]): string[] {
  if (langs.length === 0) return [];

  const data = loadWeights();

  // Build a mutable list of [lang, weight] pairs
  const pool: Array<{ lang: string; weight: number }> = langs.map(l => ({
    lang: l,
    weight: data[l] ? computeWeight(data[l]) : 1.0,
  }));

  const result: string[] = [];

  while (pool.length > 0) {
    // Pick one entry from pool with probability proportional to weight
    const totalWeight = pool.reduce((sum, e) => sum + e.weight, 0);
    const rand = Math.random() * totalWeight;
    let cumulative = 0;
    let chosen = 0;
    for (let i = 0; i < pool.length; i++) {
      cumulative += pool[i].weight;
      if (rand <= cumulative) {
        chosen = i;
        break;
      }
    }
    result.push(pool[chosen].lang);
    pool.splice(chosen, 1);
  }

  return result;
}

/**
 * Record positive signals for a set of languages.
 * Called when the user manually selects a candidate that used these languages.
 */
export function recordPositives(langs: string[]): void {
  if (!langs.length) return;
  const data = loadWeights();
  for (const lang of langs) {
    if (lang === 'en') continue; // English is always present; don't bias it
    ensureLang(data, lang);
    data[lang].positives += 1;
  }
  saveWeights(data);
}

/**
 * Record negative signals for a set of languages.
 * Called when a chain attempt fails the acceptability check and must be retried.
 */
export function recordNegatives(langs: string[]): void {
  if (!langs.length) return;
  const data = loadWeights();
  for (const lang of langs) {
    if (lang === 'en') continue;
    ensureLang(data, lang);
    data[lang].negatives += 1;
  }
  saveWeights(data);
}

/**
 * Return the computed weight for each language in the given list.
 * Reads from the in-memory cache so no disk I/O occurs after the first load.
 * More efficient than getWeightsSnapshot() when only a subset of languages is needed
 * (e.g. logging weights for the current chain's language list in a retry loop).
 */
export function getWeightsForLangs(langs: string[]): Record<string, number> {
  // Access cache directly to avoid a redundant deep-copy of all stored entries
  const data = memCache ?? safeReadJsonSync<WeightsData>(WEIGHTS_FILE, {});
  const out: Record<string, number> = {};
  for (const lang of langs) {
    if (lang === 'en') continue;
    out[lang] = data[lang] ? computeWeight(data[lang]) : 1.0;
  }
  return out;
}

/**
 * Return the current weights snapshot (for admin/dashboard inspection).
 */
export function getWeightsSnapshot(): Record<string, { positives: number; negatives: number; weight: number }> {
  const data = loadWeights();
  const out: Record<string, { positives: number; negatives: number; weight: number }> = {};
  for (const [lang, stats] of Object.entries(data)) {
    out[lang] = { ...stats, weight: computeWeight(stats) };
  }
  return out;
}

/**
 * Reset the in-memory cache. For use in unit tests only.
 * @internal
 */
export function _resetCacheForTesting(): void {
  memCache = null;
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
}
