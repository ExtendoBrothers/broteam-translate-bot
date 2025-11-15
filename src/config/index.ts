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
  RATE_LIMIT_BUFFER_SECONDS: Number(process.env.RATE_LIMIT_BUFFER_SECONDS || '10'),
  // OAuth2 refresh retry config
  OAUTH2_REFRESH_MAX_RETRIES: Number(process.env.OAUTH2_REFRESH_MAX_RETRIES || '3'),
  OAUTH2_REFRESH_BACKOFF_MS: Number(process.env.OAUTH2_REFRESH_BACKOFF_MS || '1000'),
  // Translation chain optimized for "telephone game" comedy:
  // English → Japanese → Arabic → Finnish → Hungarian → Korean → Turkish →
  // Chinese → Russian → Thai → Vietnamese → Hindi → Polish → English
  // Maximizes grammar/script changes for funny mistranslations
  // Note: Greek (el) removed because LibreTranslate Greek→English model is broken
  LANGUAGES: [
    'ja', // Japanese (different grammar, particles)
    'ar', // Arabic (RTL, gendered, complex plurals)
    'fi', // Finnish (agglutinative, 15 cases)
    'hu', // Hungarian (agglutinative, different word order)
    'ko', // Korean (honorifics, SOV order)
    'tr', // Turkish (agglutinative, vowel harmony)
    'zh', // Chinese (no conjugation, contextual)
    'ru', // Russian (cases, aspects, Cyrillic)
    'th', // Thai (no spaces, tonal)
    'vi', // Vietnamese (tonal, different grammar)
    'hi', // Hindi (Devanagari script)
    'pl', // Polish (7 cases, complex conjugation)
  ],
};
