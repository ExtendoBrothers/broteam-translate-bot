import { TwitterClient } from './client';
import { logger } from '../utils/logger';
import { splitTweet } from '../utils/tweetSplitter';
import { rateLimitTracker } from '../utils/rateLimitTracker';

// Minimum seconds between posts to avoid hitting rate limits (proactive throttling)
// Twitter allows 17 posts per 24 hours, so ~85 minutes between posts would be safe
// Using 17 minutes as a balance between throughput and safety
const MIN_POST_INTERVAL_SECONDS = 17 * 60; // 17 minutes between posts

export async function postTweet(client: TwitterClient, content: string, sourceTweetId?: string) {
  const isDryRun = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
    
  // SIMPLE CHECK: Load rate limit from file. If in future, skip. If in past, post.
  if (rateLimitTracker.isRateLimited('post')) {
    const waitSeconds = rateLimitTracker.getSecondsUntilReset('post');
    const nextAllowed = new Date(Date.now() + waitSeconds * 1000).toISOString();
    logger.info(`[RATE_LIMIT] Skipping post - rate limited for ${waitSeconds} more seconds. Next allowed post: ${nextAllowed}, current time: ${new Date().toISOString()}`);
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
    let previousTweetId: string | undefined = sourceTweetId;
        
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
            
      // Post as reply to previous tweet in thread (or source tweet for first post)
      const result = await client.postTweet(chunk, previousTweetId);
      previousTweetId = result.data.id;
            
      logger.info(`Posted tweet ${i + 1}/${chunks.length} (ID: ${result.data.id})`);
            
      // Small delay between thread posts
      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    // Note: Caller is responsible for marking as processed to prevent race conditions
    // (postTweet may be called from multiple contexts - queue, retry, main flow)
    
    // ALWAYS set 17-minute cooldown after ANY successful post
    rateLimitTracker.setCooldown('post', MIN_POST_INTERVAL_SECONDS, 'proactive post spacing');
    logger.info(`[PROACTIVE_LIMIT] Set ${MIN_POST_INTERVAL_SECONDS}s (${MIN_POST_INTERVAL_SECONDS / 60}min) cooldown after successful post`);
        
    return { id: previousTweetId, threadLength: chunks.length };
  } catch (error: unknown) {
    // Handle rate limit errors (429 and 403) and extract reset time
    const err = error as { 
      code?: number; 
      rateLimit?: { reset?: number }; 
      headers?: Record<string, string>; 
      message?: string;
      statusCode?: number;
      data?: any;
    };
    
    // Check for rate limit indicators (only 429, not 403 which is Forbidden/Auth)
    const isRateLimited = err?.code === 429 || 
                         err?.statusCode === 429 ||
                         err?.rateLimit?.reset ||
                         err?.headers?.['x-rate-limit-reset'] ||
                         err?.message?.includes('429') || 
                         err?.message?.includes('rate limit') ||
                         err?.message?.includes('Rate limit');
    
    if (isRateLimited) {
      // Extract reset time from Twitter's response
      let resetTime: number | undefined;
      
      // Method 1: From error.rateLimit.reset
      if (err?.rateLimit?.reset) {
        resetTime = err.rateLimit.reset;
      }
      
      // Method 2: From headers
      if (!resetTime && err?.headers?.['x-rate-limit-reset']) {
        resetTime = Number(err.headers['x-rate-limit-reset']);
      }
      
      // Method 3: From error data
      if (!resetTime && err?.data?.rateLimit?.reset) {
        resetTime = err.data.rateLimit.reset;
      }
      
      // Set rate limit to Twitter's reset time + 2 minutes (or 17min fallback if no reset time)
      rateLimitTracker.setRateLimit('post', resetTime);
      const resetInfo = resetTime ? `Twitter reset: ${new Date(resetTime * 1000).toISOString()}` : 'No reset time available';
      logger.warn(`Post rate limit hit (429). ${resetInfo}`);
    } else {
      // Non-rate-limit error - still set 17-minute cooldown
      rateLimitTracker.setCooldown('post', MIN_POST_INTERVAL_SECONDS, 'cooldown after non-rate-limit error');
      logger.info(`[PROACTIVE_LIMIT] Set ${MIN_POST_INTERVAL_SECONDS}s cooldown after post error`);
      
      // Log detailed error information for debugging
      const errorDetails = {
        message: err?.message || 'Unknown error',
        code: err?.code || err?.statusCode || 'unknown',
        statusCode: err?.statusCode,
        data: err?.data,
        stack: (error as Error)?.stack
      };
      logger.error('Failed to post tweet with detailed error:', errorDetails);
      logger.error(`Tweet content that failed: "${content.substring(0, 200)}${content.length > 200 ? '...' : ''}"`);
    }
    throw error;
  }
}