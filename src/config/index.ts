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
  RATE_LIMIT_BUFFER_SECONDS: Number(process.env.RATE_LIMIT_BUFFER_SECONDS || '10'),
  // Translation chain optimized for "telephone game" comedy:
  // English → Japanese → Arabic → Finnish → Hungarian → Korean → Turkish →
  // Chinese → Russian → Thai → Vietnamese → Hindi → Polish → Greek → English
  // Maximizes grammar/script changes for funny mistranslations
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
    'el', // Greek (different alphabet)
  ],
};
