/* eslint-disable no-console, @typescript-eslint/no-explicit-any */
/**
 * Check OAuth2 token health and alert if refresh is needed
 * Run this periodically (e.g., daily via cron/Task Scheduler)
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { TwitterApi } from 'twitter-api-v2';
import { config } from '../config';
import { logger } from '../utils/logger';

const OAUTH2_TOKEN_FILE = path.join(process.cwd(), '.oauth2-tokens.json');

interface StoredOAuth2Tokens {
  accessToken: string;
  refreshToken?: string;
  scope?: string;
  expiresAt?: number;
}

async function checkHealth() {
  try {
    // Check if OAuth2 tokens exist
    if (!config.TWITTER_OAUTH2_REFRESH_TOKEN) {
      logger.error('❌ No OAuth2 refresh token found in .env');
      logger.info('Run: npm run oauth2:authorize');
      process.exit(1);
    }

    // Check stored token file
    let stored: StoredOAuth2Tokens | null = null;
    if (fs.existsSync(OAUTH2_TOKEN_FILE)) {
      const data = fs.readFileSync(OAUTH2_TOKEN_FILE, 'utf-8');
      stored = JSON.parse(data);
    }

    // Check token expiration
    if (stored?.expiresAt) {
      const now = Date.now();
      const expiresIn = stored.expiresAt - now;
      const hoursLeft = Math.floor(expiresIn / (1000 * 60 * 60));
      const daysLeft = Math.floor(hoursLeft / 24);

      if (expiresIn < 0) {
        logger.warn('⚠️  Access token has expired');
        logger.info('Attempting to refresh...');
      } else if (daysLeft < 7) {
        logger.warn(`⚠️  Access token expires in ${daysLeft} days (${hoursLeft} hours)`);
      } else {
        logger.info(`✅ Access token healthy - expires in ${daysLeft} days`);
      }
    }

    // Try to refresh the token
    if (!config.TWITTER_CLIENT_ID) {
      logger.error('❌ TWITTER_CLIENT_ID missing - cannot refresh');
      process.exit(1);
    }

    const client = new TwitterApi({
      clientId: config.TWITTER_CLIENT_ID,
      clientSecret: config.TWITTER_CLIENT_SECRET || undefined,
    });

    logger.info('Testing OAuth2 refresh...');
    const refreshed = await client.refreshOAuth2Token(config.TWITTER_OAUTH2_REFRESH_TOKEN);
    
    logger.info('✅ OAuth2 refresh successful!');
    logger.info(`   Access token valid for ${Math.floor(refreshed.expiresIn / 3600)} hours`);
    logger.info(`   Scopes: ${refreshed.scope || 'N/A'}`);
    
    if (refreshed.refreshToken && refreshed.refreshToken !== config.TWITTER_OAUTH2_REFRESH_TOKEN) {
      logger.warn('⚠️  Refresh token was rotated - update your .env file manually or restart the bot');
      logger.info(`   New refresh token: ${refreshed.refreshToken.substring(0, 20)}...`);
    }

    process.exit(0);
  } catch (e: any) {
    const status = e?.status || e?.code || e?.response?.status;
    
    if (status === 400 || status === 401) {
      logger.error('❌ OAuth2 refresh failed - refresh token is invalid or expired');
      logger.error('   Run: npm run oauth2:authorize');
      process.exit(1);
    } else {
      logger.error(`❌ OAuth2 health check failed: ${e?.message || e}`);
      process.exit(1);
    }
  }
}

checkHealth().catch((e) => {
  logger.error(`Fatal error: ${e}`);
  process.exit(1);
});
