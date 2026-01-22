#!/usr/bin/env node
/**
 * Show all tweets that need feedback (userFeedback is null)
 */

const fs = require('fs');
const path = require('path');

const FEEDBACK_FILE = path.join(process.cwd(), 'feedback-data.jsonl');

// Check if feedback file exists
if (!fs.existsSync(FEEDBACK_FILE)) {
  console.log('No feedback data yet. Process some tweets first!');
  process.exit(0);
}

// Read all feedback entries
const allEntries = fs.readFileSync(FEEDBACK_FILE, 'utf8')
  .split('\n')
  .filter(line => line.trim())
  .map(line => JSON.parse(line));

// Filter entries that need feedback
const needingFeedback = allEntries.filter(entry => entry.userFeedback === null);
const havingFeedback = allEntries.filter(entry => entry.userFeedback !== null);

console.log('\n' + '═'.repeat(70));
console.log('TWEETS NEEDING FEEDBACK');
console.log('═'.repeat(70));

if (needingFeedback.length === 0) {
  console.log('\n✓ All tweets have feedback! Great job!\n');
  console.log(`Total tweets processed: ${allEntries.length}`);
  console.log(`With feedback: ${havingFeedback.length}`);
} else {
  console.log(`\n${needingFeedback.length} tweet(s) waiting for your feedback:\n`);
  
  needingFeedback.forEach((entry, index) => {
    console.log(`${index + 1}. Tweet ID: ${entry.tweetId}`);
    console.log(`   Original: ${entry.originalText}`);
    console.log(`   Bot selected: ${entry.botSelected} - "${entry.selectedResult}"`);
    console.log(`   Score: ${entry.selectedScore.toFixed(2)}`);
    console.log('   ');
    console.log('   Candidates:');
    entry.candidates.forEach(c => {
      const marker = c.source === entry.botSelected ? '←' : ' ';
      console.log(`     ${marker} [${c.source}] "${c.result}" (${c.humorScore.toFixed(2)})`);
    });
    console.log('');
    console.log('   To add feedback:');
    console.log('     node scripts/add-feedback.js ' + entry.tweetId + ' --rating 1-5 --best SOURCE --notes "..."\\n');
  });
  
  console.log('─'.repeat(70));
  console.log(`Progress: ${havingFeedback.length}/${allEntries.length} tweets reviewed`);
  console.log(`Next analysis at: 5 feedbacks (${Math.max(0, 5 - havingFeedback.length)} more needed)`);
}

console.log('═'.repeat(70) + '\n');
