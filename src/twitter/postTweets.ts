import { TwitterClient } from './client';
import { logger } from '../utils/logger';
import { splitTweet } from '../utils/tweetSplitter';
import { rateLimitTracker } from '../utils/rateLimitTracker';

export async function postTweet(client: TwitterClient, content: string) {
  const isDryRun = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
    
  // Check if we're currently rate limited
  if (rateLimitTracker.isRateLimited('post')) {
    const waitSeconds = rateLimitTracker.getSecondsUntilReset('post');
    logger.info(`Skipping post - rate limited for ${waitSeconds} more seconds`);
    return null;
  }
    
  // Split tweet if it exceeds 275 characters
  const chunks = splitTweet(content);
    
  if (isDryRun) {
    if (chunks.length > 1) {
      logger.info(`[DRY_RUN] Would post ${chunks.length}-part thread:`);
      chunks.forEach((chunk, i) => {
        logger.info(`[DRY_RUN] Part ${i + 1}: ${chunk.substring(0, 100)}${chunk.length > 100 ? '...' : ''}`);
      });
    } else {
      logger.info(`[DRY_RUN] Would post tweet: ${content.substring(0, 100)}${content.length > 100 ? '...' : ''}`);
    }
    return null;
  }
    
  try {
    let previousTweetId: string | undefined = undefined;
        
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
            
      // Post as reply to previous tweet in thread
      const result = await client.postTweet(chunk, previousTweetId);
      previousTweetId = result.id;
            
      logger.info(`Posted tweet ${i + 1}/${chunks.length} (ID: ${result.id})`);
            
      // Small delay between thread posts
      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
        
    return { id: previousTweetId, threadLength: chunks.length };
  } catch (error: unknown) {
    // Handle rate limit errors and extract reset time
    const err = error as { code?: number; rateLimit?: { reset?: number }; headers?: Record<string, string>; message?: string };
    if (err?.code === 429 || err?.rateLimit?.reset) {
      const resetTime = err?.rateLimit?.reset || (err?.headers?.['x-rate-limit-reset'] ? Number(err.headers['x-rate-limit-reset']) : undefined);
      rateLimitTracker.setRateLimit('post', resetTime);
    } else if (err?.message?.includes('429')) {
      rateLimitTracker.setRateLimit('post');
    } else {
      logger.error(`Failed to post tweet: ${error}`);
    }
    throw error;
  }
}