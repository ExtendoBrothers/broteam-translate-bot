#!/usr/bin/env node
/**
 * Auto-generate feedback for all pending translation entries.
 *
 * This follows AGENT_FEEDBACK_PROCESS.md and feedback-heuristics.md by:
 * - selecting the funniest candidate using heuristic-aware scoring
 * - assigning a 1-5 rating
 * - writing concise notes
 * - appending a batch section to agent-feedback-log.md
 */

const fs = require('fs');
const path = require('path');
const { atomicWriteTextSync } = require('../dist/src/utils/safeFileOps');

const FEEDBACK_PATH = path.join(process.cwd(), 'feedback-data.jsonl');
const LOG_PATH = path.join(process.cwd(), 'agent-feedback-log.md');
const USER_FEEDBACK_PREFIX = 'user';

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeLogText(text) {
  return String(text || '')
    .replace(/\r?\n/g, ' / ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasForeignFragments(text) {
  const value = String(text || '');
  for (let i = 0; i < value.length; i += 1) {
    if (value.charCodeAt(i) > 127) {
      return true;
    }
  }
  return false;
}

function hasSentenceLikeStructure(text) {
  const t = String(text || '').trim();
  if (!t) return false;

  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 5) return false;

  const hasVerb = /\b(is|are|was|were|be|been|being|have|has|had|do|does|did|can|could|will|would|should|must|go|goes|went|make|makes|made)\b/i.test(t);
  const hasNounyWord = /\b(i|you|he|she|we|they|man|woman|boy|girl|bro|people|guy|wife|husband|game|country|crime|life|god)\b/i.test(t);
  return hasVerb && hasNounyWord;
}

function looksIncoherent(text) {
  const t = String(text || '').trim();
  if (!t) return true;

  const words = t.split(/\s+/).filter(Boolean);
  if (words.length <= 1) return true;

  const alphaWords = words.filter(w => /[a-zA-Z]/.test(w)).length;
  if (alphaWords / words.length < 0.4) return true;

  const repeatedRuns = /(\b\w+\b)(?:\s+\1){2,}/i.test(t);
  if (repeatedRuns) return true;

  return false;
}

function hasNarrativeStructure(text) {
  const t = String(text || '');
  const words = t.split(/\s+/).filter(Boolean);
  return t.includes('\n') || words.length >= 14;
}

function hasSetupPunchlineShape(text) {
  const t = String(text || '');
  return /\?/.test(t) || /!/.test(t) || /\n/.test(t) || /:\s/.test(t);
}

function hasContradictionOrJuxtaposition(text) {
  const t = String(text || '').toLowerCase();
  const connectors = ['but', 'however', 'yet', 'although', 'though', 'still'];
  if (connectors.some(c => t.includes(c))) return true;

  const contradictionPairs = [
    ['good', 'crime'],
    ['love', 'hate'],
    ['safe', 'danger'],
    ['normal', 'insane'],
    ['happy', 'sick'],
    ['smart', 'stupid']
  ];

  return contradictionPairs.some(([a, b]) => t.includes(a) && t.includes(b));
}

function humorThemeHits(text) {
  const t = String(text || '').toLowerCase();
  const themes = [
    'crime', 'politic', 'trump', 'canada', 'girl', 'women', 'wife',
    'boy', 'sex', 'anal', 'autism', 'incel', 'chad', 'game', 'gaming',
    'bro', 'gym', 'beer', 'god', 'debt', 'conspiracy', 'kill', 'dictator'
  ];
  return themes.filter(theme => t.includes(theme)).length;
}

function crudeThemeHit(text) {
  const t = String(text || '').toLowerCase();
  return /\b(sex|anal|nude|naked|whore|dick|balls|cum|horny|pervert)\b/.test(t);
}

function scoreCandidate(candidate, originalText) {
  const result = String(candidate?.result || '');
  const original = String(originalText || '');

  const sourceScore = typeof candidate?.humorScore === 'number' ? candidate.humorScore : 0;
  const normalizedResult = normalizeText(result);
  const normalizedOriginal = normalizeText(original);

  let score = sourceScore;
  const reasons = [];

  const identicalToInput = normalizedResult && normalizedResult === normalizedOriginal;
  if (identicalToInput) {
    score -= 2.0;
    reasons.push('too close to original');
  }

  if (hasNarrativeStructure(result)) {
    score += 0.3;
    reasons.push('has narrative structure');
  }

  if (hasSetupPunchlineShape(result)) {
    score += 0.25;
    reasons.push('has setup/punchline shape');
  }

  if (hasSentenceLikeStructure(result)) {
    score += 0.2;
    reasons.push('complete sentence structure');
  }

  if (hasContradictionOrJuxtaposition(result)) {
    score += 0.35;
    reasons.push('uses contradiction/juxtaposition');
  }

  const themeCount = humorThemeHits(result);
  if (themeCount > 0) {
    score += Math.min(0.3, themeCount * 0.07);
    reasons.push('includes humor themes');
  }

  if (crudeThemeHit(result)) {
    score += 0.12;
    reasons.push('dirty/crude punchline energy');
  }

  if (result.length > 0 && result.length < 25) {
    score -= 0.22;
    reasons.push('too short');
  }

  if (result.length >= 120) {
    score += 0.08;
    reasons.push('detailed phrasing');
  }

  if (result.length >= 180) {
    score += 0.12;
    reasons.push('extended narrative payoff');
  }

  if (result.length >= 250) {
    score += 0.15;
    reasons.push('long-form absurd story');
  }

  if (result.trim().split(/\s+/).length < 8) {
    score -= 0.12;
    reasons.push('fragment-length phrasing');
  }

  if (looksIncoherent(result)) {
    score -= 0.55;
    reasons.push('incoherent or fragmentary');
  }

  if (hasForeignFragments(result)) {
    score -= 0.12;
    reasons.push('foreign fragments reduce clarity');
  }

  if (/(\b\w+\b)(?:\s+\1){3,}/i.test(result)) {
    score -= 0.35;
    reasons.push('maniacal repetition without payoff');
  }

  if (/\b\w+\b(?:\s+\b\w+\b){0,1}$/.test(result.trim()) && result.trim().split(/\s+/).length <= 2) {
    score -= 0.1;
    reasons.push('single-word or tiny phrase');
  }

  return {
    score,
    reasons,
    identicalToInput,
    incoherent: looksIncoherent(result)
  };
}

function pickRating(analysis) {
  if (analysis.identicalToInput) return 1;
  if (analysis.incoherent && analysis.score < 0.25) return 1;

  if (analysis.score >= 1.0) return 5;
  if (analysis.score >= 0.72) return 4;
  if (analysis.score >= 0.45) return 3;
  if (analysis.score >= 0.15) return 2;
  return 1;
}

function buildNotes(bestAnalysis) {
  const reasons = bestAnalysis.reasons.slice(0, 2);
  if (reasons.length === 0) {
    return 'best available option with comparatively stronger coherence and humor signal';
  }
  return reasons.join('; ');
}

function readJsonl(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(line => line.trim())
    .map(line => JSON.parse(line));
}

function writeJsonl(filePath, entries) {
  const serialized = entries.map(entry => JSON.stringify(entry)).join('\n') + '\n';
  const writeOk = atomicWriteTextSync(filePath, serialized);
  if (!writeOk) {
    throw new Error(`Failed to atomically write JSONL file: ${filePath}`);
  }
}

function toEntryLog(entry, generatedFeedback) {
  const original = escapeLogText(entry.originalText);
  const selected = escapeLogText(entry.selectedResult);
  const notes = escapeLogText(generatedFeedback.notes);

  return [
    `## Tweet ${entry.tweetId}`,
    `**Original:** ${original}`,
    `**Bot Selected:** ${entry.botSelected} - "${selected}"`,
    `**Rating:** ${generatedFeedback.rating}/5`,
    `**Best:** ${generatedFeedback.actualBest}`,
    `**Notes:** "${notes}"`,
    ''
  ].join('\n');
}

function main() {
  const args = new Set(process.argv.slice(2));
  const regradeExisting = args.has('--regrade-existing');
  const includeUserFeedback = args.has('--include-user-feedback');
  const dryRun = args.has('--dry-run');

  if (!fs.existsSync(FEEDBACK_PATH)) {
    console.error('feedback-data.jsonl not found.');
    process.exit(1);
  }

  const allEntries = readJsonl(FEEDBACK_PATH);
  const pending = allEntries.filter(entry => entry.userFeedback === null);

  if (!regradeExisting && pending.length === 0) {
    console.log('No pending feedback.');
    return;
  }

  const now = new Date().toISOString();
  const ratingBuckets = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const processedTweetIds = [];
  const perTweetLogs = [];
  let skippedUserFeedback = 0;

  for (const entry of allEntries) {
    const existingSource = String(entry.userFeedback?.feedbackSource || '').toLowerCase();
    const isUserFeedback = existingSource.startsWith(USER_FEEDBACK_PREFIX);

    if (!regradeExisting && entry.userFeedback !== null) continue;
    if (regradeExisting && !includeUserFeedback && isUserFeedback) {
      skippedUserFeedback++;
      continue;
    }

    const analyses = (entry.candidates || []).map(candidate => ({
      candidate,
      analysis: scoreCandidate(candidate, entry.originalText)
    }));

    if (analyses.length === 0) {
      const fallbackFeedback = {
        providedAt: now,
        feedbackSource: 'agent-auto',
        learningEligible: false,
        rating: 1,
        actualBest: entry.botSelected || 'UNKNOWN',
        wasCorrect: true,
        notes: 'no candidate set available, defaulting to lowest confidence feedback'
      };
      entry.userFeedback = fallbackFeedback;
      ratingBuckets[1] += 1;
      processedTweetIds.push(entry.tweetId);
      perTweetLogs.push(toEntryLog(entry, fallbackFeedback));
      continue;
    }

    analyses.sort((a, b) => b.analysis.score - a.analysis.score);
    const winner = analyses[0];
    const rating = pickRating(winner.analysis);

    const actualBest = winner.candidate.source;
    const wasCorrect = String(actualBest || '').toLowerCase() === String(entry.botSelected || '').toLowerCase();
    const notes = buildNotes(winner.analysis);

    const generatedFeedback = {
      providedAt: now,
      feedbackSource: 'agent-auto',
      learningEligible: false,
      rating,
      actualBest,
      wasCorrect,
      notes
    };

    entry.userFeedback = generatedFeedback;
    ratingBuckets[rating] += 1;
    processedTweetIds.push(entry.tweetId);
    perTweetLogs.push(toEntryLog(entry, generatedFeedback));
  }

  if (!dryRun) {
    writeJsonl(FEEDBACK_PATH, allEntries);
  }

  const logHeader = [
    '',
    `# Batch ${new Date().toISOString().slice(0, 10)} - Agent Feedback (${processedTweetIds.length} pending tweets)`,
    '',
    `Generated at: ${now}`,
    `Ratings: 1=${ratingBuckets[1]}, 2=${ratingBuckets[2]}, 3=${ratingBuckets[3]}, 4=${ratingBuckets[4]}, 5=${ratingBuckets[5]}`,
    ''
  ].join('\n');

  if (!dryRun) {
    fs.appendFileSync(LOG_PATH, logHeader + perTweetLogs.join('\n'), 'utf8');
  }

  console.log(JSON.stringify({
    mode: regradeExisting ? 'regrade-existing' : 'pending-only',
    includeUserFeedback,
    dryRun,
    processed: processedTweetIds.length,
    skippedUserFeedback,
    ratings: ratingBuckets,
    logPath: path.basename(LOG_PATH)
  }, null, 2));
}

main();
