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

// Minimum delay between posts to avoid rapid-fire posting (15 minutes)
const MIN_POST_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
let lastPostTime = 0;

// Circuit breaker state per language
interface CircuitState { failures: number; openedAt?: number; }
const circuit: Record<string, CircuitState> = {};
const FAILURE_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes

function isCircuitOpen(lang: string): boolean {
  const state = circuit[lang];
  if (!state) return false;
  if (state.failures < FAILURE_THRESHOLD) return false;
  if (!state.openedAt) return false;
  const elapsed = Date.now() - state.openedAt;
  if (elapsed >= CIRCUIT_COOLDOWN_MS) {
    // Cooldown expired; reset state
    circuit[lang] = { failures: 0, openedAt: undefined };
    return false;
  }
  return true;
}

function recordFailure(lang: string): void {
  const state = circuit[lang] || { failures: 0 };
  state.failures += 1;
  if (state.failures === FAILURE_THRESHOLD && !state.openedAt) {
    state.openedAt = Date.now();
    logger.warn(`Circuit opened for language ${lang} after ${state.failures} consecutive failures; skipping translations for ${Math.round(CIRCUIT_COOLDOWN_MS/60000)}m`);
  }
  circuit[lang] = state;
}

function recordSuccess(lang: string): void {
  const state = circuit[lang];
  if (state && state.failures > 0) {
    circuit[lang] = { failures: 0, openedAt: undefined };
    logger.info(`Circuit reset for language ${lang} after successful translation`);
  }
}

function jitteredTranslationDelay(baseMs = 5000) {
  // Add 0-1200ms jitter to spread requests
  return baseMs + Math.floor(Math.random() * 1200);
}

export interface WorkerResult {
  didWork: boolean;
  blockedByCooldown: boolean;
  blockedByPostLimit: boolean;
}

export const translateAndPostWorker = async (): Promise<WorkerResult> => {
  const client = new TwitterClient();
  let didWork = false;
  let blockedByCooldown = false;
  let blockedByPostLimit = false;
    
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
        blockedByPostLimit = true;
        break;
      }

      const queuedTweet = tweetQueue.peek();
      if (!queuedTweet) break;

      try {
        // Enforce minimum interval between posts
        const timeSinceLastPost = Date.now() - lastPostTime;
        if (lastPostTime > 0 && timeSinceLastPost < MIN_POST_INTERVAL_MS) {
          const waitMs = MIN_POST_INTERVAL_MS - timeSinceLastPost;
          logger.info(`Enforcing minimum post interval. Waiting ${Math.ceil(waitMs / 1000)}s before next post`);
          blockedByPostLimit = true;
          break;
        }

        logger.info(`Posting queued tweet ${queuedTweet.sourceTweetId} (attempt ${queuedTweet.attemptCount + 1})`);
        await postTweet(client, queuedTweet.finalTranslation);
        logger.info(`Successfully posted queued tweet ${queuedTweet.sourceTweetId}`);
                
        // Record the post and mark original tweet as processed
        postTracker.recordPost();
        tweetTracker.markProcessed(queuedTweet.sourceTweetId);
        tweetQueue.dequeue();
        lastPostTime = Date.now();
                
        // Add delay between posts
        await delay(5000);
      } catch (error: unknown) {
        // If rate limit hit (429 or 403), stop processing queue
        const err = error as { code?: number; message?: string };
        if (err?.code === 429 || err?.code === 403 || err?.message?.includes('429') || err?.message?.includes('403')) {
          logger.error(`Rate limit hit (${err?.code || 'unknown'}) while posting queued tweet. Will retry next run.`);
          tweetQueue.incrementAttempt();
          blockedByPostLimit = true;
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
      return { didWork: false, blockedByCooldown, blockedByPostLimit };
    }
        
    logger.info(`Processing ${tweets.length} new tweet(s)`);
        
    for (const tweet of tweets) {
      logger.info(`Processing tweet ${tweet.id}: ${tweet.text.substring(0, 50)}...`);

      let translationChain = tweet.text;
            
      // Chain translations through all languages with circuit breaker and jittered delays
      for (const lang of config.LANGUAGES) {
        // Skip if circuit open
        if (isCircuitOpen(lang)) {
          logger.warn(`Skipping language ${lang} due to open circuit`);
          continue;
        }
        try {
          translationChain = await translateText(translationChain, lang);
          recordSuccess(lang);
          logger.info(`Translated through ${lang}: ${translationChain.substring(0, 50)}...`);
        } catch (error: unknown) {
          logger.error(`Failed to translate for ${lang}: ${error}`);
          recordFailure(lang);
          // Continue with partial translation rather than failing completely
        }
        // Apply jittered delay after attempt (success or failure) to avoid thundering herd
        await delay(jitteredTranslationDelay());
      }

      // Translate final result back to English (no circuit skip for final step)
      try {
        const finalResult = await translateText(translationChain, 'en');
        logger.info(`Final translation result: ${finalResult}`);
                
        // Check if we should queue instead of posting immediately
        const timeSinceLastPost = Date.now() - lastPostTime;
        const needsInterval = lastPostTime > 0 && timeSinceLastPost < MIN_POST_INTERVAL_MS;
        
        // If queue has items OR we can't post (24h limit, rate limit, or interval), add to queue
        if (!tweetQueue.isEmpty() || !postTracker.canPost() || rateLimitTracker.isRateLimited('post') || needsInterval) {
          const reason = !tweetQueue.isEmpty() ? 'queue not empty' : 
            !postTracker.canPost() ? '24h limit reached' : 
              rateLimitTracker.isRateLimited('post') ? 'rate limited' :
                'minimum interval enforcement';
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
            lastPostTime = Date.now();
                        
            // Add delay between processing different tweets
            await delay(5000);
          } catch (error: unknown) {
            const err = error as { code?: number; message?: string };
            if (err?.code === 429 || err?.code === 403 || err?.message?.includes('429') || err?.message?.includes('403')) {
              logger.error(`Rate limit hit (${err?.code || 'unknown'}) on post. Queueing tweet ${tweet.id} for later.`);
              tweetQueue.enqueue(tweet.id, finalResult);
              blockedByPostLimit = true;
              // Don't process more new tweets this run
              break;
            }
            logger.error(`Failed to post final translation for tweet ${tweet.id}: ${error}`);
            // Queue the tweet to retry later instead of marking as processed
            tweetQueue.enqueue(tweet.id, finalResult);
          }
        }
      } catch (error: unknown) {
        logger.error(`Failed to translate final result for tweet ${tweet.id}: ${error}`);
        // Do NOT mark as processed so it can be retried in future runs
      }
    }
        
    if (!tweetQueue.isEmpty()) {
      logger.info(`Worker complete. ${tweetQueue.size()} tweet(s) remaining in queue for next run.`);
    }
    didWork = tweets.length > 0;
    return { didWork, blockedByCooldown, blockedByPostLimit };
  } catch (error) {
    logger.error(`Error in translateAndPostWorker: ${error}`);
    return { didWork: false, blockedByCooldown, blockedByPostLimit };
  }
};