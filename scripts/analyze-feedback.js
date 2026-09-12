#!/usr/bin/env node
/**
 * Feedback Analysis Tool
 * 
 * Analyzes user selections and agent-generated assessments to identify preferences
 * and suggest improvements. The two sources are reported separately because
 * agent assessments explain the data but are not independent user labels.
 * 
 * Usage:
 *   node scripts/analyze-feedback.js
 *   node scripts/analyze-feedback.js --min-samples 10
 */

const fs = require('fs');
const path = require('path');

function normalizeSource(source) {
  return String(source || '')
    .toUpperCase()
    .replace(/-/g, '_');
}

function analyzeFeedback() {
  const args = process.argv.slice(2);
  const minSamples = args.includes('--min-samples') 
    ? parseInt(args[args.indexOf('--min-samples') + 1], 10)
    : 5;

  const feedbackPath = path.join(process.cwd(), 'feedback-data.jsonl');
  
  if (!fs.existsSync(feedbackPath)) {
    console.error('Error: feedback-data.jsonl not found. Bot needs to process tweets first.');
    process.exit(1);
  }

  const lines = fs.readFileSync(feedbackPath, 'utf8').split('\n');
  
  // Parse JSON objects, accounting for objects that span multiple lines due to unescaped newlines
  const entries = [];
  let currentObject = '';
  let braceCount = 0;
  
  for (const line of lines) {
    currentObject += line + '\n';
    
    // Count braces
    for (const char of line) {
      if (char === '{') braceCount++;
      else if (char === '}') braceCount--;
    }
    
    // If we have a complete object, parse it
    if (braceCount === 0 && currentObject.trim()) {
      try {
        const entry = JSON.parse(currentObject.trim());
        entries.push(entry);
        currentObject = '';
      } catch {
        // Continue accumulating if parsing fails
      }
    }
  }
  
  // Try to parse any remaining content
  if (currentObject.trim()) {
    try {
      const entry = JSON.parse(currentObject.trim());
      entries.push(entry);
    } catch {
      // Ignore
    }
  }
  
  const withFeedback = entries.filter(e => e.userFeedback);
  const userFeedback = withFeedback.filter(e => String(e.userFeedback.feedbackSource || '').toLowerCase().startsWith('user'));
  const agentFeedback = withFeedback.filter(e => String(e.userFeedback.feedbackSource || '').toLowerCase().startsWith('agent'));
  const total = entries.length;
  const feedbackCount = withFeedback.length;

  console.log('='.repeat(70));
  console.log('FEEDBACK ANALYSIS REPORT');
  console.log('='.repeat(70));
  console.log(`\nTotal tweets processed: ${total}`);
  console.log(`Tweets with feedback: ${feedbackCount} (${((feedbackCount / total) * 100).toFixed(1)}%)`);

  console.log('\n' + '-'.repeat(70));
  console.log('FEEDBACK PROVENANCE');
  console.log('-'.repeat(70));
  console.log(`Manual user selections: ${userFeedback.length}`);
  console.log(`Agent interpretations and ratings: ${agentFeedback.length}`);
  console.log('User selections define preference; agent feedback records the reasoning and quality assessment.');
  
  if (feedbackCount < minSamples) {
    console.log('\n⚠️  Need at least ' + minSamples + ' feedback samples for meaningful analysis.');
    console.log('   Current: ' + feedbackCount + '/' + minSamples);
    console.log('\nTo add feedback, use:');
    console.log('  node scripts/add-feedback.js <tweetId> --rating <1-5> --best <source>');
    return;
  }

  console.log('\n' + '-'.repeat(70));
  console.log('SELECTION ACCURACY');
  console.log('-'.repeat(70));

  const userSelectionsWithBest = userFeedback.filter(e => e.userFeedback.actualBest);
  const correctSelections = userSelectionsWithBest.filter(e =>
    normalizeSource(e.userFeedback.actualBest) === normalizeSource(e.botSelected)
  ).length;
  const incorrectSelections = userSelectionsWithBest.length - correctSelections;
  
  if (correctSelections + incorrectSelections > 0) {
    const accuracy = (correctSelections / (correctSelections + incorrectSelections)) * 100;
    console.log(`Correct: ${correctSelections}`);
    console.log(`Incorrect: ${incorrectSelections}`);
    console.log(`Accuracy: ${accuracy.toFixed(1)}%`);
  }

  console.log('\n' + '-'.repeat(70));
  console.log('SOURCE PREFERENCES');
  console.log('-'.repeat(70));

  const sourceStats = {};
  ['RANDOM_1', 'RANDOM_2', 'RANDOM_3', 'OLDSCHOOL'].forEach(source => {
    sourceStats[source] = {
      selected: entries.filter(e => normalizeSource(e.botSelected) === source).length,
      userPreferred: userFeedback.filter(e => normalizeSource(e.userFeedback.actualBest) === source).length,
      agentPreferred: agentFeedback.filter(e => normalizeSource(e.userFeedback.actualBest) === source).length
    };
  });

  console.log('\nSource          Bot Selected  User Preferred  Agent Preferred');
  Object.entries(sourceStats).forEach(([source, stats]) => {
    console.log(`${source.padEnd(15)} ${String(stats.selected).padStart(12)}  ${String(stats.userPreferred).padStart(14)}  ${String(stats.agentPreferred).padStart(14)}`);
  });

  console.log('\n' + '-'.repeat(70));
  console.log('RATING DISTRIBUTION');
  console.log('-'.repeat(70));

  const printRatings = (label, sourceEntries) => {
    const ratings = sourceEntries.filter(e => e.userFeedback.rating).map(e => e.userFeedback.rating);
    if (ratings.length === 0) return;

    console.log(`\n${label} (${ratings.length} ratings)`);
    for (let i = 5; i >= 1; i--) {
      const count = ratings.filter(r => r === i).length;
      const bar = '█'.repeat(Math.round((count / ratings.length) * 40));
      console.log(`${i} star: ${bar} ${count}`);
    }
    const avgRating = ratings.reduce((a, b) => a + b, 0) / ratings.length;
    console.log(`\nAverage rating: ${avgRating.toFixed(2)}/5`);
  };

  printRatings('Agent-generated ratings', agentFeedback);
  printRatings('Manual user ratings (if supplied)', userFeedback);

  console.log('\n' + '-'.repeat(70));
  console.log('PATTERN INSIGHTS');
  console.log('-'.repeat(70));

  // Analyze length preferences
  const lengthData = agentFeedback
    .filter(e => e.userFeedback.rating)
    .map(e => ({
      length: e.selectedResult.length,
      rating: e.userFeedback.rating
    }));

  if (lengthData.length >= 5) {
    const avgLengthHighRated = lengthData
      .filter(d => d.rating >= 4)
      .reduce((sum, d) => sum + d.length, 0) / lengthData.filter(d => d.rating >= 4).length || 0;
    
    const avgLengthLowRated = lengthData
      .filter(d => d.rating <= 2)
      .reduce((sum, d) => sum + d.length, 0) / lengthData.filter(d => d.rating <= 2).length || 0;

    console.log(`• High-rated results (4-5★): ~${Math.round(avgLengthHighRated)} chars`);
    console.log(`• Low-rated results (1-2★): ~${Math.round(avgLengthLowRated)} chars`);
    
    if (avgLengthHighRated > 0 && avgLengthLowRated > 0) {
      if (avgLengthHighRated < avgLengthLowRated * 0.8) {
        console.log('  → You prefer shorter results');
      } else if (avgLengthHighRated > avgLengthLowRated * 1.2) {
        console.log('  → You prefer longer results');
      }
    }
  }

  // Chain preference insight
  const oldschoolPreferred = userFeedback.filter(e => normalizeSource(e.userFeedback.actualBest) === 'OLDSCHOOL').length;
  const randomPreferred = userFeedback.filter(e => normalizeSource(e.userFeedback.actualBest).startsWith('RANDOM')).length;
  
  if (oldschoolPreferred + randomPreferred >= 10) {
    const oldschoolPct = (oldschoolPreferred / (oldschoolPreferred + randomPreferred)) * 100;
    console.log(`• OLDSCHOOL chain preferred: ${oldschoolPct.toFixed(0)}% of time`);
    
    if (oldschoolPct > 60) {
      console.log('  → Consider weighting OLDSCHOOL results higher (+0.1 to score)');
    } else if (oldschoolPct < 40) {
      console.log('  → Random chains performing well, current weighting is good');
    }
  }

  console.log('\n' + '-'.repeat(70));
  console.log('RECENT FEEDBACK');
  console.log('-'.repeat(70));

  withFeedback.slice(-5).reverse().forEach(e => {
    const f = e.userFeedback;
    console.log(`\n[${e.tweetId}] ${e.originalText.substring(0, 50)}...`);
    console.log(`  Bot picked: ${e.botSelected} (score: ${e.selectedScore.toFixed(3)})`);
    const isAgentFeedback = String(f.feedbackSource || '').toLowerCase().startsWith('agent');
    if (f.rating) console.log(`  ${isAgentFeedback ? 'Agent' : 'User'} rating: ${'★'.repeat(f.rating)}${'☆'.repeat(5 - f.rating)}`);
    if (f.actualBest) console.log(`  ${isAgentFeedback ? 'Agent interpretation' : 'User preferred'}: ${f.actualBest}`);
    if (f.notes) console.log(`  Notes: ${f.notes}`);
  });

  console.log('\n' + '='.repeat(70));
}

analyzeFeedback();
