#!/usr/bin/env node
/**
 * Feedback Analysis Tool
 * 
 * Analyzes patterns in user feedback to identify preferences and suggest improvements
 * 
 * Usage:
 *   node scripts/analyze-feedback.js
 *   node scripts/analyze-feedback.js --min-samples 10
 */

const fs = require('fs');
const path = require('path');

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
  const total = entries.length;
  const feedbackCount = withFeedback.length;

  console.log('='.repeat(70));
  console.log('FEEDBACK ANALYSIS REPORT');
  console.log('='.repeat(70));
  console.log(`\nTotal tweets processed: ${total}`);
  console.log(`Tweets with feedback: ${feedbackCount} (${((feedbackCount / total) * 100).toFixed(1)}%)`);
  
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

  const correctSelections = withFeedback.filter(e => e.userFeedback.wasCorrect === true).length;
  const incorrectSelections = withFeedback.filter(e => e.userFeedback.wasCorrect === false).length;
  
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
      selected: entries.filter(e => e.botSelected === source).length,
      preferred: withFeedback.filter(e => e.userFeedback.actualBest === source).length,
      avgRating: 0,
      ratingCount: 0
    };
  });

  // Calculate average ratings
  withFeedback.forEach(e => {
    if (e.userFeedback.rating && sourceStats[e.botSelected]) {
      sourceStats[e.botSelected].avgRating += e.userFeedback.rating;
      sourceStats[e.botSelected].ratingCount++;
    }
  });

  console.log('\nSource          Selected  Preferred  Avg Rating');
  Object.entries(sourceStats).forEach(([source, stats]) => {
    const avgRating = stats.ratingCount > 0 
      ? (stats.avgRating / stats.ratingCount).toFixed(1)
      : 'N/A';
    console.log(`${source.padEnd(15)} ${String(stats.selected).padStart(8)}  ${String(stats.preferred).padStart(9)}  ${String(avgRating).padStart(10)}`);
  });

  console.log('\n' + '-'.repeat(70));
  console.log('RATING DISTRIBUTION');
  console.log('-'.repeat(70));

  const ratings = withFeedback.filter(e => e.userFeedback.rating).map(e => e.userFeedback.rating);
  if (ratings.length > 0) {
    for (let i = 5; i >= 1; i--) {
      const count = ratings.filter(r => r === i).length;
      const bar = '█'.repeat(Math.round((count / ratings.length) * 40));
      console.log(`${i} star: ${bar} ${count}`);
    }
    const avgRating = ratings.reduce((a, b) => a + b, 0) / ratings.length;
    console.log(`\nAverage rating: ${avgRating.toFixed(2)}/5`);
  }

  console.log('\n' + '-'.repeat(70));
  console.log('PATTERN INSIGHTS');
  console.log('-'.repeat(70));

  // Analyze length preferences
  const lengthData = withFeedback
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
  const oldschoolPreferred = withFeedback.filter(e => e.userFeedback.actualBest === 'OLDSCHOOL').length;
  const randomPreferred = withFeedback.filter(e => e.userFeedback.actualBest && e.userFeedback.actualBest.startsWith('RANDOM')).length;
  
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
    if (f.rating) console.log(`  Rating: ${'★'.repeat(f.rating)}${'☆'.repeat(5 - f.rating)}`);
    if (f.actualBest) console.log(`  Actually best: ${f.actualBest}`);
    if (f.notes) console.log(`  Notes: ${f.notes}`);
  });

  console.log('\n' + '='.repeat(70));
}

analyzeFeedback();
