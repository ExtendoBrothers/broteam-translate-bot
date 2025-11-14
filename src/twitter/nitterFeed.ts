import { logger } from '../utils/logger';
import { Tweet } from '../types';
import fetch from 'node-fetch';

/**
 * Twitter Syndication API - Public, no auth required
 * This is what twitter.com uses for embedded timelines
 */
async function fetchFromSyndicationAPI(username: string, maxTweets = 40): Promise<Tweet[]> {
  const tweets: Tweet[] = [];
  
  try {
    // Twitter syndication endpoint (public, used for embeds)
    const url = `https://syndication.twitter.com/srv/timeline-profile/screen-name/${username}?showReplies=false&showRetweets=false`;
    
    logger.info(`Fetching from Twitter syndication API for @${username}`);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    
    if (!response.ok) {
      logger.warn(`Syndication API returned ${response.status}`);
      return tweets;
    }
    
    const html = await response.text();
    
    // The response is JSON embedded in HTML - extract the __NEXT_DATA__ script
    const jsonMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (!jsonMatch) {
      logger.warn('Could not find __NEXT_DATA__ in syndication API response');
      return tweets;
    }
    
    const data = JSON.parse(jsonMatch[1]);
    const timeline = data?.props?.pageProps?.timeline?.entries || [];
    
    for (const entry of timeline.slice(0, maxTweets)) {
      if (entry.type !== 'tweet' || !entry.content?.tweet) continue;
      
      const tweet = entry.content.tweet;
      const text = tweet.full_text || tweet.text || '';
      const tweetId = tweet.id_str || '';
      const createdAt = tweet.created_at ? new Date(tweet.created_at) : new Date();
      
      if (!tweetId || !text) continue;
      
      tweets.push({
        id: tweetId,
        text,
        createdAt,
        user: {
          id: tweet.user?.id_str || 'unknown',
          username,
          displayName: tweet.user?.name || username,
        },
      });
    }
    
    logger.info(`Successfully fetched ${tweets.length} tweets from syndication API`);
    return tweets;
    
  } catch (error) {
    logger.error(`Failed to fetch from syndication API: ${error}`);
    return tweets;
  }
}

/**
 * Fetch tweets from Nitter RSS feed (fallback method, most instances are dead)
 * @param username Twitter username (without @)
 * @param maxTweets Maximum number of tweets to fetch (default 40)
 */
export async function fetchTweetsFromNitter(username: string, maxTweets = 40): Promise<Tweet[]> {
  // Primary method: Use Twitter syndication API (public, no auth)
  return await fetchFromSyndicationAPI(username, maxTweets);
}
