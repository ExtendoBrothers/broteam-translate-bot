import { TwitterClient } from './client';
import { fetchTweetsFromNitter } from './nitterFeed';
import { fetchTweetsFromJina } from './jinaFetch';
import { fetchFromNitterInstances, fetchFromGoogleCache, fetchFromGoogleSearch } from './nitterScraper';
import { Tweet } from '../types';
import { logger } from '../utils/logger';
import { rateLimitTracker } from '../utils/rateLimitTracker';
import { getCachedUserId, setCachedUserId } from '../utils/userCache';
import { config } from '../config';
import { setEnvVar } from '../utils/envWriter';
import { tweetTracker } from '../utils/tweetTracker';
import { monthlyUsageTracker } from '../utils/monthlyUsageTracker';

export async function fetchTweets(): Promise<Tweet[]> {
  const tweets: Tweet[] = [];
  const targetUsername = config.SOURCE_USERNAME || 'BroTeamPills';
  
  // Use Nitter RSS feed by default (no API limits, no monthly cap)
  if (config.FETCH_METHOD === 'nitter') {
    logger.info(`Fetching tweets via Nitter RSS feed for @${targetUsername}`);
    const nitterTweets = await fetchTweetsFromNitter(targetUsername, 40);
    
    // Filter based on tracker (same logic as Twitter API)
    for (const tweet of nitterTweets) {
      if (tweetTracker.shouldProcess(tweet.id, tweet.createdAt.toISOString())) {
        tweets.push(tweet);
      }
    }
    
    logger.info(`Filtered to ${tweets.length} new tweets from Nitter`);
    
    // Set a cooldown to avoid hammering Nitter instances (45 min, same as Twitter)
    rateLimitTracker.setCooldown('timeline', 45 * 60, 'post-fetch cadence (Nitter)');
    
    return tweets;
  }

  // Fallback: Use Twitter API (has monthly cap issues)
  // If monthly limit reached, attempt alternative source (Jina AI page scrape)
  if (monthlyUsageTracker.isLimitReached()) {
    logger.warn(`Monthly fetch limit (${config.MONTHLY_FETCH_LIMIT}) reached. Attempting alternative fallback sources.`);
    
    // Try Jina first
    try {
      const altTweets = await fetchTweetsFromJina(targetUsername, 20);
      for (const t of altTweets) {
        if (tweetTracker.shouldProcess(t.id, t.createdAt.toISOString())) {
          tweets.push(t);
        }
      }
      logger.info(`Jina fallback fetched ${tweets.length} tweet(s)`);
    } catch (err) {
      logger.error(`Jina fallback failed: ${err}`);
    }
    
    // Also try syndication API
    try {
      const syndicationTweets = await fetchTweetsFromNitter(targetUsername, 40);
      let addedCount = 0;
      for (const t of syndicationTweets) {
        if (tweetTracker.shouldProcess(t.id, t.createdAt.toISOString())) {
          tweets.push(t);
          addedCount++;
        }
      }
      logger.info(`Syndication API fallback added ${addedCount} additional tweet(s)`);
    } catch (err) {
      logger.error(`Syndication API fallback failed: ${err}`);
    }
    
    // Try Nitter instances
    try {
      const nitterTweets = await fetchFromNitterInstances(targetUsername, 20);
      let addedCount = 0;
      for (const t of nitterTweets) {
        if (tweetTracker.shouldProcess(t.id, t.createdAt.toISOString())) {
          tweets.push(t);
          addedCount++;
        }
      }
      logger.info(`Nitter instances added ${addedCount} additional tweet(s)`);
    } catch (err) {
      logger.error(`Nitter instances failed: ${err}`);
    }
    
    // Try Google Cache
    try {
      const cacheTweets = await fetchFromGoogleCache(targetUsername, 20);
      let addedCount = 0;
      for (const t of cacheTweets) {
        if (tweetTracker.shouldProcess(t.id, t.createdAt.toISOString())) {
          tweets.push(t);
          addedCount++;
        }
      }
      logger.info(`Google Cache added ${addedCount} additional tweet(s)`);
    } catch (err) {
      logger.error(`Google Cache failed: ${err}`);
    }
    
    // Try Google Search
    try {
      const searchTweets = await fetchFromGoogleSearch(targetUsername, 20);
      let addedCount = 0;
      for (const t of searchTweets) {
        if (tweetTracker.shouldProcess(t.id, t.createdAt.toISOString())) {
          tweets.push(t);
          addedCount++;
        }
      }
      logger.info(`Google Search added ${addedCount} additional tweet(s)`);
    } catch (err) {
      logger.error(`Google Search failed: ${err}`);
    }
    
    return tweets; // Do not attempt API when limit reached
  }

  logger.info(`Fetching tweets via Twitter API for @${targetUsername}`);
  
  // Check timeline read bucket
  if (rateLimitTracker.isRateLimited('timeline')) {
    const waitSeconds = rateLimitTracker.getSecondsUntilReset('timeline');
    logger.info(`Skipping fetch - timeline rate limited for ${waitSeconds} more seconds`);
    
    // Try Jina fallback when rate limited before even making the call
    logger.warn('Twitter API rate limited (pre-check). Attempting Jina fallback.');
    try {
      const jinaFallbackTweets = await fetchTweetsFromJina(targetUsername, 20);
      for (const t of jinaFallbackTweets) {
        if (tweetTracker.shouldProcess(t.id, t.createdAt.toISOString())) {
          tweets.push(t);
        }
      }
      logger.info(`Jina fallback retrieved ${tweets.length} tweet(s) while rate limited`);
    } catch (fallbackErr) {
      logger.error(`Jina fallback failed: ${fallbackErr}`);
    }
    
    // Also try syndication API fallback (different source, might have different tweets)
    logger.info('Attempting syndication API fallback as additional source.');
    try {
      const syndicationTweets = await fetchTweetsFromNitter(targetUsername, 40);
      let addedCount = 0;
      for (const t of syndicationTweets) {
        if (tweetTracker.shouldProcess(t.id, t.createdAt.toISOString())) {
          tweets.push(t);
          addedCount++;
        }
      }
      logger.info(`Syndication API fallback added ${addedCount} additional tweet(s)`);
    } catch (syndicationErr) {
      logger.error(`Syndication API fallback failed: ${syndicationErr}`);
    }
    
    // Try Nitter instances as third fallback
    logger.info('Attempting Nitter instances fallback.');
    try {
      const nitterTweets = await fetchFromNitterInstances(targetUsername, 20);
      let addedCount = 0;
      for (const t of nitterTweets) {
        if (tweetTracker.shouldProcess(t.id, t.createdAt.toISOString())) {
          tweets.push(t);
          addedCount++;
        }
      }
      logger.info(`Nitter instances added ${addedCount} additional tweet(s)`);
    } catch (nitterErr) {
      logger.error(`Nitter instances failed: ${nitterErr}`);
    }
    
    // Try Google Cache as fourth fallback
    logger.info('Attempting Google Cache fallback.');
    try {
      const cacheTweets = await fetchFromGoogleCache(targetUsername, 20);
      let addedCount = 0;
      for (const t of cacheTweets) {
        if (tweetTracker.shouldProcess(t.id, t.createdAt.toISOString())) {
          tweets.push(t);
          addedCount++;
        }
      }
      logger.info(`Google Cache added ${addedCount} additional tweet(s)`);
    } catch (cacheErr) {
      logger.error(`Google Cache failed: ${cacheErr}`);
    }
    
    // Try Google Search as fifth fallback
    logger.info('Attempting Google Search fallback.');
    try {
      const searchTweets = await fetchFromGoogleSearch(targetUsername, 20);
      let addedCount = 0;
      for (const t of searchTweets) {
        if (tweetTracker.shouldProcess(t.id, t.createdAt.toISOString())) {
          tweets.push(t);
          addedCount++;
        }
      }
      logger.info(`Google Search added ${addedCount} additional tweet(s)`);
    } catch (searchErr) {
      logger.error(`Google Search failed: ${searchErr}`);
    }
    
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
    // Record intended API usage BEFORE making the call (only if not rate limited and limit not reached)
    monthlyUsageTracker.incrementFetch();
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
        
    // Enforce 45-minute cadence to avoid immediately consuming the next API window.
    // Twitter free tier: 1 GET per 15 minutes. Running every 30min would hit the limit
    // as soon as it resets. 45min ensures we skip at least one reset window.
    rateLimitTracker.setCooldown('timeline', 45 * 60, 'post-fetch cadence enforcement');
  } catch (error: unknown) {
    // Log the complete error object for debugging
    logger.error(`Twitter API Error (raw): ${JSON.stringify(error, null, 2)}`);
    
    // Handle rate limit errors and extract reset time
    const err = error as { code?: number; rateLimit?: { reset?: number }; headers?: Record<string, string>; message?: string };
    if (err?.code === 429 || err?.rateLimit?.reset) {
      const resetTime = err?.rateLimit?.reset || (err?.headers?.['x-rate-limit-reset'] ? Number(err.headers['x-rate-limit-reset']) : undefined);
      rateLimitTracker.setRateLimit('timeline', resetTime);
      
      // Try Jina fallback when we hit 429 rate limit
      logger.warn('Twitter API rate limited (429). Attempting Jina fallback.');
      try {
        const jinaFallbackTweets = await fetchTweetsFromJina(targetUsername, 20);
        for (const t of jinaFallbackTweets) {
          if (tweetTracker.shouldProcess(t.id, t.createdAt.toISOString())) {
            tweets.push(t);
          }
        }
        logger.info(`Jina fallback retrieved ${tweets.length} tweet(s) after 429 error`);
      } catch (fallbackErr) {
        logger.error(`Jina fallback also failed: ${fallbackErr}`);
      }
      
      // Also try syndication API fallback
      logger.info('Attempting syndication API fallback as additional source.');
      try {
        const syndicationTweets = await fetchTweetsFromNitter(targetUsername, 40);
        let addedCount = 0;
        for (const t of syndicationTweets) {
          if (tweetTracker.shouldProcess(t.id, t.createdAt.toISOString())) {
            tweets.push(t);
            addedCount++;
          }
        }
        logger.info(`Syndication API fallback added ${addedCount} additional tweet(s)`);
      } catch (syndicationErr) {
        logger.error(`Syndication API fallback failed: ${syndicationErr}`);
      }
      
      // Try Nitter instances
      try {
        const nitterTweets = await fetchFromNitterInstances(targetUsername, 20);
        let addedCount = 0;
        for (const t of nitterTweets) {
          if (tweetTracker.shouldProcess(t.id, t.createdAt.toISOString())) {
            tweets.push(t);
            addedCount++;
          }
        }
        logger.info(`Nitter instances added ${addedCount} additional tweet(s)`);
      } catch (nitterErr) {
        logger.error(`Nitter instances failed: ${nitterErr}`);
      }
      
      // Try Google Cache
      try {
        const cacheTweets = await fetchFromGoogleCache(targetUsername, 20);
        let addedCount = 0;
        for (const t of cacheTweets) {
          if (tweetTracker.shouldProcess(t.id, t.createdAt.toISOString())) {
            tweets.push(t);
            addedCount++;
          }
        }
        logger.info(`Google Cache added ${addedCount} additional tweet(s)`);
      } catch (cacheErr) {
        logger.error(`Google Cache failed: ${cacheErr}`);
      }
      
      // Try Google Search
      try {
        const searchTweets = await fetchFromGoogleSearch(targetUsername, 20);
        let addedCount = 0;
        for (const t of searchTweets) {
          if (tweetTracker.shouldProcess(t.id, t.createdAt.toISOString())) {
            tweets.push(t);
            addedCount++;
          }
        }
        logger.info(`Google Search added ${addedCount} additional tweet(s)`);
      } catch (searchErr) {
        logger.error(`Google Search failed: ${searchErr}`);
      }
    } else if (err?.message?.includes('429')) {
      rateLimitTracker.setRateLimit('timeline');
      
      // Try Jina fallback for string-based 429 detection too
      logger.warn('Twitter API rate limited (string 429). Attempting Jina fallback.');
      try {
        const jinaFallbackTweets = await fetchTweetsFromJina(targetUsername, 20);
        for (const t of jinaFallbackTweets) {
          if (tweetTracker.shouldProcess(t.id, t.createdAt.toISOString())) {
            tweets.push(t);
          }
        }
        logger.info(`Jina fallback retrieved ${tweets.length} tweet(s) after 429 error`);
      } catch (fallbackErr) {
        logger.error(`Jina fallback also failed: ${fallbackErr}`);
      }
      
      // Also try syndication API fallback
      logger.info('Attempting syndication API fallback as additional source.');
      try {
        const syndicationTweets = await fetchTweetsFromNitter(targetUsername, 40);
        let addedCount = 0;
        for (const t of syndicationTweets) {
          if (tweetTracker.shouldProcess(t.id, t.createdAt.toISOString())) {
            tweets.push(t);
            addedCount++;
          }
        }
        logger.info(`Syndication API fallback added ${addedCount} additional tweet(s)`);
      } catch (syndicationErr) {
        logger.error(`Syndication API fallback failed: ${syndicationErr}`);
      }
      
      // Try Nitter instances
      try {
        const nitterTweets = await fetchFromNitterInstances(targetUsername, 20);
        let addedCount = 0;
        for (const t of nitterTweets) {
          if (tweetTracker.shouldProcess(t.id, t.createdAt.toISOString())) {
            tweets.push(t);
            addedCount++;
          }
        }
        logger.info(`Nitter instances added ${addedCount} additional tweet(s)`);
      } catch (nitterErr) {
        logger.error(`Nitter instances failed: ${nitterErr}`);
      }
      
      // Try Google Cache
      try {
        const cacheTweets = await fetchFromGoogleCache(targetUsername, 20);
        let addedCount = 0;
        for (const t of cacheTweets) {
          if (tweetTracker.shouldProcess(t.id, t.createdAt.toISOString())) {
            tweets.push(t);
            addedCount++;
          }
        }
        logger.info(`Google Cache added ${addedCount} additional tweet(s)`);
      } catch (cacheErr) {
        logger.error(`Google Cache failed: ${cacheErr}`);
      }
      
      // Try Google Search
      try {
        const searchTweets = await fetchFromGoogleSearch(targetUsername, 20);
        let addedCount = 0;
        for (const t of searchTweets) {
          if (tweetTracker.shouldProcess(t.id, t.createdAt.toISOString())) {
            tweets.push(t);
            addedCount++;
          }
        }
        logger.info(`Google Search added ${addedCount} additional tweet(s)`);
      } catch (searchErr) {
        logger.error(`Google Search failed: ${searchErr}`);
      }
    } else {
      logger.error(`Error fetching tweets: ${error}`);
    }
  }

  return tweets;
}