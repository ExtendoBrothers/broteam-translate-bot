import { TwitterClient } from './client';
import { logger } from '../utils/logger';
import { splitTweet } from '../utils/tweetSplitter';
import { rateLimitTracker } from '../utils/rateLimitTracker';
import { tweetTracker } from '../utils/tweetTracker';

export async function postTweet(client: TwitterClient, content: string, sourceTweetId?: string) {
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
    
    // Mark source tweet as processed only after successful posting
    if (sourceTweetId) {
      tweetTracker.markProcessed(sourceTweetId);
      logger.info(`Marked source tweet ${sourceTweetId} as processed after successful post`);
    }
        
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
      logger.error(`Failed to post tweet: ${error}`);
    }
    throw error;
  }
}