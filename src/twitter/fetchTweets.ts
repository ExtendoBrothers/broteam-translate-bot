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
import * as fs from 'fs';
import * as path from 'path';

const LAST_TWITTER_API_FETCH_FILE = path.join(process.cwd(), '.last-twitter-api-fetch.json');

function readLastTwitterApiFetch(): Date | null {
  try {
    if (!fs.existsSync(LAST_TWITTER_API_FETCH_FILE)) return null;
    const raw = fs.readFileSync(LAST_TWITTER_API_FETCH_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as { lastFetch?: string };
    const dt = new Date(parsed.lastFetch || '');
    return isFinite(dt.getTime()) ? dt : null;
  } catch {
    return null;
  }
}

function recordTwitterApiFetch(when: Date) {
  try {
    const tmp = LAST_TWITTER_API_FETCH_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ lastFetch: when.toISOString() }, null, 2), 'utf-8');
    fs.renameSync(tmp, LAST_TWITTER_API_FETCH_FILE);
  } catch {
    // ignore
  }
}

export async function fetchTweets(): Promise<Tweet[]> {
    try {
      require('fs').appendFileSync(require('path').join(process.cwd(), 'translation-logs', 'translation-debug.log'), `[DEBUG] fetchTweets entry at ${new Date().toISOString()}\n`, 'utf8');
    } catch {}
  const tweets: Tweet[] = [];
  const targetUsername = config.SOURCE_USERNAME || 'BroTeamPills';
  
  // Always run fallback sources every 30 minutes (called by worker)
  logger.info('Fetching from fallback sources...');
  
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
  
  // Try syndication API
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
  
  // Always process manual tweet inputs
  try {
    fs.appendFileSync(path.join(process.cwd(), 'translation-logs', 'translation-debug.log'), `[DEBUG] Entered manual input block in fetchTweets\n`, 'utf8');
    const inputLogPath = path.resolve(process.cwd(), 'tweet-inputs.log');
    if (fs.existsSync(inputLogPath)) {
      fs.appendFileSync(path.join(process.cwd(), 'translation-logs', 'translation-debug.log'), `[DEBUG] tweet-inputs.log exists, reading file\n`, 'utf8');
      const content = fs.readFileSync(inputLogPath, 'utf8');
      fs.appendFileSync(path.join(process.cwd(), 'translation-logs', 'translation-debug.log'), `[DEBUG] tweet-inputs.log content length: ${content.length}\n`, 'utf8');
      const lines = content.split('\n').map(line => line.trim());
      fs.appendFileSync(path.join(process.cwd(), 'translation-logs', 'translation-debug.log'), `[DEBUG] tweet-inputs.log lines count: ${lines.length}\n`, 'utf8');
      let addedCount = 0;
      for (const line of lines) {
        fs.appendFileSync(path.join(process.cwd(), 'translation-logs', 'translation-debug.log'), `[DEBUG] Processing line: '${line}'\n`, 'utf8');
        const match = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z) \[(\d+)\] (.+)$/);
        if (match) {
          fs.appendFileSync(path.join(process.cwd(), 'translation-logs', 'translation-debug.log'), `[DEBUG] Regex matched: ${JSON.stringify(match)}\n`, 'utf8');
          const [, , idStr, text] = match;
          const id = idStr;
          const trimmedText = text.trim();
          const shouldProc = tweetTracker.shouldProcess(id, new Date().toISOString());
          fs.appendFileSync(path.join(process.cwd(), 'translation-logs', 'translation-debug.log'), `[DEBUG] Manual input match: id=${id}, text=${trimmedText}, shouldProcess=${shouldProc}\n`, 'utf8');
          if (shouldProc) {
            tweets.push({
              id,
              text: trimmedText,
              createdAt: new Date(),
              user: {
                id: targetUsername, // placeholder
                username: targetUsername,
                displayName: targetUsername
              }
            });
            addedCount++;
          }
        } else {
          fs.appendFileSync(path.join(process.cwd(), 'translation-logs', 'translation-debug.log'), `[DEBUG] Regex did NOT match line: '${line}'\n`, 'utf8');
        }
      }
      logger.info(`Tweet inputs log added ${addedCount} additional tweet(s)`);
      fs.appendFileSync(path.join(process.cwd(), 'translation-logs', 'translation-debug.log'), `[DEBUG] Manual input block completed, addedCount=${addedCount}\n`, 'utf8');
    } else {
      fs.appendFileSync(path.join(process.cwd(), 'translation-logs', 'translation-debug.log'), `[DEBUG] tweet-inputs.log does NOT exist\n`, 'utf8');
    }
  } catch (err) {
    logger.error(`Tweet inputs log fallback failed: ${err}`);
    try {
      fs.appendFileSync(path.join(process.cwd(), 'translation-logs', 'translation-debug.log'), `[ERROR] Manual input block exception: ${err}\n`, 'utf8');
    } catch (e2) {
      console.error('[ERROR] Failed to write manual input block exception debug log:', e2);
    }
  }
  
  // Check if we should also use Twitter API based on monthly spacing
  const monthKey = monthlyUsageTracker.getCurrentMonthKey();
  const used = monthlyUsageTracker.getFetchCount(monthKey);
  const limit = config.MONTHLY_FETCH_LIMIT;
  const remaining = Math.max(0, limit - used);
  
  let shouldUseTwitterApi = false;
  if (remaining === 0) {
    logger.info(`Twitter API monthly limit (${limit}) reached. Skipping Twitter API this run.`);
  } else {
    // Calculate if enough time has passed for next Twitter API fetch
    const now = new Date();
    const endOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const hoursLeft = (endOfMonth.getTime() - now.getTime()) / 3600000;
    const intervalHours = hoursLeft / remaining; // spread evenly across month
    const clampedHours = Math.min(Math.max(intervalHours, 0.5), 24); // min 30m, max 24h
    const targetMs = clampedHours * 3600000;
    
    const lastTwitterApiFetch = readLastTwitterApiFetch();
    const elapsedMs = lastTwitterApiFetch ? (now.getTime() - lastTwitterApiFetch.getTime()) : Number.MAX_SAFE_INTEGER;
    
    if (elapsedMs >= targetMs) {
      logger.info(`Twitter API fetch interval met (${Math.ceil(elapsedMs/3600000)}h elapsed, need ${clampedHours.toFixed(1)}h). Using ${used}/${limit} this month.`);
      shouldUseTwitterApi = true;
    } else {
      const waitHours = (targetMs - elapsedMs) / 3600000;
      logger.info(`Twitter API spacing: need ${clampedHours.toFixed(1)}h between fetches, ${waitHours.toFixed(1)}h remaining. Skipping Twitter API. (${used}/${limit} this month)`);
    }
  }
  
  // If Twitter API spacing not met or limit reached, return fallback results
  if (!shouldUseTwitterApi) {
    logger.info(`Returning ${tweets.length} tweet(s) from fallback sources`);
    return tweets;
  }
  
  // Otherwise continue with Twitter API fetch
  logger.info('Proceeding with Twitter API fetch...');
  
  // Check timeline read bucket  
  if (rateLimitTracker.isRateLimited('timeline')) {
    const waitSeconds = rateLimitTracker.getSecondsUntilReset('timeline');
    logger.info(`Skipping Twitter API - timeline rate limited for ${waitSeconds} more seconds. Returning ${tweets.length} tweet(s) from fallbacks.`);
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
    const fetchTime = new Date();
    monthlyUsageTracker.incrementFetch();
    recordTwitterApiFetch(fetchTime);
    logger.info(`Using Twitter API (fetch ${used + 1}/${limit} this month)`);
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