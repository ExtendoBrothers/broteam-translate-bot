/* eslint-disable no-console, @typescript-eslint/no-explicit-any */
import 'dotenv/config';
import { TwitterClient } from '../twitter/client';
import { translateText } from '../translator/googleTranslate';
import { postTweet } from '../twitter/postTweets';
import { config } from '../config';
import { logger } from '../utils/logger';
import { tweetTracker } from '../utils/tweetTracker';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function jitteredTranslationDelay(baseMs = 5000) {
  return baseMs + Math.floor(Math.random() * 1200);
}

async function main() {
  const tweetId = process.argv[2];
  const originalText = process.argv[3];
  
  if (!tweetId || !originalText) {
    console.error('Usage: ts-node src/scripts/retryTweet.ts <tweet_id> "<original_text>"');
    process.exit(1);
  }

  const client = new TwitterClient();
  
  console.log(`Processing tweet ${tweetId}`);
  console.log(`Original: ${originalText}\n`);

  let translationChain = originalText;
  
  for (const lang of config.LANGUAGES) {
    try {
      console.log(`Translating to ${lang}...`);
      translationChain = await translateText(translationChain, lang);
      console.log(`[${lang}] ${translationChain.substring(0, 100)}...`);
      await delay(jitteredTranslationDelay());
    } catch (error: any) {
      console.error(`Failed at ${lang}: ${error}`);
      process.exit(1);
    }
  }

  console.log('\nTranslating final result to English...');
  const finalResult = await translateText(translationChain, 'en');
  console.log(`\nFinal translation:\n${finalResult}\n`);

  console.log('Posting to Twitter...');
  await postTweet(client, finalResult);
  
  tweetTracker.markProcessed(tweetId);
  console.log(`✅ Tweet ${tweetId} processed and posted successfully!`);
}

main().catch(err => {
  logger.error(`Retry script failed: ${err}`);
  console.error('Fatal error:', err);
  process.exit(1);
});
