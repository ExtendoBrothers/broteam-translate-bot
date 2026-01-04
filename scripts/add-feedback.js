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

  const lines = fs.readFileSync(feedbackPath, 'utf8').split('\n').filter(Boolean);
  let found = false;
  let updatedLines = [];

  for (const line of lines) {
    const entry = JSON.parse(line);
    
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
      
      updatedLines.push(JSON.stringify(entry));
    } else {
      updatedLines.push(line);
    }
  }

  if (!found) {
    console.error('Error: Tweet ID not found in feedback data:', tweetId);
    console.log('\nAvailable recent tweets:');
    lines.slice(-5).forEach(line => {
      const entry = JSON.parse(line);
      console.log(`  ${entry.tweetId}: "${entry.originalText.substring(0, 50)}..."`);
    });
    process.exit(1);
  }

  // Write back
  fs.writeFileSync(feedbackPath, updatedLines.join('\n') + '\n', 'utf8');
  console.log('\n✓ Feedback saved to feedback-data.jsonl');
}

addFeedback();
