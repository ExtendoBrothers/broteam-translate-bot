const fs = require('fs');
const path = require('path');

// Import the tweet tracker
const { tweetTracker } = require('./src/utils/tweetTracker');

console.log('Starting cleanup of processed tweets that were removed from queue...');

// Get all currently processed tweet IDs
const processedTweets = tweetTracker.getProcessedTweetIds();
console.log(`Found ${processedTweets.length} processed tweets`);

// Get all tweets currently in queue by reading the queue file directly
const queueFile = path.join(process.cwd(), '.tweet-queue.json');
let queueTweets = [];
if (fs.existsSync(queueFile)) {
  try {
    const queueData = JSON.parse(fs.readFileSync(queueFile, 'utf8'));
    queueTweets = queueData.queue.map((item) => item.sourceTweetId);
  } catch (error) {
    console.error('Error reading queue file:', error);
  }
}
console.log(`Found ${queueTweets.length} tweets in queue`);

// Find processed tweets that are not in the queue (these were likely removed for spam)
const tweetsToUnmark = processedTweets.filter(id => !queueTweets.includes(id));

console.log(`Found ${tweetsToUnmark.length} processed tweets not in queue - unmarking them for retry:`);
tweetsToUnmark.forEach(id => {
  console.log(`  Unmarking: ${id}`);
  tweetTracker.unmarkProcessed(id);
});

console.log(`Cleanup complete. ${tweetsToUnmark.length} tweets unmarked for potential retry.`);