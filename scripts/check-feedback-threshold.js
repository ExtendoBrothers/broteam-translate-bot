#!/usr/bin/env node
/**
 * Check if feedback count has reached analysis threshold (every 5 feedbacks)
 * If so, run analysis and display recommendations for scoring adjustments
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const FEEDBACK_FILE = path.join(process.cwd(), 'feedback-data.jsonl');
const ANALYSIS_INTERVAL = 5; // Analyze every 5 feedbacks

// Check if feedback file exists
if (!fs.existsSync(FEEDBACK_FILE)) {
  console.log('No feedback data yet. Keep processing tweets!');
  process.exit(0);
}

// Count feedback entries with userFeedback populated
const lines = fs.readFileSync(FEEDBACK_FILE, 'utf8').split('\n').filter(l => l.trim());

// Simple line-by-line parsing with robust error handling
const entries = [];
let skippedLines = 0;

for (const line of lines) {
  if (!line.trim()) continue;
  
  try {
    const entry = JSON.parse(line);
    entries.push(entry);
  } catch (error) {
    // Skip malformed lines silently
    skippedLines++;
  }
}

if (skippedLines > 0) {
  console.log(`⚠️  Skipped ${skippedLines} malformed line(s) in feedback data`);
}

const feedbackEntries = entries.filter(entry => entry.userFeedback !== null);

const feedbackCount = feedbackEntries.length;
console.log(`📊 Current feedback count: ${feedbackCount}`);

// Check if we've hit a threshold
if (feedbackCount > 0 && feedbackCount % ANALYSIS_INTERVAL === 0) {
  console.log('\n🎯 Analysis threshold reached! Running pattern analysis...\n');
  console.log('═'.repeat(70));
  
  try {
    // Run analysis script
    execSync('node scripts/analyze-feedback.js', { 
      stdio: 'inherit',
      cwd: process.cwd()
    });
    
    console.log('\n' + '═'.repeat(70));
    console.log('\n💡 NEXT STEPS:');
    console.log('   Review the recommendations above and apply manual adjustments to scoring logic.');
    console.log('   After 20-50 feedbacks, run fine-tuning for automated improvements.');
    console.log('\n   Fine-tuning commands:');
    console.log('     node scripts/export-training-data.js');
    console.log('     python scripts/fine-tune-model.py');
    console.log('     python scripts/convert-humor-model-to-onnx.py --custom');
    
  } catch (error) {
    console.error('Error running analysis:', error.message);
    process.exit(1);
  }
} else {
  const remaining = ANALYSIS_INTERVAL - (feedbackCount % ANALYSIS_INTERVAL);
  console.log(`⏳ ${remaining} more feedback(s) until next analysis`);
  console.log(`   Total collected: ${feedbackCount}`);
  console.log(`   Next analysis at: ${feedbackCount + remaining}`);
}
