import 'dotenv/config';
export const config = {
  TWITTER_API_KEY: process.env.TWITTER_API_KEY || process.env.API_KEY || '',
  TWITTER_API_SECRET: process.env.TWITTER_API_SECRET || process.env.TWITTER_API_SECRET_KEY || process.env.API_SECRET || '',
  TWITTER_ACCESS_TOKEN: process.env.TWITTER_ACCESS_TOKEN || process.env.ACCESS_TOKEN || '',
  TWITTER_ACCESS_SECRET: process.env.TWITTER_ACCESS_SECRET || process.env.TWITTER_ACCESS_TOKEN_SECRET || process.env.ACCESS_TOKEN_SECRET || '',
  // OAuth 2.0 (User context) configuration
  TWITTER_CLIENT_ID: process.env.TWITTER_CLIENT_ID || '',
  TWITTER_CLIENT_SECRET: process.env.TWITTER_CLIENT_SECRET || '', // optional for PKCE, required for confidential clients
  TWITTER_CALLBACK_URL: process.env.TWITTER_CALLBACK_URL || 'http://127.0.0.1:6789/callback',
  TWITTER_OAUTH2_ACCESS_TOKEN: process.env.TWITTER_OAUTH2_ACCESS_TOKEN || '',
  TWITTER_OAUTH2_REFRESH_TOKEN: process.env.TWITTER_OAUTH2_REFRESH_TOKEN || '',
  GOOGLE_TRANSLATE_API_KEY: process.env.GOOGLE_TRANSLATE_API_KEY || '',
  SOURCE_USERNAME: process.env.SOURCE_USERNAME || 'BroTeamPills',
  SOURCE_USER_ID: process.env.SOURCE_USER_ID || '',
  // Fetch method: 'nitter' (RSS feed, no API limits) or 'twitter' (X API, has monthly cap)
  FETCH_METHOD: process.env.FETCH_METHOD || 'nitter',
  // Monthly fetch limit (Twitter free tier product cap). Used to compute scheduler spacing.
  MONTHLY_FETCH_LIMIT: Number(process.env.MONTHLY_FETCH_LIMIT || '100'),
  // Enable dynamic spacing of fetches across the month so we do not exceed the cap prematurely.
  FETCH_SPREAD: (process.env.FETCH_SPREAD || 'true').toLowerCase() === 'true',
  RATE_LIMIT_BUFFER_SECONDS: Number(process.env.RATE_LIMIT_BUFFER_SECONDS || '120'),
  // OAuth2 refresh retry config
  OAUTH2_REFRESH_MAX_RETRIES: Number(process.env.OAUTH2_REFRESH_MAX_RETRIES || '3'),
  OAUTH2_REFRESH_BACKOFF_MS: Number(process.env.OAUTH2_REFRESH_BACKOFF_MS || '1000'),
  // Translation chain: all 49 languages supported by LibreTranslate
  LANGUAGES: [
    'ar', 'az', 'bg', 'bn', 'ca', 'cs', 'da', 'de', 'el', 'en', 'eo', 'es', 'et', 'eu', 'fa',
    'fi', 'fr', 'ga', 'gl', 'he', 'hi', 'hu', 'id', 'it', 'ja', 'ko', 'ky', 'lt', 'lv', 'ms',
    'nb', 'nl', 'pl', 'pt', 'pt-BR', 'ro', 'ru', 'sk', 'sl', 'sq', 'sv', 'th', 'tl', 'tr',
    'uk', 'ur', 'vi', 'zh-Hans', 'zh-Hant'
  ],
  // Oldschool translation mode: use fixed translation order instead of random selection
  OLDSCHOOL_MODE: (process.env.OLDSCHOOL_MODE || 'false').toLowerCase() === 'true',
  // Fixed translation order for oldschool mode (will be set by user)
  OLDSCHOOL_LANGUAGES: process.env.OLDSCHOOL_LANGUAGES ? process.env.OLDSCHOOL_LANGUAGES.split(',').map(s => s.trim()) : ['en','ja','en','ru','en','zh-Hans','en','el','en','fi','en','hu','en'],
  // Humor detection configuration
  HUMOR_DETECTION_ENABLED: (process.env.HUMOR_DETECTION_ENABLED || 'false').toLowerCase() === 'true',
  HUMOR_THRESHOLD: Number(process.env.HUMOR_THRESHOLD || '0.5'), // Minimum score to consider text humorous
  HUGGINGFACE_TOKEN: process.env.HUGGINGFACE_TOKEN || '', // Optional API token for Hugging Face
  // Blocked tweet contents - tweets with these exact texts will be skipped
  BLOCKED_TWEET_CONTENTS: process.env.BLOCKED_TWEET_CONTENTS ? process.env.BLOCKED_TWEET_CONTENTS.split(',').map(s => s.trim().replace(/\\n/g, '\n')) : [],
};
