import { TwitterClient } from './client';
import { logger } from '../utils/logger';
import { splitTweet } from '../utils/tweetSplitter';
import { rateLimitTracker } from '../utils/rateLimitTracker';

// Minimum seconds between posts to avoid hitting rate limits (proactive throttling)
const MIN_POST_INTERVAL_SECONDS = 960; // 16 minutes between posts

export async function postTweet(client: TwitterClient, content: string, sourceTweetId?: string) {
  const isDryRun = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
    
  // Check if we're currently rate limited
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
    let lastRateLimit: { remaining: number; limit: number; reset: number } | undefined;
        
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
            
      // Post as reply to previous tweet in thread (or source tweet for first post)
      const result = await client.postTweet(chunk, previousTweetId);
      previousTweetId = result.data.id;
      lastRateLimit = result.rateLimit;
            
      logger.info(`Posted tweet ${i + 1}/${chunks.length} (ID: ${result.data.id})`);
            
      // Small delay between thread posts
      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    // Note: Caller is responsible for marking as processed to prevent race conditions
    // (postTweet may be called from multiple contexts - queue, retry, main flow)
    
    // PROACTIVE RATE LIMIT HANDLING: Use Twitter's rate limit info to avoid hitting limits
    if (lastRateLimit) {
      const remaining = lastRateLimit.remaining;
      const resetTime = lastRateLimit.reset;
      const secondsUntilReset = Math.max(0, resetTime - Math.floor(Date.now() / 1000));
      
      // If quota is low (<=2 remaining), set cooldown until reset time
      if (remaining <= 2) {
        logger.warn(`[PROACTIVE_LIMIT] Low quota (${remaining} remaining) - setting cooldown until reset at ${new Date(resetTime * 1000).toISOString()}`);
        rateLimitTracker.setRateLimit('post', resetTime);
      } else if (remaining <= 5) {
        // If quota is getting low, space out posts more aggressively
        const cooldownSeconds = Math.max(MIN_POST_INTERVAL_SECONDS, Math.ceil(secondsUntilReset / remaining));
        logger.info(`[PROACTIVE_LIMIT] Moderate quota (${remaining} remaining) - setting ${cooldownSeconds}s cooldown`);
        rateLimitTracker.setCooldown('post', cooldownSeconds, `proactive spacing (${remaining} remaining)`);
      } else {
        // Normal case: set minimum spacing between posts
        rateLimitTracker.setCooldown('post', MIN_POST_INTERVAL_SECONDS, 'proactive post spacing');
        logger.info(`[PROACTIVE_LIMIT] Set ${MIN_POST_INTERVAL_SECONDS}s cooldown after successful post (${remaining} remaining)`);
      }
    } else {
      // No rate limit info available - use default spacing
      rateLimitTracker.setCooldown('post', MIN_POST_INTERVAL_SECONDS, 'proactive post spacing (no quota info)');
      logger.info(`[PROACTIVE_LIMIT] Set ${MIN_POST_INTERVAL_SECONDS}s cooldown (no rate limit info available)`);
    };
        
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
    
    // Check for rate limit indicators in various ways
    const isRateLimited = err?.code === 429 || 
                         err?.code === 403 || 
                         err?.statusCode === 429 || 
                         err?.statusCode === 403 ||
                         err?.rateLimit?.reset ||
                         err?.headers?.['x-rate-limit-reset'] ||
                         err?.message?.includes('429') || 
                         err?.message?.includes('403') ||
                         err?.message?.includes('rate limit') ||
                         err?.message?.includes('Rate limit');
    
    if (isRateLimited) {
      // Try multiple ways to extract reset time
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
      
      // Method 4: Try to parse from error message
      if (!resetTime && err?.message) {
        const resetMatch = err.message.match(/reset[^0-9]*(\d+)/i);
        if (resetMatch) {
          resetTime = Number(resetMatch[1]);
        }
      }
      
      rateLimitTracker.setRateLimit('post', resetTime);
      const resetInfo = resetTime ? `Reset time: ${new Date(resetTime * 1000).toISOString()}` : 'Using fallback 15-minute wait';
      logger.warn(`Post rate limit hit (${err?.code || err?.statusCode || 'unknown'}). ${resetInfo}`);
    } else {
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