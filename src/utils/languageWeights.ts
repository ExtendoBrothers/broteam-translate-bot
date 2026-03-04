// src/utils/languageWeights.ts
// Persistent language weight tracking for weighted random chain selection.
// Tracks per-language positive (manual user selection) and negative (failed
// acceptability check) counts, persisted to translation-logs/language-weights.json.
// Weights are used to bias the Fisher-Yates shuffle toward languages that have
// historically produced good results.

import * as fs from 'fs';
import * as path from 'path';
import { atomicWriteJsonSync, safeReadJsonSync } from './safeFileOps';

const WEIGHTS_FILE = path.join(process.cwd(), 'translation-logs', 'language-weights.json');

interface LangStats {
  positives: number;
  negatives: number;
}

type WeightsData = Record<string, LangStats>;

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function loadWeights(): WeightsData {
  return safeReadJsonSync<WeightsData>(WEIGHTS_FILE, {});
}

function saveWeights(data: WeightsData): void {
  const dir = path.dirname(WEIGHTS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  atomicWriteJsonSync(WEIGHTS_FILE, data);
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

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Weighted Fisher-Yates shuffle.
 * Languages with higher weights are more likely to appear early in the result.
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
