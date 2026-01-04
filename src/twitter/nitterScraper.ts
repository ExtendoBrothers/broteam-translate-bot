import fetch from 'node-fetch';
import { Tweet } from '../types';
import { logger } from '../utils/logger';
import { rateLimitTracker } from '../utils/rateLimitTracker';

// Decode Twitter Snowflake ID to get tweet creation timestamp
function snowflakeToDate(snowflakeId: string): Date {
  const TWITTER_EPOCH = 1288834974657;
  const timestamp = Math.floor(parseInt(snowflakeId) / 4194304) + TWITTER_EPOCH;
  return new Date(timestamp);
}

/**
 * Try various Nitter instances via RSS feeds
 * RSS is more reliable than HTML scraping and less prone to bot detection
 */
export async function fetchFromNitterInstances(username: string, max = 20): Promise<Tweet[]> {
  if (rateLimitTracker.isRateLimited('nitter-scraper')) {
    const waitSeconds = rateLimitTracker.getSecondsUntilReset('nitter-scraper');
    logger.info(`Nitter scraper rate limited for ${waitSeconds} more seconds`);
    return [];
  }

  // Try RSS feeds - more reliable than HTML scraping
  // Expanded list of public Nitter instances (some may be unreliable or rate-limited)
  const instances = [
    'nitter.lucabased.xyz',
    'nitter.net',
    'nitter.poast.org',
    'nitter.cz',
    'nitter.privacydev.net',
    'nitter.moomoo.me',
    'nitter.1d4.us',
    'nitter.nixnet.services',
    'nitter.pussthecat.org',
    'nitter.unixfox.eu',
    'nitter.42l.fr',
    'nitter.fdn.fr',
    'nitter.13ad.de',
    'nitter.mha.fi',
    'nitter.kavin.rocks',
    'nitter.bus-hit.me',
    'nitter.tedomum.net',
    'nitter.inpt.fr',
    'nitter.it',
    'nitter.mint.lgbt',
    'nitter.nohost.network',
    'nitter.catsarch.com',
    'nitter.privacy.com.de',
    'nitter.pw',
    'nitter.domain.glass',
    'nitter.mastodon.pro',
    'nitter.koehlerweb.org',
    'nitter.mha.fi',
    'nitter.1d4.us',
    'nitter.privacydev.net',
    'nitter.bus-hit.me',
    'nitter.unixfox.eu',
    'nitter.42l.fr',
    'nitter.fdn.fr',
    'nitter.13ad.de',
    'nitter.kavin.rocks',
    'nitter.tedomum.net',
    'nitter.inpt.fr',
    'nitter.it',
    'nitter.mint.lgbt',
    'nitter.nohost.network',
    'nitter.catsarch.com',
    'nitter.privacy.com.de',
    'nitter.pw',
    'nitter.domain.glass',
    'nitter.mastodon.pro',
    'nitter.koehlerweb.org',
    // Add/remove as needed; some may be down or rate-limited
  ];

  for (const instance of instances) {
    try {
      // Try RSS feed first - more reliable
      const rssUrl = `https://${instance}/${username}/rss`;
      logger.info(`Trying Nitter RSS: ${instance}`);
      
      const resp = await fetch(rssUrl, {
        headers: { 
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/rss+xml, application/xml, text/xml, */*'
        },
        timeout: 10000
      });

      if (!resp.ok) {
        logger.warn(`Nitter RSS ${instance} returned ${resp.status}`);
        continue;
      }

      const xml = await resp.text();
      
      // Check if it's actually RSS/XML (not bot protection page)
      if (!xml.includes('<?xml') && !xml.includes('<rss')) {
        logger.warn(`Nitter RSS ${instance} returned non-XML response`);
        continue;
      }

      const tweets: Tweet[] = [];
      
      // Parse RSS items - format: <item><title>...</title><link>...</link><pubDate>...</pubDate><description>...</description></item>
      const itemRegex = /<item>([\s\S]*?)<\/item>/g;
      const items = xml.matchAll(itemRegex);
      
      for (const item of items) {
        if (tweets.length >= max) break;
        
        const itemContent = item[1];
        
        // Extract link to get tweet ID
        const linkMatch = itemContent.match(/<link>([^<]+)<\/link>/);
        if (!linkMatch) continue;
        
        const link = linkMatch[1];
        const idMatch = link.match(/status\/(\d+)/);
        if (!idMatch) continue;
        
        const id = idMatch[1];
        
        // Extract description (tweet text)
        const descMatch = itemContent.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/);
        let text = descMatch?.[1] || '';
        
        // Clean up HTML from description
        text = text
          .replace(/<[^>]+>/g, ' ')
          .replace(/&quot;/g, '"')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&apos;/g, '\'')
          .replace(/&amp;/g, '&') // Decode &amp; LAST to prevent double-unescaping
          .replace(/https?:\/\/[^\s]+/g, '') // Remove URLs
          .replace(/\s+/g, ' ')
          .trim();
        
        if (!text || text.length < 5) continue;
        if (text.length > 280) text = text.slice(0, 277) + '...';
        
        tweets.push({
          id,
          text,
          createdAt: snowflakeToDate(id),
          user: { id: username, username, displayName: username }
        });
      }
      
      if (tweets.length > 0) {
        logger.info(`Nitter RSS ${instance} extracted ${tweets.length} tweets`);
        rateLimitTracker.setCooldown('nitter-scraper', 10 * 60, 'post-fetch cooldown');
        return tweets;
      }
    } catch (err) {
      logger.warn(`Nitter RSS ${instance} failed: ${err}`);
      continue;
    }
  }
  
  logger.info('All Nitter instances failed');
  rateLimitTracker.setCooldown('nitter-scraper', 15 * 60, 'all instances failed');
  return [];
}

/**
 * Fetch via vxtwitter (fxtwitter) - provides JSON API
 */
export async function fetchFromVxTwitter(): Promise<Tweet[]> {
  if (rateLimitTracker.isRateLimited('vxtwitter')) {
    const waitSeconds = rateLimitTracker.getSecondsUntilReset('vxtwitter');
    logger.info(`VxTwitter rate limited for ${waitSeconds} more seconds`);
    return [];
  }

  try {
    // VxTwitter doesn't have a timeline API, but we can try the embed endpoint
    // This is a long shot and likely won't work for timelines
    
    logger.info('VxTwitter API not suitable for timeline fetching');
    rateLimitTracker.setCooldown('vxtwitter', 30 * 60, 'not suitable');
    return [];
  } catch (err) {
    logger.error(`VxTwitter fetch failed: ${err}`);
    rateLimitTracker.setCooldown('vxtwitter', 20 * 60, 'error');
    return [];
  }
}
export async function fetchFromGoogleCache(username: string, max = 20): Promise<Tweet[]> {
  if (rateLimitTracker.isRateLimited('google-cache')) {
    const waitSeconds = rateLimitTracker.getSecondsUntilReset('google-cache');
    logger.info(`Google Cache rate limited for ${waitSeconds} more seconds`);
    return [];
  }
  try {
    const url = `https://webcache.googleusercontent.com/search?q=cache:https://x.com/${username}`;
    logger.info(`Trying Google Cache for @${username}`);
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 15000
    });
    if (!resp.ok) {
      logger.warn(`Google Cache returned ${resp.status}`);
      rateLimitTracker.setCooldown('google-cache', 30 * 60, 'failed');
      return [];
    }
    const html = await resp.text();
    // Check if Google returned an error page (soft 404)
    if (html.includes('404') || html.includes('did not match any cached pages') || html.includes('is not available')) {
      logger.warn('Google Cache: page not cached (soft 404)');
      rateLimitTracker.setCooldown('google-cache', 30 * 60, 'not cached');
      return [];
    }
    const tweets: Tweet[] = [];
    const statusRegex = new RegExp(`https://(?:twitter[.]com|x[.]com)/${username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/status/([0-9]+)`, 'g');
    const seenIds = new Set<string>();
    let match;
    while ((match = statusRegex.exec(html)) && tweets.length < max) {
      const id = match[1];
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      const idx = html.indexOf(id);
      if (idx === -1) continue;
      const snippet = html.slice(Math.max(0, idx - 400), Math.min(html.length, idx + 100));
      let text = snippet
        .replace(/<[^>]+>/g, ' ')
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&') // Decode &amp; LAST to prevent double-unescaping
        .replace(/https?:\/\/[^\s]+/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      // Remove any leftover HTML attributes/fragments
      if (/class=|style=|data-|<img|<script|<div|<span|<[a-zA-Z]+|\bjsaction\b|\bved=|\bhveid=|\bmax-width|\bwidth:|\bdisplayName/.test(text)) {
        logger.debug(`Google Cache: Discarded garbage snippet for id=${id}: ${JSON.stringify(text)}`);
        continue;
      }
      // Discard if text contains angle brackets or is mostly symbols
      if (/[<>]/.test(text) || /[\W_]{10,}/.test(text)) {
        logger.debug(`Google Cache: Discarded suspicious snippet for id=${id}: ${JSON.stringify(text)}`);
        continue;
      }
      if (!text || text.length < 10) continue;
      if (text.length > 280) text = text.slice(0, 277) + '...';
      tweets.push({
        id,
        text,
        createdAt: snowflakeToDate(id),
        user: { id: username, username, displayName: username }
      });
    }
    logger.info(`Google Cache extracted ${tweets.length} tweets`);
    rateLimitTracker.setCooldown('google-cache', 15 * 60, 'post-fetch cooldown');
    return tweets;
  } catch (err) {
    logger.error(`Google Cache fetch failed: ${err}`);
    rateLimitTracker.setCooldown('google-cache', 20 * 60, 'error');
    return [];
  }
}

/**
 * Fetch via Google search results (searches for tweets from user)
 */
export async function fetchFromGoogleSearch(username: string, max = 20): Promise<Tweet[]> {
  if (rateLimitTracker.isRateLimited('google-search')) {
    const waitSeconds = rateLimitTracker.getSecondsUntilReset('google-search');
    logger.info(`Google Search rate limited for ${waitSeconds} more seconds`);
    return [];
  }
  try {
    // Search for recent tweets from the user
    const searchQuery = encodeURIComponent(`site:x.com/${username} OR site:twitter.com/${username}`);
    const url = `https://www.google.com/search?q=${searchQuery}&num=50`;
    logger.info(`Trying Google Search for @${username}`);
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      timeout: 15000
    });
    if (!resp.ok) {
      logger.warn(`Google Search returned ${resp.status}`);
      rateLimitTracker.setCooldown('google-search', 30 * 60, 'failed');
      return [];
    }
    const html = await resp.text();
    const tweets: Tweet[] = [];
    // Extract status URLs from search results
    const statusRegex = new RegExp(`https://(?:twitter[.]com|x[.]com)/${username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/status/([0-9]+)`, 'g');
    const seenIds = new Set<string>();
    let match;
    while ((match = statusRegex.exec(html)) && tweets.length < max) {
      const id = match[1];
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      // Try to extract snippet/description from Google result
      const idx = html.indexOf(id);
      if (idx === -1) continue;
      // Look for text in the surrounding area (Google shows snippets)
      const snippet = html.slice(Math.max(0, idx - 500), Math.min(html.length, idx + 500));
      // Try to find content in common Google snippet tags
      let text = '';
      const snippetPatterns = [
        /<div class="[^"]*VwiC3b[^"]*"[^>]*>([^<]+)<\/div>/,
        /<span class="[^"]*aCOpRe[^"]*"[^>]*>([^<]+)<\/span>/,
        /<div[^>]*data-content-feature[^>]*>([^<]+)<\/div>/,
      ];
      for (const pattern of snippetPatterns) {
        const snippetMatch = snippet.match(pattern);
        if (snippetMatch?.[1]) {
          text = snippetMatch[1];
          break;
        }
      }
      // Fallback: extract any text near the URL
      if (!text) {
        text = snippet
          .replace(/<[^>]+>/g, ' ')
          .replace(/&quot;/g, '"')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&') // Decode &amp; LAST to prevent double-unescaping
          .replace(/https?:\/\/[^\s]+/g, '')
          .replace(/\s+/g, ' ')
          .trim();
      }
      // Remove any leftover HTML attributes/fragments
      if (/class=|style=|data-|<img|<script|<div|<span|<[a-zA-Z]+|\bjsaction\b|\bved=|\bhveid=|\bmax-width|\bwidth:|\bdisplayName/.test(text)) {
        logger.debug(`Google Search: Discarded garbage snippet for id=${id}: ${JSON.stringify(text)}`);
        continue;
      }
      // Discard if text contains angle brackets or is mostly symbols
      if (/[<>]/.test(text) || /[\W_]{10,}/.test(text)) {
        logger.debug(`Google Search: Discarded suspicious snippet for id=${id}: ${JSON.stringify(text)}`);
        continue;
      }
      if (!text || text.length < 10) continue;
      if (text.length > 280) text = text.slice(0, 277) + '...';
      tweets.push({
        id,
        text,
        createdAt: snowflakeToDate(id),
        user: { id: username, username, displayName: username }
      });
    }
    logger.info(`Google Search extracted ${tweets.length} tweets`);
    rateLimitTracker.setCooldown('google-search', 15 * 60, 'post-fetch cooldown');
    return tweets;
  } catch (err) {
    logger.error(`Google Search fetch failed: ${err}`);
    rateLimitTracker.setCooldown('google-search', 20 * 60, 'error');
    return [];
  }
}

