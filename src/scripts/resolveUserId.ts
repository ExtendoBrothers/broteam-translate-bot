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
    if (e?.code === 429 || String(e?.message).includes('429')) {
      const resetTime = e?.rateLimit?.reset || e?.headers?.['x-rate-limit-reset'];
      rateLimitTracker.setRateLimit('user-lookup', resetTime);
      const wait = rateLimitTracker.getSecondsUntilReset('user-lookup');
      logger.warn(`Resolver: hit 429. Persisted reset; next attempt after ${wait}s. Exiting.`);
      process.exit(0);
    }
    logger.error(`Failed to resolve user id for @${username}: ${e}`);
    process.exit(1);
  }
})();
