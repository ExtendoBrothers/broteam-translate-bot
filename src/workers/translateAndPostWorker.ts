import { fetchTweets } from '../twitter/fetchTweets';
import { postTweet } from '../twitter/postTweets';
import { TwitterClient } from '../twitter/client';
import { translateText } from '../translator/googleTranslate';
import { config } from '../config';
import { logger } from '../utils/logger';
import { tweetTracker } from '../utils/tweetTracker';
import { tweetQueue } from '../utils/tweetQueue';
import { rateLimitTracker } from '../utils/rateLimitTracker';
import { postTracker } from '../utils/postTracker';

// Helper to add delay between operations to respect rate limits
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export interface WorkerResult {
  didWork: boolean;
  blockedByCooldown: boolean;
}

export const translateAndPostWorker = async (): Promise<WorkerResult> => {
  const client = new TwitterClient();
  let didWork = false;
  let blockedByCooldown = false;
    
  try {
    // Periodically prune processed tweet IDs to keep storage healthy
    tweetTracker.prune(90, 50000);
    // Check 24-hour post limit status
    const remainingPosts = postTracker.getRemainingPosts();
    logger.info(`Post limit status: ${postTracker.getPostCount24h()}/17 posts in last 24h, ${remainingPosts} remaining`);
        
    if (!postTracker.canPost()) {
      const waitSeconds = postTracker.getTimeUntilNextSlot();
      logger.warn(`24-hour post limit reached (17/17). Next slot available in ${waitSeconds} seconds`);
    }
        
    // First, try to post any queued tweets from previous runs
    while (!tweetQueue.isEmpty() && postTracker.canPost()) {
      // Check if we're rate limited for posting
      if (rateLimitTracker.isRateLimited('post')) {
        const waitSeconds = rateLimitTracker.getSecondsUntilReset('post');
        logger.info(`Cannot post queued tweets - rate limited for ${waitSeconds} more seconds`);
        break;
      }

      const queuedTweet = tweetQueue.peek();
      if (!queuedTweet) break;

      try {
        logger.info(`Posting queued tweet ${queuedTweet.sourceTweetId} (attempt ${queuedTweet.attemptCount + 1})`);
        await postTweet(client, queuedTweet.finalTranslation);
        logger.info(`Successfully posted queued tweet ${queuedTweet.sourceTweetId}`);
                
        // Record the post and mark original tweet as processed
        postTracker.recordPost();
        tweetTracker.markProcessed(queuedTweet.sourceTweetId);
        tweetQueue.dequeue();
                
        // Add delay between posts
        await delay(5000);
      } catch (error: any) {
        // If rate limit hit, stop processing queue
        if (error?.code === 429 || error?.message?.includes('429')) {
          logger.error('Rate limit hit while posting queued tweet. Will retry next run.');
          tweetQueue.incrementAttempt();
          break;
        }
        // For other errors, increment attempt count but keep in queue
        logger.error(`Failed to post queued tweet ${queuedTweet.sourceTweetId}: ${error}`);
        tweetQueue.incrementAttempt();
                
        // If too many failures, remove from queue
        if (queuedTweet.attemptCount >= 5) {
          logger.error(`Removing tweet ${queuedTweet.sourceTweetId} from queue after ${queuedTweet.attemptCount} failed attempts`);
          tweetQueue.dequeue();
          tweetTracker.markProcessed(queuedTweet.sourceTweetId);
        }
        break;
      }
    }

    // Check if blocked by pre-existing cooldown before fetching
    const wasBlockedBefore = rateLimitTracker.isRateLimited('timeline');

    // Always fetch new tweets (independent of queue and post limit status)
    const tweets = await fetchTweets();
        
    if (tweets.length === 0) {
      logger.info('No new tweets to process');
      // Only mark as blocked if cooldown existed BEFORE the fetch attempt
      blockedByCooldown = wasBlockedBefore;
      return { didWork: false, blockedByCooldown };
    }
        
    logger.info(`Processing ${tweets.length} new tweet(s)`);
        
    for (const tweet of tweets) {
      logger.info(`Processing tweet ${tweet.id}: ${tweet.text.substring(0, 50)}...`);

      let translationChain = tweet.text;
            
      // Chain translations through all languages
      for (const lang of config.LANGUAGES) {
        try {
          translationChain = await translateText(translationChain, lang);
          logger.info(`Translated through ${lang}: ${translationChain.substring(0, 50)}...`);
                    
          // Add 2-second delay between translation calls
          await delay(2000);
        } catch (error: any) {
          logger.error(`Failed to translate for ${lang}: ${error}`);
          // Continue with partial translation rather than failing completely
        }
      }

      // Translate final result back to English
      try {
        const finalResult = await translateText(translationChain, 'en');
        logger.info(`Final translation result: ${finalResult}`);
                
        // If queue has items OR we can't post (24h limit or rate limit), add to queue
        if (!tweetQueue.isEmpty() || !postTracker.canPost() || rateLimitTracker.isRateLimited('post')) {
          const reason = !tweetQueue.isEmpty() ? 'queue not empty' : 
            !postTracker.canPost() ? '24h limit reached' : 
              'rate limited';
          logger.info(`Adding tweet ${tweet.id} to queue (${reason})`);
          tweetQueue.enqueue(tweet.id, finalResult);
        } else {
          // Try to post immediately
          try {
            await postTweet(client, finalResult);
            logger.info(`Posted final translation to Twitter for tweet ${tweet.id}`);
                        
            // Record the post and mark tweet as processed
            postTracker.recordPost();
            tweetTracker.markProcessed(tweet.id);
                        
            // Add delay between processing different tweets
            await delay(5000);
          } catch (error: any) {
            if (error?.code === 429 || error?.message?.includes('429')) {
              logger.error(`Rate limit hit on post. Queueing tweet ${tweet.id} for later.`);
              tweetQueue.enqueue(tweet.id, finalResult);
              // Don't process more new tweets this run
              break;
            }
            logger.error(`Failed to post final translation for tweet ${tweet.id}: ${error}`);
            // Don't queue on non-rate-limit errors, but mark as processed to avoid retry loop
            tweetTracker.markProcessed(tweet.id);
          }
        }
      } catch (error: any) {
        logger.error(`Failed to translate final result for tweet ${tweet.id}: ${error}`);
        // Mark as processed to avoid infinite retry
        tweetTracker.markProcessed(tweet.id);
      }
    }
        
    if (!tweetQueue.isEmpty()) {
      logger.info(`Worker complete. ${tweetQueue.size()} tweet(s) remaining in queue for next run.`);
    }
    didWork = tweets.length > 0;
    return { didWork, blockedByCooldown };
  } catch (error) {
    logger.error(`Error in translateAndPostWorker: ${error}`);
    return { didWork: false, blockedByCooldown };
  }
};