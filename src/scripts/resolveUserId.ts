/* eslint-disable no-console, @typescript-eslint/no-explicit-any */
import 'dotenv/config';
import { TwitterClient } from '../twitter/client';
import { config } from '../config';
import { logger } from '../utils/logger';
import { setCachedUserId } from '../utils/userCache';
import { setEnvVar } from '../utils/envWriter';
import { rateLimitTracker } from '../utils/rateLimitTracker';

(async () => {
  const username = config.SOURCE_USERNAME || 'BroTeamPills';

  // Respect user-lookup rate-limit before making any request
  if (rateLimitTracker.isRateLimited('user-lookup')) {
    const wait = rateLimitTracker.getSecondsUntilReset('user-lookup');
    logger.warn(`Resolver: globally rate limited. Skipping lookup for ${wait}s.`);
    process.exit(0);
  }

  const client = new TwitterClient();
  try {
    const res = await client.getUserByUsername(username);
    if (!res.data) {
      logger.error(`Could not find user @${username}`);
      process.exit(1);
    }
    const userId = res.data.id;
    setCachedUserId(username, userId);
    setEnvVar('SOURCE_USER_ID', userId);
    logger.info(`Resolved @${username} -> ${userId}`);
    console.log(`SOURCE_USER_ID=${userId}`);
    process.exit(0);
  } catch (e: any) {
    // Check for rate limit indicators
    const isRateLimited = e?.code === 429 || 
                         e?.statusCode === 429 ||
                         e?.rateLimit?.reset ||
                         e?.headers?.['x-rate-limit-reset'] ||
                         String(e?.message).includes('429') ||
                         String(e?.message).includes('rate limit') ||
                         String(e?.message).includes('Rate limit');
    
    if (isRateLimited) {
      // Try multiple ways to extract reset time
      let resetTime: number | undefined;
      
      // Method 1: From error.rateLimit.reset
      if (e?.rateLimit?.reset) {
        resetTime = e.rateLimit.reset;
      }
      
      // Method 2: From headers
      if (!resetTime && e?.headers?.['x-rate-limit-reset']) {
        resetTime = Number(e.headers['x-rate-limit-reset']);
      }
      
      // Method 3: From error data
      if (!resetTime && e?.data?.rateLimit?.reset) {
        resetTime = e.data.rateLimit.reset;
      }
      
      rateLimitTracker.setRateLimit('user-lookup', resetTime);
      const wait = rateLimitTracker.getSecondsUntilReset('user-lookup');
      const resetInfo = resetTime ? `Reset time: ${new Date(resetTime * 1000).toISOString()}` : 'Using fallback 15-minute wait';
      logger.warn(`Resolver: hit rate limit. ${resetInfo}. Persisted reset; next attempt after ${wait}s. Exiting.`);
      process.exit(0);
    }
    logger.error(`Failed to resolve user id for @${username}: ${e}`);
    process.exit(1);
  }
})();
