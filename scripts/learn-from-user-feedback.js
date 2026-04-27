#!/usr/bin/env node
/**
 * Replay heuristic learning using user-selected winners from feedback-data.jsonl.
 *
 * Default behavior is conservative and user-centric:
 * - only entries with userFeedback.actualBest are considered
 * - only user-sourced feedback is included (feedbackSource starts with "user")
 *
 * Flags:
 *   --dry-run                  compute learning summary without writing weights
 *   --include-legacy-unknown   also include entries with missing feedbackSource
 */

const fs = require('fs');
const path = require('path');
const { atomicWriteJsonSync } = require('../dist/src/utils/safeFileOps');

const FEEDBACK_PATH = path.join(process.cwd(), 'feedback-data.jsonl');
const WEIGHTS_PATH = path.join(process.cwd(), 'heuristic-weights.json');
const LEARNING_RATE = 0.002;

function readJsonl(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const entries = [];

  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      entries.push(JSON.parse(line));
    } catch {
      // Skip malformed JSONL records so one bad line does not abort learning.
    }
  }

  return entries;
}

function shouldUseFeedback(userFeedback, includeLegacyUnknown) {
  if (!userFeedback || !userFeedback.actualBest) return false;

  const source = String(userFeedback.feedbackSource || '').toLowerCase();
  if (source.startsWith('user')) return true;
  if (!source && includeLegacyUnknown) return true;
  return false;
}

function applyEventLearning(weights, entry, actualBest) {
  const winnerCandidate = (entry.candidates || []).find(c => c.source === actualBest);
  if (!winnerCandidate) {
    return { changed: false, reason: 'winner-not-found' };
  }

  const loserCandidates = (entry.candidates || []).filter(c => c.source !== actualBest);
  if (loserCandidates.length === 0) {
    return { changed: false, reason: 'no-losers' };
  }

  const winnerRules = winnerCandidate.heuristicRules || {};
  const anyLoserHasRules = loserCandidates.some(c => Object.keys(c.heuristicRules || {}).length > 0);
  const hasRuleData = Object.keys(winnerRules).length > 0 || anyLoserHasRules;

  let changed = false;

  if (hasRuleData) {
    // Full per-rule learning: nudge every rule based on winner vs loser firing pattern.
    for (const rule of Object.keys(weights)) {
      const wonFired = winnerRules[rule]?.fired ?? false;
      const lostFired = loserCandidates.some(c => (c.heuristicRules || {})[rule]?.fired ?? false);

      if (wonFired) weights[rule].wins++;
      if (lostFired) weights[rule].losses++;

      if (wonFired && !lostFired) {
        weights[rule].weight += LEARNING_RATE;
        changed = true;
      } else if (lostFired && !wonFired) {
        weights[rule].weight -= LEARNING_RATE;
        changed = true;
      }
    }
  } else {
    // Pre-refactor fallback: no per-candidate rule data, but the user's chain
    // preference is still a meaningful signal.
    // Win: user chose OLDSCHOOL → bump oldschoolChain weight.
    // Loss: user chose a RANDOM chain when OLDSCHOOL was an option → dampen it.
    const oldschoolKey = 'oldschoolChain';
    if (weights[oldschoolKey]) {
      const winnerIsOldschool = String(actualBest).toUpperCase() === 'OLDSCHOOL';
      const oldschoolWasOption = loserCandidates.some(c => String(c.source).toUpperCase() === 'OLDSCHOOL')
        || winnerIsOldschool;

      if (oldschoolWasOption) {
        if (winnerIsOldschool) {
          weights[oldschoolKey].wins++;
          weights[oldschoolKey].weight += LEARNING_RATE;
          changed = true;
        } else {
          weights[oldschoolKey].losses++;
          weights[oldschoolKey].weight -= LEARNING_RATE;
          changed = true;
        }
      }
    }
  }

  return { changed, reason: changed ? 'updated' : 'same-rules', usedRuleData: hasRuleData };
}

function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has('--dry-run');
  const includeLegacyUnknown = args.has('--include-legacy-unknown');

  if (!fs.existsSync(FEEDBACK_PATH)) {
    console.error('feedback-data.jsonl not found.');
    process.exit(1);
  }
  if (!fs.existsSync(WEIGHTS_PATH)) {
    console.error('heuristic-weights.json not found.');
    process.exit(1);
  }

  const entries = readJsonl(FEEDBACK_PATH);
  let weights;
  try {
    weights = JSON.parse(fs.readFileSync(WEIGHTS_PATH, 'utf8'));
  } catch (error) {
    console.error(`Failed to read or parse ${WEIGHTS_PATH}: ${error.message}`);
    process.exit(1);
  }

  let considered = 0;
  let updated = 0;
  let skippedNoBest = 0;
  let skippedNotUser = 0;
  let updatedViaRuleData = 0;
  let updatedViaChainFallback = 0;

  for (const entry of entries) {
    const feedback = entry.userFeedback;

    if (!feedback || !feedback.actualBest) {
      skippedNoBest++;
      continue;
    }

    if (!shouldUseFeedback(feedback, includeLegacyUnknown)) {
      skippedNotUser++;
      continue;
    }

    considered++;
    const res = applyEventLearning(weights, entry, feedback.actualBest);
    if (res.changed) {
      updated++;
      if (res.usedRuleData) updatedViaRuleData++;
      else updatedViaChainFallback++;
    }
  }

  if (!dryRun) {
    const writeOk = atomicWriteJsonSync(WEIGHTS_PATH, weights);
    if (!writeOk) {
      console.error(`Failed to persist updated weights to ${WEIGHTS_PATH}.`);
      process.exit(1);
    }
  }

  console.log(JSON.stringify({
    dryRun,
    includeLegacyUnknown,
    learningRate: LEARNING_RATE,
    considered,
    updated,
    updatedViaRuleData,
    updatedViaChainFallback,
    skippedNoBest,
    skippedNotUser
  }, null, 2));
}

main();
