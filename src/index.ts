/**
 * MANUAL MODE FORK
 *
 * This entry point replaces the auto-posting bot with a manual review dashboard.
 * - No Twitter API credentials required (no posting via API)
 * - Fetches source tweets via Nitter/Jina only
 * - Generates 4 translation candidates per tweet
 * - User reviews candidates and posts via twitter.com/intent/tweet in their browser
 *
 * Dashboard: http://127.0.0.1:3456  (configurable via DASHBOARD_PORT)
 */

// Load .env file FIRST before any other imports that use config
import 'dotenv/config';

// ── Manual mode bootstrap ──────────────────────────────────────────────────
// Force nitter-only fetching: set monthly fetch limit to 0 so the Twitter API
// path inside fetchTweets is always skipped (remaining quota = 0 → fallback only).
if (!process.env.MONTHLY_FETCH_LIMIT) {
  process.env.MONTHLY_FETCH_LIMIT = '0';
}
import { logger } from './utils/logger';
import { acquireLock } from './utils/instanceLock';
import { getVersion } from './utils/version';
import { initializeGracefulShutdown, onShutdown } from './utils/gracefulShutdown';
import { startHealthMonitoring, logHealthReport } from './utils/healthCheck';
import { startDashboardServer, stopDashboardServer } from './server/dashboardServer';
import { candidateStore } from './server/candidateStore';
import { generationQueue } from './server/generationQueue';
import { fetchTweets } from './twitter/fetchTweets';
import { tweetTracker } from './utils/tweetTracker';

// How often to poll Nitter for new tweets automatically (default: every 30 minutes)
const FETCH_INTERVAL_MS = Number(process.env.FETCH_INTERVAL_MS || String(30 * 60 * 1000));

/** Run one fetch cycle: pull tweets, generate candidates for any new ones. */
async function runFetchCycle(): Promise<void> {
  logger.info('[FetchCycle] Starting…');
  try {
    const tweets = await fetchTweets(false);
    logger.info(`[FetchCycle] Fetched ${tweets.length} tweet(s)`);
    let added = 0;
    for (const tweet of tweets) {
      if (!tweetTracker.shouldProcess(tweet.id, tweet.createdAt.toISOString())) {
        continue;
      }
      const queueId = candidateStore.add(tweet);
      tweetTracker.markProcessed(tweet.id);
      added++;
      generationQueue.enqueue(queueId, tweet);
    }
    logger.info(`[FetchCycle] Added ${added} new tweet(s) to queue`);
  } catch (err) {
    logger.error(`[FetchCycle] Error: ${err}`);
  }
}

async function main() {
  try {
    // Initialize graceful shutdown handlers
    initializeGracefulShutdown();

    onShutdown(async () => {
      logger.info('[ManualMode] Shutting down dashboard server…');
      await stopDashboardServer();
      await logHealthReport();
    });

    // Safety net for unhandled errors
    if (process.listenerCount('unhandledRejection') === 0) {
      process.on('unhandledRejection', (reason: unknown) => {
        try {
          const msg = (reason as Error)?.stack || (reason as Error)?.message || String(reason);
          logger.error(`Unhandled promise rejection: ${msg}`);
        } catch { /* ignore */ }
      });
    }

    if (process.listenerCount('uncaughtException') === 0) {
      process.on('uncaughtException', (error: Error) => {
        try {
          logger.error(`Uncaught exception: ${error.message}\n${error.stack}`);
        } catch { /* ignore */ }
        process.exit(1);
      });
    }

    // Ensure only one instance runs at a time
    if (!acquireLock()) {
      logger.error('Another instance is already running. Exiting.');
      process.exit(1);
    }

    const version = getVersion();
    logger.info(`Starting BroTeam Translate Bot v${version} [MANUAL MODE]…`);
    logger.info('No Twitter API credentials required — using Nitter + dashboard posting.');

    // Start health monitoring
    startHealthMonitoring(5 * 60 * 1000);
    await logHealthReport();

    // Start dashboard HTTP server
    startDashboardServer();

    // Re-enqueue any items that were mid-generation when the process last stopped
    const stuck = candidateStore.rehydrateStuck();
    for (const { id, tweet } of stuck) {
      generationQueue.enqueue(id, tweet);
    }

    // Import any pre-translated items from the old auto-bot's queue
    candidateStore.importOldQueue();

    // Initial fetch on startup
    await runFetchCycle();

    // Periodic fetch
    setInterval(runFetchCycle, FETCH_INTERVAL_MS);
    logger.info(`[ManualMode] Polling Nitter every ${FETCH_INTERVAL_MS / 60000} min.`);
    logger.info('[ManualMode] Bot is running. Open the dashboard to review candidates.');

  } catch (error) {
    logger.error(`Error in main execution: ${error}`);
    process.exit(1);
  }
}

main();