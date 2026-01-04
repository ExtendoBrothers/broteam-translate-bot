import fetch from 'node-fetch';
import { Tweet } from '../types';
import { logger } from '../utils/logger';
import { rateLimitTracker } from '../utils/rateLimitTracker';

// Decode Twitter Snowflake ID to get tweet creation timestamp
function snowflakeToDate(snowflakeId: string): Date {
  const TWITTER_EPOCH = 1288834974657; // Nov 04 2010 01:42:54 UTC
  const timestamp = Math.floor(parseInt(snowflakeId) / 4194304) + TWITTER_EPOCH;
  return new Date(timestamp);
}

// Simple fallback fetcher using r.jina.ai to retrieve public timeline HTML.
// This is a best-effort scraper: it may not always return full recent tweets.
export async function fetchTweetsFromJina(username: string, max = 20): Promise<Tweet[]> {
  logger.info(`Starting Jina fetch for ${username}`);
  // TEMP: Enable extra debug logging for Jina HTML parsing
  const debugJinaHtml = true;
  // Check if Jina is rate limited
  if (rateLimitTracker.isRateLimited('jina')) {
    const waitSeconds = rateLimitTracker.getSecondsUntilReset('jina');
    logger.info(`Jina fallback rate limited for ${waitSeconds} more seconds`);
    return [];
  }

  const url = `https://r.jina.ai/https://x.com/${username}`;
  try {
    const resp = await fetch(url, { 
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BroTranslateBot/1.0)' },
      timeout: 15000 // 15s timeout
    });
    if (!resp.ok) {
      logger.error(`Jina fallback HTTP ${resp.status}`);
      if (resp.status === 429) {
        // Rate limited by Jina - set 30 minute cooldown
        rateLimitTracker.setCooldown('jina', 30 * 60, 'Jina rate limit');
      }
      return [];
    }
    const html = await resp.text();
    
    // TEMP: Log the full HTML if debug enabled
    if (debugJinaHtml) {
      logger.info(`[JINA_DEBUG] Full HTML for ${username}:\n` + html.substring(0, 2000) + (html.length > 2000 ? '\n...[truncated]...' : ''));
    }
    // Extract the posts section - split after the posts header
    const postsSection = html.split('Bro Team Pill\'s posts')[1] || html;
    if (debugJinaHtml) {
      logger.info(`[JINA_DEBUG] postsSection for ${username}:\n` + postsSection.substring(0, 2000) + (postsSection.length > 2000 ? '\n...[truncated]...' : ''));
    }
    
    // Only look for status links from BroTeamPills, not quoted/embedded tweets from other users
    // Pattern matches image links that go to BroTeamPills' own status
    const statusRegex = new RegExp(`\\[!\\[Image[^\\]]*\\]\\([^)]+\\)\\]\\(https://x\\.com/${username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/status/(\\d+)/photo`, 'g');
    
    // Also need to avoid quoted tweets - they have pattern like @username status links
    const quotedTweetRegex = /https:\/\/x\.com\/(?!BroTeamPills)[^/]+\/status\/\d+/;
    
    const tweets: Tweet[] = [];
    const seenIds = new Set<string>();
    
    // Split content into lines to process sequentially
    const lines = postsSection.split('\n');
    let currentText = '';
    let skipNext = false; // Flag to skip quoted/embedded tweets
    
    for (let i = 0; i < lines.length && tweets.length < max; i++) {
      const line = lines[i].trim();
      
      // Ignore metadata and section headers
      if (line.match(/^(Title:|URL Source:|Published Time:|Markdown Content:|Image \d+:|---+|@\w+$)/)) {
        continue;
      }

      // If the line is a quoted tweet or reply to someone else, skip it
      if (line.match(/^Quote$/) || line.match(/^Replying to @/) || line.match(quotedTweetRegex)) {
        skipNext = true;
        currentText = '';
        continue;
      }

      // If the line is an image/status link, extract the tweet ID
      const match = statusRegex.exec(lines[i]);
      statusRegex.lastIndex = 0;

      if (match) {
        const id = match[1];
        if (seenIds.has(id)) {
          currentText = '';
          continue;
        }
        seenIds.add(id);

        // The tweet text should be in currentText (accumulated from previous lines)
        let text = currentText
          .replace(/\[Image \d+:[^\]]+\]/g, '')
          .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
          .replace(/\[!\[[^\]]*\]\([^)]+\)\]\([^)]+\)/g, '')
          .replace(/https?:\/\/[^\s]+/g, '')
          .replace(/\d+:\d+/g, '') // Remove timestamps like "0:23"
          .replace(/\s+/g, ' ')
          .trim();

        if (text && text.length >= 5 && !/^(Image|Quote|Replying)/i.test(text)) {
          if (text.length > 280) text = text.slice(0, 277) + '...';
          const createdAt = snowflakeToDate(id);
          tweets.push({
            id,
            text,
            createdAt,
            user: { id: username, username, displayName: username }
          });
          logger.info(`Jina extracted tweet ${id}: ${text.substring(0, 50)}...`);
          if (debugJinaHtml) {
            logger.info(`[JINA_DEBUG] Full tweet ${id}: ${text}`);
          }
        }
        currentText = '';
        skipNext = false;
        continue;
      }

      // If the line is not empty and not a quoted/reply, accumulate text for possible tweet, but do not extract as tweet unless a real ID is found
      if (line && !skipNext) {
        if (currentText) currentText += ' ';
        currentText += line;
      }
      // If the line is empty, just reset currentText
      if (!line) {
        currentText = '';
      }
    }
    return tweets;
  } catch (err) {
    logger.error(`Failed Jina fallback fetch: ${err}`);
    // On error, set a longer cooldown to avoid repeated failures
    rateLimitTracker.setCooldown('jina', 20 * 60, 'error cooldown');
    return [];
  }
}