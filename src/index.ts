import { scheduleJobs, recordLastRun } from './scheduler/jobs';
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
    // Global safety net for unhandled errors
    process.on('unhandledRejection', (reason: unknown) => {
      try {
        const msg = (reason as Error)?.stack || (reason as Error)?.message || String(reason);
        logger.error(`Unhandled promise rejection: ${msg}`);
      } catch {
        // ignore
      }
    });

    process.on('uncaughtException', (error: Error) => {
      try {
        logger.error(`Uncaught exception: ${error.message}\n${error.stack}`);
      } catch {
        // ignore
      }
      process.exit(1);
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
    // Schedule next runs relative to now
    scheduleJobs();
    logger.info('Bot is running. Press Ctrl+C to stop.');
    
    // Keep the process alive even if not scheduling jobs
    setInterval(() => {
      logger.info('Bot is idle, waiting for timeline cooldown to expire.');
    }, 60 * 60 * 1000); // Log every hour
  } catch (error) {
    logger.error(`Error in main execution: ${error}`);
    process.exit(1);
  }
}

main();