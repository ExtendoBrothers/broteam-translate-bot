#!/usr/bin/env node
/**
 * Fix and validate feedback-data.jsonl
 * 
 * This script:
 * 1. Backs up the original file
 * 2. Parses and validates each JSON object
 * 3. Removes duplicates
 * 4. Fixes malformed entries
 * 5. Writes clean, properly formatted JSONL
 */

const fs = require('fs');
const path = require('path');

const FEEDBACK_FILE = path.join(process.cwd(), 'feedback-data.jsonl');
const BACKUP_FILE = path.join(process.cwd(), 'feedback-data.jsonl.backup');

console.log('═'.repeat(70));
console.log('FEEDBACK DATA CLEANUP');
console.log('═'.repeat(70));

if (!fs.existsSync(FEEDBACK_FILE)) {
  console.error('\n❌ Error: feedback-data.jsonl not found');
  process.exit(1);
}

// Backup original file
console.log('\n📦 Creating backup...');
fs.copyFileSync(FEEDBACK_FILE, BACKUP_FILE);
console.log(`✓ Backup saved to: ${path.basename(BACKUP_FILE)}`);

// Read the file
console.log('\n📖 Reading feedback data...');
const content = fs.readFileSync(FEEDBACK_FILE, 'utf8');
console.log(`   File size: ${(content.length / 1024).toFixed(2)} KB`);

// Extract valid JSON objects
const validEntries = [];
const seenTweetIds = new Set();
let duplicates = 0;
let malformed = 0;
let fixed = 0;

console.log('\n🔍 Parsing entries...');

// Split by lines first
const lines = content.split('\n');

for (let i = 0; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;
  
  try {
    // Try to parse as-is
    const entry = JSON.parse(line);
    
    // Validate structure
    if (!entry.timestamp || !entry.tweetId) {
      malformed++;
      continue;
    }
    
    // Check for duplicates
    if (seenTweetIds.has(entry.tweetId)) {
      duplicates++;
      continue;
    }
    
    seenTweetIds.add(entry.tweetId);
    validEntries.push(entry);
    
  } catch (parseError) {
    // Try to fix common issues
    try {
      // Remove any trailing commas, extra newlines, etc.
      let fixedLine = line
        .replace(/,\s*}/g, '}')  // Remove trailing commas
        .replace(/,\s*]/g, ']')  // Remove trailing commas in arrays
        .trim();
      
      const entry = JSON.parse(fixedLine);
      
      if (!entry.timestamp || !entry.tweetId) {
        malformed++;
        continue;
      }
      
      if (seenTweetIds.has(entry.tweetId)) {
        duplicates++;
        continue;
      }
      
      seenTweetIds.add(entry.tweetId);
      validEntries.push(entry);
      fixed++;
      
    } catch {
      malformed++;
      console.log(`   ⚠️  Line ${i + 1}: ${parseError.message}`);
    }
  }
}

console.log('\n📊 Results:');
console.log(`   Valid entries: ${validEntries.length}`);
console.log(`   Duplicates removed: ${duplicates}`);
console.log(`   Fixed entries: ${fixed}`);
console.log(`   Malformed (skipped): ${malformed}`);

// Write clean data
console.log('\n💾 Writing cleaned data...');

const cleanedContent = validEntries.map(entry => {
  // Ensure string values have escaped newlines
  const sanitized = JSON.parse(JSON.stringify(entry, (key, value) => {
    if (typeof value === 'string') {
      return value.replace(/\n/g, '\\n').replace(/\r/g, '\\r');
    }
    return value;
  }));
  return JSON.stringify(sanitized);
}).join('\n') + '\n';

fs.writeFileSync(FEEDBACK_FILE, cleanedContent, 'utf8');

console.log(`✓ Wrote ${validEntries.length} entries to feedback-data.jsonl`);
console.log(`   File size: ${(cleanedContent.length / 1024).toFixed(2)} KB`);

console.log('\n✅ Cleanup complete!');
console.log(`\n💡 Original file backed up to: ${path.basename(BACKUP_FILE)}`);
console.log('═'.repeat(70) + '\n');
