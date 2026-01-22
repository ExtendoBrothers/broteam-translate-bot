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
const lines = fs.readFileSync(FEEDBACK_FILE, 'utf8').split('\n');

// Parse JSON objects with improved error handling
const entries = [];
let currentObject = '';
let braceCount = 0;
let inString = false;
let escapeNext = false;

try {
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      // Handle string escaping
      if (escapeNext) {
        escapeNext = false;
        currentObject += char;
        continue;
      }
      
      if (char === '\\') {
        escapeNext = true;
        currentObject += char;
        continue;
      }
      
      // Handle string boundaries
      if (char === '"' && !inString) {
        inString = true;
      } else if (char === '"' && inString) {
        inString = false;
      }
      
      // Only count braces when not inside strings
      if (!inString) {
        if (char === '{') braceCount++;
        else if (char === '}') braceCount--;
      }
      
      currentObject += char;
    }
    
    currentObject += '\n';
    
    // If we have a complete object, try to parse it
    if (braceCount === 0 && currentObject.trim()) {
      const trimmed = currentObject.trim();
      if (trimmed) {
        try {
          const entry = JSON.parse(trimmed);
          // Unescape newlines in string values
          const unescapedEntry = JSON.parse(JSON.stringify(entry, (key, value) => {
            if (typeof value === 'string') {
              return value.replace(/\\n/g, '\n').replace(/\\r/g, '\r');
            }
            return value;
          }));
          entries.push(unescapedEntry);
          currentObject = '';
          braceCount = 0;
          inString = false;
          escapeNext = false;
        } catch (parseError) {
          // If parsing fails, continue accumulating
          // This handles cases where the object spans multiple lines
        }
      }
    }
  }

  // Try to parse any remaining content
  if (currentObject.trim()) {
    try {
      const entry = JSON.parse(currentObject.trim());
      // Unescape newlines in string values
      const unescapedEntry = JSON.parse(JSON.stringify(entry, (key, value) => {
        if (typeof value === 'string') {
          return value.replace(/\\n/g, '\n').replace(/\\r/g, '\r');
        }
        return value;
      }));
      entries.push(unescapedEntry);
    } catch {
      // Ignore remaining malformed content
    }
  }
} catch (error) {
  console.error('Error parsing feedback data:', error.message);
  console.log('Skipping feedback analysis due to malformed data.');
  process.exit(0);
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
