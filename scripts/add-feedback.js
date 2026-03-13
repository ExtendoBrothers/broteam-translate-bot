#!/usr/bin/env node
/**
 * Manual Feedback Tool for Humor Selection
 * 
 * Usage:
 *   node scripts/add-feedback.js <tweetId> --rating <1-5>
 *   node scripts/add-feedback.js <tweetId> --best <RANDOM_1|RANDOM_2|RANDOM_3|OLDSCHOOL>
 *   node scripts/add-feedback.js <tweetId> --correct <yes|no>
 *   node scripts/add-feedback.js <tweetId> --notes "Your feedback here"
 * 
 * Examples:
 *   node scripts/add-feedback.js 2007589663918498301 --rating 4
 *   node scripts/add-feedback.js 2007589663918498301 --best OLDSCHOOL --notes "Funnier than random chains"
 *   node scripts/add-feedback.js 2007589663918498301 --correct no --best RANDOM_2
 */

const fs = require('fs');
const path = require('path');
const { atomicWriteJsonSync } = require('../dist/src/utils/safeFileOps');

function addFeedback() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.error('Usage: node scripts/add-feedback.js <tweetId> [options]');
    console.error('Options:');
    console.error('  --rating <1-5>           Rate the selected result (1=bad, 5=excellent)');
    console.error('  --best <source>          Which candidate was actually funniest (RANDOM_1, RANDOM_2, RANDOM_3, OLDSCHOOL)');
    console.error('  --correct <yes|no>       Was the bot selection correct?');
    console.error('  --notes "<text>"         Additional feedback notes');
    process.exit(1);
  }

  const tweetId = args[0];
  const feedback = { providedAt: new Date().toISOString() };

  // Parse arguments
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--rating' && args[i + 1]) {
      feedback.rating = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--best' && args[i + 1]) {
      feedback.actualBest = args[i + 1];
      i++;
    } else if (args[i] === '--correct' && args[i + 1]) {
      feedback.wasCorrect = args[i + 1].toLowerCase() === 'yes';
      i++;
    } else if (args[i] === '--notes' && args[i + 1]) {
      feedback.notes = args[i + 1];
      i++;
    }
  }

  // Read feedback data file
  const feedbackPath = path.join(process.cwd(), 'feedback-data.jsonl');
  
  if (!fs.existsSync(feedbackPath)) {
    console.error('Error: feedback-data.jsonl not found. Bot needs to process tweets first.');
    process.exit(1);
  }

  const lines = fs.readFileSync(feedbackPath, 'utf8').split('\n').filter(l => l.trim());
  let found = false;
  let updatedLines = [];
  const seenIds = new Set();

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      
      // Skip duplicates
      if (seenIds.has(entry.tweetId)) {
        console.log('⚠️  Skipping duplicate entry for:', entry.tweetId);
        continue;
      }
      seenIds.add(entry.tweetId);
      
      if (entry.tweetId === tweetId) {
        found = true;
        entry.userFeedback = feedback;
        
        console.log('✓ Feedback added for tweet:', tweetId);
        console.log('  Original:', entry.originalText);
        console.log('  Bot selected:', entry.botSelected, '-', entry.selectedResult);
        if (feedback.rating) console.log('  Your rating:', feedback.rating + '/5');
        if (feedback.actualBest) console.log('  Actually funniest:', feedback.actualBest);
        if (feedback.wasCorrect !== undefined) console.log('  Bot correct?:', feedback.wasCorrect ? 'Yes' : 'No');
        if (feedback.notes) console.log('  Notes:', feedback.notes);
        
        updatedLines.push(JSON.stringify(entry, (key, value) => {
          if (typeof value === 'string') {
            return value.replace(/\n/g, '\\n').replace(/\r/g, '\\r');
          }
          return value;
        }));
      } else {
        updatedLines.push(JSON.stringify(entry, (key, value) => {
          if (typeof value === 'string') {
            return value.replace(/\n/g, '\\n').replace(/\r/g, '\\r');
          }
          return value;
        }));
      }
    } catch (parseError) {
      console.log('⚠️  Skipping malformed line:', parseError.message);
    }
  }

  if (!found) {
    console.error('Error: Tweet ID not found in feedback data:', tweetId);
    console.log('\nAvailable recent tweets:');
    updatedLines.slice(-5).forEach(line => {
      try {
        const entry = JSON.parse(line);
        console.log(`  ${entry.tweetId}: "${entry.originalText.substring(0, 50)}..."`);
      } catch {
        // Skip
      }
    });
    process.exit(1);
  }

  // Write back
  fs.writeFileSync(feedbackPath, updatedLines.join('\n') + '\n', 'utf8');
  console.log('\n✓ Feedback saved to feedback-data.jsonl');

  // Apply heuristic weight learning if actualBest differs from botSelected
  if (feedback.actualBest) {
    applyWeightLearning(tweetId, feedback.actualBest, feedbackPath);
  }
}

/**
 * Mirrors the logic in heuristicEvaluator.ts updateWeightsFromFeedback().
 * Reads heuristic-weights.json, nudges weights based on winner vs loser rules,
 * and saves the result.
 */
function applyWeightLearning(tweetId, actualBest, feedbackPath) {
  const weightsPath = path.join(process.cwd(), 'heuristic-weights.json');
  if (!fs.existsSync(weightsPath)) {
    console.log('ℹ️  heuristic-weights.json not found — weights will be created on next bot run.');
    return;
  }

  // Re-read the entry we just wrote so we have the updated feedback
  const lines = fs.readFileSync(feedbackPath, 'utf8').split('\n').filter(l => l.trim());
  let entry = null;
  for (const line of lines) {
    try {
      const e = JSON.parse(line);
      if (e.tweetId === tweetId) { entry = e; break; }
    } catch { /* skip */ }
  }
  if (!entry) return;

  const winnerCandidate = entry.candidates.find(c => c.source === actualBest);
  if (!winnerCandidate) {
    console.log('⚠️  Could not find winner candidate for weight learning — skipping.');
    return;
  }

  // Compare winner against ALL non-picked candidates, not just botSelected.
  // This ensures every unchosen candidate is scored lower than the user's pick.
  const loserCandidates = entry.candidates.filter(c => c.source !== actualBest);
  if (loserCandidates.length === 0) return;

  const winnerRules = winnerCandidate.heuristicRules || {};
  const anyLoserHasRules = loserCandidates.some(c => Object.keys(c.heuristicRules || {}).length > 0);

  if (Object.keys(winnerRules).length === 0 && !anyLoserHasRules) {
    console.log('ℹ️  No heuristic rule data in this entry (pre-refactor) — weight update skipped.');
    return;
  }

  const LEARNING_RATE = 0.002;
  let weights;
  try {
    weights = JSON.parse(fs.readFileSync(weightsPath, 'utf8'));
  } catch (e) {
    console.log('⚠️  Could not read heuristic-weights.json:', e.message);
    return;
  }

  // Compare winner against a merged view of all losers' fired rules so that
  // each feedback event updates wins/losses and nudges weights at most once per
  // rule, regardless of how many loser candidates exist.
  let changed = false;
  for (const rule of Object.keys(weights)) {
    const wonFired  = winnerRules[rule]?.fired ?? false;
    const lostFired = loserCandidates.some(c => (c.heuristicRules || {})[rule]?.fired ?? false);

    if (wonFired)  weights[rule].wins++;
    if (lostFired) weights[rule].losses++;

    if (wonFired && !lostFired) {
      weights[rule].weight += LEARNING_RATE;
      changed = true;
    } else if (lostFired && !wonFired) {
      weights[rule].weight -= LEARNING_RATE;
      changed = true;
    }
  }

  if (changed) {
    atomicWriteJsonSync(weightsPath, weights);
    const loserSources = loserCandidates.map(c => c.source).join(', ');
    console.log(`✓ Heuristic weights updated: your pick (${actualBest}) beats all others (${loserSources})`);
  } else {
    console.log('ℹ️  No differing rules between winner/losers — weights unchanged.');
  }
}

addFeedback();
