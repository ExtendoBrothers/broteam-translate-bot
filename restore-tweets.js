/**
 * Script to restore tweets that were removed from the queue after failures.
 * These tweets had rate limit issues but now that OAuth2 and queue processing
 * are fixed, they should be safe to retry.
 */

const fs = require('fs');
const path = require('path');

// The 5 tweets that were removed from the queue
const tweetsToRestore = [
  {
    sourceTweetId: '2014111559908311183',
    finalTranslation: 'That girl was a lot of people',
  },
  {
    sourceTweetId: '2014112151569637612',
    finalTranslation: '@elonmusk You can know all this, but there are complicated reports that are Transversal\n\nlimewire.com/d/MWvhY#3tVcDYA…',
  },
  {
    sourceTweetId: '2014128311937499554',
    finalTranslation: 'NOW PLAY\n\nPELI!\nTHERE\'S A GIRL!',
  },
  {
    sourceTweetId: '2014110134411419718',
    finalTranslation: 'Points',
  },
  {
    sourceTweetId: '2014110610997576103',
    finalTranslation: 'Ceci Hipno said:',
  },
];

const queueFile = path.join(__dirname, '.tweet-queue.json');

// Read the current queue
const queueData = JSON.parse(fs.readFileSync(queueFile, 'utf8'));

console.log(`Current queue size: ${queueData.queue.length}`);

// Check if any of these tweets are already in the queue
const existingIds = new Set(queueData.queue.map(item => item.sourceTweetId));
const tweetsToAdd = tweetsToRestore.filter(tweet => !existingIds.has(tweet.sourceTweetId));

console.log(`Tweets already in queue: ${tweetsToRestore.length - tweetsToAdd.length}`);
console.log(`Tweets to add: ${tweetsToAdd.length}`);

// Add the tweets to the queue with resetattemptCount
tweetsToAdd.forEach(tweet => {
  queueData.queue.push({
    sourceTweetId: tweet.sourceTweetId,
    finalTranslation: tweet.finalTranslation,
    queuedAt: new Date().toISOString(),
    attemptCount: 0,
  });
  console.log(`Added tweet ${tweet.sourceTweetId}: ${tweet.finalTranslation.substring(0, 50)}...`);
});

// Save the updated queue
fs.writeFileSync(queueFile, JSON.stringify(queueData, null, 2), 'utf8');

console.log(`\nUpdated queue size: ${queueData.queue.length}`);
console.log('Queue restoration complete!');
