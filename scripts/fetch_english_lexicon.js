// Script to download the 10,000 most common English words from the Google Trillion Word Corpus
// and save them as a JSON array for use in lexicon.ts

const https = require('https');
const fs = require('fs');
const path = require('path');

const WORDLIST_URL = 'https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english.txt';
const OUTPUT_PATH = path.join(__dirname, '../src/translator/english-lexicon.json');

https.get(WORDLIST_URL, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const words = data.split(/\r?\n/).filter(Boolean);
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(words, null, 2), 'utf8');
    console.log(`Saved ${words.length} words to ${OUTPUT_PATH}`);
  });
}).on('error', (err) => {
  console.error('Error downloading word list:', err);
});
