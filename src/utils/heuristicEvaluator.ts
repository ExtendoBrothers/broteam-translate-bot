/**
 * Unified heuristic evaluator — single source of truth for all quality/humor heuristics.
 *
 * Returns a signed offset that is added to the ML humor score to produce the
 * final score:  finalScore = clamp(humorScore + offset, 0, 1)
 *
 * Rule weights are loaded from `heuristic-weights.json` (created on first run
 * with sensible defaults).  Weights are updated automatically when user
 * selections diverge from the bot's pick — see `updateWeightsFromFeedback()`.
 */

import fs from 'fs';
import path from 'path';
import { logger } from './logger';
import { atomicWriteJsonSync } from './safeFileOps';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface HeuristicResult {
  /** Signed offset to add to ML humor score */
  offset: number;
  /** Human-readable explanations of rules that fired */
  details: string[];
  /** Per-rule breakdown: which rules fired and their contribution */
  rules: Record<string, { fired: boolean; contribution: number }>;
}

/** Backward-compatible alias used by existing callers */
export interface HeuristicScore {
  score: number;
  details: string[];
}

interface RuleWeight {
  weight: number;
  wins: number;
  losses: number;
}

type WeightsMap = Record<string, RuleWeight>;

// ─────────────────────────────────────────────────────────────────────────────
// Weight persistence
// ─────────────────────────────────────────────────────────────────────────────

const WEIGHTS_PATH = path.join(process.cwd(), 'heuristic-weights.json');

const DEFAULT_WEIGHTS: WeightsMap = {
  // ── Structure ──────────────────────────────────────────────────────────
  sentenceStructure:    { weight: 0.04,  wins: 0, losses: 0 },
  setupPunchline:       { weight: 0.03,  wins: 0, losses: 0 },
  narrativeStructure:   { weight: 0.06,  wins: 0, losses: 0 },
  completeThought:      { weight: 0.02,  wins: 0, losses: 0 },
  hasQuestion:          { weight: 0.02,  wins: 0, losses: 0 },
  shortPunchy:          { weight: 0.02,  wins: 0, losses: 0 },
  lengthBonus:          { weight: 0.04,  wins: 0, losses: 0 },

  // ── Humor signals ─────────────────────────────────────────────────────
  contradiction:        { weight: 0.08,  wins: 0, losses: 0 },
  absurdity:            { weight: 0.04,  wins: 0, losses: 0 },
  exaggeration:         { weight: 0.03,  wins: 0, losses: 0 },
  surprise:             { weight: 0.03,  wins: 0, losses: 0 },
  selfDeprecation:      { weight: 0.04,  wins: 0, losses: 0 },
  dirtyInnuendo:        { weight: 0.03,  wins: 0, losses: 0 },
  darkEdgy:             { weight: 0.03,  wins: 0, losses: 0 },
  impossibleConcept:    { weight: 0.04,  wins: 0, losses: 0 },

  // ── Thematic ──────────────────────────────────────────────────────────
  idealSubjects:        { weight: 0.02,  wins: 0, losses: 0 },
  broteamThemes:        { weight: 0.025, wins: 0, losses: 0 },
  gamingCulture:        { weight: 0.02,  wins: 0, losses: 0 },
  humorKeywords:        { weight: 0.02,  wins: 0, losses: 0 },
  sarcasmIndicators:    { weight: 0.02,  wins: 0, losses: 0 },
  technicalGibberish:   { weight: 0.02,  wins: 0, losses: 0 },

  // ── Chain preference ──────────────────────────────────────────────────
  oldschoolChain:       { weight: 0.05,  wins: 0, losses: 0 },

  // ── Penalties (negative weights) ──────────────────────────────────────
  singleWord:           { weight: -0.08, wins: 0, losses: 0 },
  tooShort:             { weight: -0.05, wins: 0, losses: 0 },
  tooSimilar:           { weight: -0.06, wins: 0, losses: 0 },
  noVerbs:              { weight: -0.04, wins: 0, losses: 0 },
  lowDiversity:         { weight: -0.05, wins: 0, losses: 0 },
  foreignFragments:     { weight: -0.03, wins: 0, losses: 0 },
  spamRepetition:       { weight: -0.10, wins: 0, losses: 0 },
  incoherent:           { weight: -0.06, wins: 0, losses: 0 },
  garbagePunctuation:   { weight: -0.04, wins: 0, losses: 0 },
};

let _weights: WeightsMap | null = null;

function loadWeights(): WeightsMap {
  if (_weights) return _weights;
  try {
    if (fs.existsSync(WEIGHTS_PATH)) {
      const raw = JSON.parse(fs.readFileSync(WEIGHTS_PATH, 'utf8')) as WeightsMap;
      _weights = { ...(JSON.parse(JSON.stringify(DEFAULT_WEIGHTS)) as WeightsMap) };
      for (const [key, val] of Object.entries(raw)) {
        if (_weights[key]) {
          _weights[key] = { ..._weights[key], ...val };
        } else {
          _weights[key] = val;
        }
      }
      logger.debug('[Heuristic] Loaded weights from heuristic-weights.json');
      return _weights;
    }
  } catch (e) {
    logger.warn('[Heuristic] Failed to load weights, using defaults:', e);
  }
  _weights = JSON.parse(JSON.stringify(DEFAULT_WEIGHTS)) as WeightsMap;
  saveWeights(_weights);
  return _weights;
}

function saveWeights(w: WeightsMap): void {
  try {
    atomicWriteJsonSync(WEIGHTS_PATH, w);
  } catch (e) {
    logger.warn('[Heuristic] Failed to save weights:', e);
  }
}

/** Force reload from disk (e.g. after external edit) */
export function reloadWeights(): void {
  _weights = null;
  loadWeights();
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: word overlap similarity
// ─────────────────────────────────────────────────────────────────────────────

function wordOverlap(a: string, b: string): number {
  const wa = a.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const wb = b.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  if (wa.length === 0 || wb.length === 0) return 0;
  const setB = new Set(wb);
  const common = wa.filter(w => setB.has(w)).length;
  return common / Math.max(wa.length, wb.length);
}

// ─────────────────────────────────────────────────────────────────────────────
// Core evaluator
// ─────────────────────────────────────────────────────────────────────────────

export interface EvaluateOptions {
  chainLabel?: string;
}

/**
 * Evaluate a translation result against the full heuristic ruleset.
 * Returns a signed offset and a per-rule breakdown.
 */
export function evaluateHeuristics(
  result: string,
  original: string,
  opts: EvaluateOptions = {},
): HeuristicResult {
  const w = loadWeights();
  const text = result.trim();
  const lowerText = text.toLowerCase();
  const words = lowerText.split(/\s+/).filter(s => s.length > 0);

  const rules: Record<string, { fired: boolean; contribution: number }> = {};
  const details: string[] = [];
  let offset = 0;

  function fire(rule: string, multiplier = 1): void {
    const rw = w[rule];
    if (!rw) return;
    const contribution = rw.weight * multiplier;
    rules[rule] = { fired: true, contribution };
    offset += contribution;
    const sign = contribution >= 0 ? '+' : '';
    details.push(`${rule} ${sign}${contribution.toFixed(4)}`);
  }
  function skip(rule: string): void {
    rules[rule] = { fired: false, contribution: 0 };
  }

  // ── Structure ──────────────────────────────────────────────────────────

  if (/[.!?]$/.test(text) || text.includes('?') || (text === text.toUpperCase() && text.length > 5)) {
    fire('sentenceStructure');
  } else { skip('sentenceStructure'); }

  if (text.includes(':') || text.includes(' - ') || /[,;]/.test(text)) {
    fire('setupPunchline');
  } else { skip('setupPunchline'); }

  if (/\n\n/.test(text) || /\n.*\n/.test(text)) {
    fire('narrativeStructure');
  } else { skip('narrativeStructure'); }

  if (/\b\w+\s+\w+\b/.test(text)) {
    fire('completeThought');
  } else { skip('completeThought'); }

  if (text.includes('?')) {
    fire('hasQuestion');
  } else { skip('hasQuestion'); }

  if (text.length > 0 && text.length < 100) {
    fire('shortPunchy');
  } else { skip('shortPunchy'); }

  if (text.length > 30) {
    fire('lengthBonus', Math.min(1, (text.length - 30) / 100));
  } else { skip('lengthBonus'); }

  // ── Humor signals ─────────────────────────────────────────────────────

  const contradictions = [
    /\b(nice|good|delicious)\b.*\b(crime|bad|evil)\b/,
    /\b(smart|intelligent)\b.*\b(stupid|dumb)\b/,
    /\b(fast|quick)\b.*\b(slow)\b/,
    /\b(hot)\b.*\b(cold)\b/,
    /nice.*crime/i, /more.*marketing/i, /delicious.*crime/i,
    /god.*send/i, /computer.*autism/i, /big.*man/i,
  ];
  if (contradictions.some(p => p.test(lowerText))) {
    fire('contradiction');
  } else { skip('contradiction'); }

  if (/\b(absurd|ridiculous|nonsensical|insane|crazy|delusional|wtf|omg)\b/.test(lowerText)) {
    fire('absurdity');
  } else { skip('absurdity'); }

  if (/\b(million|billion|trillion|infinite|endless|eternal|ultimate|supreme)\b/.test(lowerText)) {
    fire('exaggeration');
  } else { skip('exaggeration'); }

  if (/!{2,}/.test(text) || /\b(suddenly|unexpectedly)\b/.test(lowerText)) {
    fire('surprise');
  } else { skip('surprise'); }

  const hasFirstPerson = /\b(i|me|my|mine)\b/.test(lowerText);
  const hasNegativeSelf = /\b(stupid|dumb|autistic|idiot|moron|retard)\b/.test(lowerText);
  const hasSelfCriticism = /\b(gave myself|have given myself|am)\b.*\b(autism|stupid|dumb)\b/.test(lowerText);
  if ((hasFirstPerson && hasNegativeSelf) || hasSelfCriticism) {
    fire('selfDeprecation');
  } else { skip('selfDeprecation'); }

  const dirtyTerms = ['sex', 'fuck', 'dick', 'pussy', 'ass', 'tits', 'cock', 'cum', 'blowjob'];
  const dirtyCount = dirtyTerms.filter(t => lowerText.includes(t)).length;
  if (dirtyCount > 0) { fire('dirtyInnuendo', dirtyCount); } else { skip('dirtyInnuendo'); }

  const darkTerms = ['theft', 'ugly', 'dictator', 'molested', 'dark', 'edgy'];
  const darkCount = darkTerms.filter(t => lowerText.includes(t)).length;
  if (darkCount > 0) { fire('darkEdgy', darkCount); } else { skip('darkEdgy'); }

  if (/\b(flying pigs|square circle|cold heat|dark light)\b/.test(lowerText)) {
    fire('impossibleConcept');
  } else { skip('impossibleConcept'); }

  // ── Thematic ──────────────────────────────────────────────────────────

  const idealSubjects = [
    'politics', 'crime', 'games', 'extreme', 'conversation', 'indignant', 'gregarious',
    'irony', 'juxtaposed', 'self-deprecation', 'self-doubt', 'reality', 'race', 'color',
    'ethnicity', 'countries', 'canada', 'canadian', 'sexual', 'anatomy', 'current events',
    'gamergate', 'social justice', 'trump', 'leftism', 'rightism', 'autism', 'incels',
    'marketing', 'godsend',
  ];
  const subjectCount = idealSubjects.filter(s => lowerText.includes(s)).length;
  if (subjectCount > 0) { fire('idealSubjects', subjectCount); } else { skip('idealSubjects'); }

  const broSubjects = [
    'gym', 'protein', 'beer', 'gaming', 'pickup', 'chad', 'incel', 'redpilled',
    'bro science', 'masculinity', 'confidence', 'insecurity',
  ];
  const broCount = broSubjects.filter(s => lowerText.includes(s)).length;
  if (broCount > 0) { fire('broteamThemes', broCount); } else { skip('broteamThemes'); }

  const gamingTerms = ['streaming', 'girls', 'mdickie', 'gaming', 'stream'];
  const gamingCount = gamingTerms.filter(t => lowerText.includes(t)).length;
  if (gamingCount > 0) { fire('gamingCulture', gamingCount); } else { skip('gamingCulture'); }

  const humorKw = [
    'lol', 'lmao', 'rofl', 'haha', 'hehe', 'lmfao', '😂', '🤣', '😭',
    'joke', 'funny', 'hilarious', 'ridiculous', 'bro', 'dude',
    'fucking', 'shit', 'damn', 'hell', 'crazy', 'bitch',
  ];
  const kwCount = Math.min(3, humorKw.filter(k => lowerText.includes(k)).length);
  if (kwCount > 0) { fire('humorKeywords', kwCount); } else { skip('humorKeywords'); }

  const sarcasmList = ['yeah right', 'sure', 'totally', 'obviously', 'clearly',
    'great', 'perfect', 'wonderful', 'amazing'];
  if (sarcasmList.some(s => lowerText.includes(s))) {
    fire('sarcasmIndicators');
  } else { skip('sarcasmIndicators'); }

  if (/\b(int|leds|function|class|var|const|let|if|for|while|array|object)\b/.test(lowerText) || /[{}();=<>]/.test(text)) {
    fire('technicalGibberish');
  } else { skip('technicalGibberish'); }

  // ── Chain preference ──────────────────────────────────────────────────

  if (opts.chainLabel === 'Oldschool') {
    fire('oldschoolChain');
  } else { skip('oldschoolChain'); }

  // ── Penalties ─────────────────────────────────────────────────────────

  if (words.length === 1) { fire('singleWord'); } else { skip('singleWord'); }

  if (text.length < 10 && !/[.!?]/.test(text)) { fire('tooShort'); } else { skip('tooShort'); }

  const similarity = wordOverlap(text, original);
  if (similarity > 0.8) { fire('tooSimilar'); } else { skip('tooSimilar'); }

  const verbPattern = /\b(is|are|was|were|has|have|had|do|does|did|will|would|can|could|should|may|might|go|run|eat|drink|fuck|kill|die)\b/;
  if (!verbPattern.test(lowerText) && words.length > 3) { fire('noVerbs'); } else { skip('noVerbs'); }

  const uniqueRatio = words.length > 0 ? new Set(words).size / words.length : 1;
  if (uniqueRatio < 0.5 && words.length > 5) {
    fire('lowDiversity');
  } else if (uniqueRatio < 0.7 && words.length > 5) {
    fire('lowDiversity', 0.5);
  } else { skip('lowDiversity'); }

  if (/[áéíóúñ¿¡]/.test(text) || /[\u0400-\u04FF]/.test(text) ||
      /[\u0600-\u06FF]/.test(text) || /[\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF]/.test(text)) {
    fire('foreignFragments');
  } else { skip('foreignFragments'); }

  const spamPatterns = [/(\w+)\s+\1\s+\1/, /(\w{3,})\s+\1\s+\1\s+\1/, /(.)\1{4,}/];
  if (spamPatterns.some(p => p.test(text))) {
    fire('spamRepetition');
  } else { skip('spamRepetition'); }

  const nonWordChars = (text.match(/[^\w\s.,!?-]/g) || []).length;
  const shortOnlyWords = (text.match(/\b\w{1,2}\b/g) || []).length;
  if (nonWordChars > words.length * 0.4 || (shortOnlyWords > words.length * 0.6 && words.length > 3)) {
    fire('incoherent');
  } else { skip('incoherent'); }

  if (/[^\w\s]{4,}/.test(text)) { fire('garbagePunctuation'); } else { skip('garbagePunctuation'); }

  return { offset, details, rules };
}

// ─────────────────────────────────────────────────────────────────────────────
// Feedback-based weight learning
// ─────────────────────────────────────────────────────────────────────────────

const LEARNING_RATE = 0.002;

/**
 * Update weights based on user selection.  Call this when the user picks a
 * candidate that differs from the bot's pick.
 *
 * @param winnerRules  Rules map from the candidate the user chose
 * @param loserRules   Rules map from the candidate the bot chose
 */
export function updateWeightsFromFeedback(
  winnerRules: Record<string, { fired: boolean; contribution: number }>,
  loserRules: Record<string, { fired: boolean; contribution: number }>,
): void {
  const w = loadWeights();
  let changed = false;

  for (const rule of Object.keys(w)) {
    const wonFired = winnerRules[rule]?.fired ?? false;
    const lostFired = loserRules[rule]?.fired ?? false;

    if (wonFired) w[rule].wins++;
    if (lostFired) w[rule].losses++;

    // Nudge: rules on winners but not losers get boosted; opposite gets dampened.
    if (wonFired && !lostFired) {
      w[rule].weight += LEARNING_RATE;
      changed = true;
    } else if (lostFired && !wonFired) {
      w[rule].weight -= LEARNING_RATE;
      changed = true;
    }
  }

  if (changed) {
    saveWeights(w);
    _weights = w;
    logger.info('[Heuristic] Updated weights from user feedback');
  }
}

/** Get current weights (for diagnostics / dashboard). */
export function getWeights(): Readonly<WeightsMap> {
  return loadWeights();
}