import 'dotenv/config';
import { scheduleJobs, recordLastRun } from './scheduler/jobs';
import { rateLimitTracker } from './utils/rateLimitTracker';
import { translateAndPostWorker } from './workers/translateAndPostWorker';
import { logger } from './utils/logger';
import { config } from './config';
import { acquireLock } from './utils/instanceLock';
import { getVersion } from './utils/version';

function validateEnv(): boolean {
  const missing: string[] = [];
    
  // We allow either OAuth1 or OAuth2 to be configured.
  const hasOAuth1 = !!(config.TWITTER_API_KEY && config.TWITTER_API_SECRET && config.TWITTER_ACCESS_TOKEN && config.TWITTER_ACCESS_SECRET);
  const hasOAuth2 = !!(config.TWITTER_CLIENT_ID && (config.TWITTER_OAUTH2_ACCESS_TOKEN || process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true'));

  if (!hasOAuth1 && !hasOAuth2) {
    if (!config.TWITTER_API_KEY) missing.push('TWITTER_API_KEY');
    if (!config.TWITTER_API_SECRET) missing.push('TWITTER_API_SECRET');
    if (!config.TWITTER_ACCESS_TOKEN) missing.push('TWITTER_ACCESS_TOKEN');
    if (!config.TWITTER_ACCESS_SECRET) missing.push('TWITTER_ACCESS_SECRET');
    if (!config.TWITTER_CLIENT_ID) missing.push('TWITTER_CLIENT_ID');
    logger.error('Missing required authentication configuration. Provide either OAuth1 or OAuth2 credentials:');
    missing.forEach(v => logger.error(` - ${v}`));
    logger.error('Set these environment variables and restart.');
    return false;
  }
    
  logger.info('Environment validated successfully.');
  return true;
}

async function main() {
  try {
    // Global safety net for unhandled rejections
    process.on('unhandledRejection', (reason: unknown) => {
      try {
        const msg = (reason as Error)?.stack || (reason as Error)?.message || String(reason);
        logger.error(`Unhandled promise rejection: ${msg}`);
      } catch (e) {
        // ignore
      }
    });
        
    // Ensure only one instance runs at a time
    if (!acquireLock()) {
      logger.error('Another instance is already running. Exiting.');
      process.exit(1);
    }
        
    if (!validateEnv()) {
      process.exit(1);
    }
        
    // Log version information
    const version = getVersion();
    logger.info(`Starting BroTeam Translate Bot v${version}...`);
        
    // Run an immediate initial pass
    await translateAndPostWorker();
    const now = new Date();
    recordLastRun(now);
    // If we're under a startup cooldown for timeline reads, schedule first run
    // for 20s after cooldown expires, then continue every 30 minutes after completion.
    const secondsUntilTimeline = rateLimitTracker.getSecondsUntilReset('timeline');
    const initialDelayMs = secondsUntilTimeline > 0 ? (secondsUntilTimeline + 20) * 1000 : undefined;
    if (initialDelayMs) {
      logger.info(`Startup: timeline blocked for ${secondsUntilTimeline}s. Scheduling first run ${secondsUntilTimeline + 20}s from now.`);
    }
    // Schedule next runs relative to now, honoring optional initial delay
    scheduleJobs(now, initialDelayMs);
        
    logger.info('Bot is running. Press Ctrl+C to stop.');
  } catch (error) {
    logger.error(`Error in main execution: ${error}`);
    process.exit(1);
  }
}

main();