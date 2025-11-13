import { TwitterClient } from './client';
import { Tweet } from '../types';
import { logger } from '../utils/logger';
import { rateLimitTracker } from '../utils/rateLimitTracker';
import { getCachedUserId, setCachedUserId } from '../utils/userCache';
import { config } from '../config';
import { setEnvVar } from '../utils/envWriter';
import { tweetTracker } from '../utils/tweetTracker';

export async function fetchTweets(): Promise<Tweet[]> {
  const tweets: Tweet[] = [];

  // Check timeline read bucket
  if (rateLimitTracker.isRateLimited('timeline')) {
    const waitSeconds = rateLimitTracker.getSecondsUntilReset('timeline');
    logger.info(`Skipping fetch - timeline rate limited for ${waitSeconds} more seconds`);
    return tweets;
  }

  const client = new TwitterClient();

  try {
    // Resolve user ID with persistent cache to avoid extra GET on each run
    const targetUsername = config.SOURCE_USERNAME || 'BroTeamPills';
    // Prefer env-provided ID if set
    let targetUserId = config.SOURCE_USER_ID || getCachedUserId(targetUsername);
    let didLookup = false;
    if (!targetUserId) {
      if (rateLimitTracker.isRateLimited('user-lookup')) {
        const waitSeconds = rateLimitTracker.getSecondsUntilReset('user-lookup');
        logger.info(`Skipping user lookup - rate limited for ${waitSeconds} more seconds`);
        return tweets;
      }
      const user = await client.getUserByUsername(targetUsername);
      if (!user.data) {
        logger.error('Could not find user @BroTeamPills');
        return tweets;
      }
      targetUserId = user.data.id;
      setCachedUserId(targetUsername, targetUserId);
      didLookup = true;
      logger.info(`Cached @${targetUsername} userId=${targetUserId}`);
      // Persist in .env as it won't change
      setEnvVar('SOURCE_USER_ID', targetUserId);
    }

    // If we just performed a username lookup, avoid making a second GET (timeline)
    // in the same 15-min window to comply with strict free-tier limits.
    if (didLookup) {
      logger.info('Performed username lookup this run; skipping timeline fetch to respect 1 GET/15min limit. Will fetch timeline next run.');
      return tweets;
    }
        
    // Fetch user timeline - get multiple recent tweets to catch up on any missed ones
    // Free tier: 1 fetch request per 15 minutes, 17 posts per 24 hours
    // We only post the final English translation (1 post per source tweet).
    // Increase batch size to 40 to maximize catch-up in a single allowed request.
    const timeline = await client.getUserTimeline(targetUserId, {
      max_results: 40,  // Increased to 40 per user request
      'tweet.fields': ['created_at', 'text', 'entities']
    });

    const expandUrls = (text: string, entities: Record<string, unknown> | undefined): string => {
      if (!entities?.urls || !Array.isArray(entities.urls)) return text;
      let out = text;
      for (const u of entities.urls) {
        const short = u?.url;
        const expanded = u?.unwound_url || u?.expanded_url || u?.display_url;
        if (short && expanded && typeof short === 'string' && typeof expanded === 'string') {
          // Replace all occurrences of the t.co URL with the expanded URL
          const rx = new RegExp(short.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
          out = out.replace(rx, expanded);
        }
      }
      return out;
    };

    for (const tweet of timeline.data.data || []) {
      // Check if tweet should be processed (not already processed and after start date)
      if (!tweetTracker.shouldProcess(tweet.id, tweet.created_at || new Date().toISOString())) {
        continue;
      }
            
      const expandedText = expandUrls(tweet.text, (tweet as { entities?: Record<string, unknown> }).entities);
      tweets.push({
        id: tweet.id,
        text: expandedText,
        createdAt: new Date(tweet.created_at || Date.now()),
        user: {
          id: targetUserId,
          username: targetUsername,
          displayName: targetUsername
        }
      });
    }
        
    logger.info(`Fetched ${tweets.length} tweets from @BroTeamPills`);
        
    // Enforce 30-minute cadence regardless of API header presence
    // Persist a cooldown so restarts don't trigger an early fetch
    rateLimitTracker.setCooldown('timeline', 30 * 60, 'post-fetch cadence enforcement');
  } catch (error: unknown) {
    // Handle rate limit errors and extract reset time
    const err = error as { code?: number; rateLimit?: { reset?: number }; headers?: Record<string, string>; message?: string };
    if (err?.code === 429 || err?.rateLimit?.reset) {
      const resetTime = err?.rateLimit?.reset || (err?.headers?.['x-rate-limit-reset'] ? Number(err.headers['x-rate-limit-reset']) : undefined);
      rateLimitTracker.setRateLimit('timeline', resetTime);
    } else if (err?.message?.includes('429')) {
      rateLimitTracker.setRateLimit('timeline');
    } else {
      logger.error(`Error fetching tweets: ${error}`);
    }
  }

  return tweets;
}