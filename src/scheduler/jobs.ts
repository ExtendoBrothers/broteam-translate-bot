import { translateAndPostWorker } from '../workers/translateAndPostWorker';
import { logger } from '../utils/logger';
import { rateLimitTracker } from '../utils/rateLimitTracker';
import { tweetQueue } from '../utils/tweetQueue';
import * as fs from 'fs';
import * as path from 'path';

const LAST_RUN_FILE = path.join(process.cwd(), '.last-run.json');

function readLastRun(): Date | null {
  try {
    if (!fs.existsSync(LAST_RUN_FILE)) return null;
    const raw = fs.readFileSync(LAST_RUN_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed?.lastRun) {
      const dt = new Date(parsed.lastRun);
      if (isFinite(dt.getTime())) return dt;
    }
  } catch {
    // ignore
  }
  return null;
}

export function recordLastRun(when: Date) {
  try {
    const tmp = LAST_RUN_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ lastRun: when.toISOString() }, null, 2), 'utf-8');
    fs.renameSync(tmp, LAST_RUN_FILE);
  } catch {
    // ignore
  }
}

// No monthly spreading for posts; cadence is based on last post time

function readLastPost(): Date | null {
  try {
    const file = path.join(process.cwd(), '.post-tracker.json');
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw) as { postTimestamps?: string[] };
    const arr = parsed.postTimestamps || [];
    if (!arr.length) return null;
    const latestIso = arr.reduce((max, cur) => (cur > max ? cur : max));
    const dt = new Date(latestIso);
    return isFinite(dt.getTime()) ? dt : null;
  } catch {
    return null;
  }
}

function computeDynamicIntervalMs(from: Date): number {
  // If queue not empty, prefer fast cadence (2 minutes) to drain queue quickly
  const FAST_QUEUE_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
  const NORMAL_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
  const anchor = readLastPost() || from;
  const now = new Date();
  const elapsed = now.getTime() - anchor.getTime();
  const desired = tweetQueue.isEmpty() ? NORMAL_INTERVAL_MS : FAST_QUEUE_INTERVAL_MS;
  return Math.max(0, desired - elapsed);
}

function scheduleNext(from: Date) {
  let baseDelay = computeDynamicIntervalMs(from);

  // Check if timeline cooldown is active and ensure we don't schedule before it expires
  const timelineCooldown = rateLimitTracker.getSecondsUntilReset('timeline');
  if (timelineCooldown > 0) {
    const cooldownMs = timelineCooldown * 1000;
    const BUFFER_MS = 20 * 1000; // 20s buffer after cooldown expires
    const minDelay = cooldownMs + BUFFER_MS;
    if (baseDelay < minDelay) {
      logger.info(`Adjusting schedule: timeline cooldown active for ${timelineCooldown}s; adding buffer`);
      baseDelay = minDelay;
    }
  }

  // Add extra debug logging so we can see why the next run is scheduled
  const lastPostAt = readLastPost();
  const queueSize = tweetQueue.size();
  const debugMsg = `Scheduling details: baseDelay=${Math.ceil(baseDelay/1000)}s` +
    (timelineCooldown > 0 ? `, timelineCooldown=${timelineCooldown}s` : '') +
    (lastPostAt ? `, lastPostAt=${lastPostAt.toISOString()}` : ', lastPostAt=none') +
    `, queueSize=${queueSize}` + (queueSize > 0 ? ', fastQueueMode=on' : '');
  logger.info(debugMsg);

  const JITTER_MS = 15 * 1000; // up to 15s jitter to avoid bursts
  const jitter = Math.floor(Math.random() * JITTER_MS);
  let delay = baseDelay + jitter;
  // If timeline cooldown ended soon and queue has items, cap delay to fast interval
  if (!tweetQueue.isEmpty() && delay > (2 * 60 * 1000)) {
    logger.info('Capping delay to fast queue interval (2m) because queue is not empty');
    delay = 2 * 60 * 1000 + Math.floor(Math.random() * JITTER_MS);
  }
  const nextAt = new Date(Date.now() + delay);
  logger.info(`Next scheduled run at ${nextAt.toISOString()} (in ${Math.ceil(delay/1000)}s)`);
  setTimeout(async () => {
    try {
      logger.info('Running scheduled translation job...');
      const result = await translateAndPostWorker();
      // If queue remains after run, schedule quick follow-up in 2m
      if (!tweetQueue.isEmpty()) {
        const followDelay = 2 * 60 * 1000; // 2 minutes
        const followAt = new Date(Date.now() + followDelay);
        logger.info(`Queue still has ${tweetQueue.size()} item(s). Scheduling fast follow-up at ${followAt.toISOString()} (in ${Math.ceil(followDelay/1000)}s)`);
        setTimeout(async () => {
          try {
            logger.info('Running fast follow-up (queue flush)...');
            await translateAndPostWorker();
          } catch (err) {
            logger.error(`Error in fast follow-up: ${err}`);
          } finally {
            const now3 = new Date();
            recordLastRun(now3);
            scheduleNext(now3);
          }
        }, followDelay);
        return; // Avoid scheduling normal next run twice
      }
      
      // If blocked by cooldown, schedule next run for 20s after cooldown expires
      if (result.blockedByCooldown) {
        const timelineCooldown = rateLimitTracker.getSecondsUntilReset('timeline');
        if (timelineCooldown > 0) {
          const retryDelay = (timelineCooldown + 20) * 1000; // cooldown + 20s
          const retryAt = new Date(Date.now() + retryDelay);
          logger.info(`Blocked by cooldown. Retrying at ${retryAt.toISOString()} (in ${Math.ceil(retryDelay/1000)}s)`);
          setTimeout(async () => {
            try {
              logger.info('Running post-cooldown retry...');
              await translateAndPostWorker();
            } catch (error) {
              logger.error(`Error in post-cooldown retry: ${error}`);
            } finally {
              const now2 = new Date();
              recordLastRun(now2);
              scheduleNext(now2);
            }
          }, retryDelay);
          return; // Don't schedule normal next run yet
        }
      }
      
      // If blocked by post rate limit, schedule retry after post limit expires
      if (result.blockedByPostLimit) {
        const postCooldown = rateLimitTracker.getSecondsUntilReset('post');
        if (postCooldown > 0) {
          const retryDelay = (postCooldown + 20) * 1000; // cooldown + 20s
          const retryAt = new Date(Date.now() + retryDelay);
          logger.info(`Blocked by post rate limit. Retrying at ${retryAt.toISOString()} (in ${Math.ceil(retryDelay/1000)}s)`);
          setTimeout(async () => {
            try {
              logger.info('Running post-limit retry...');
              await translateAndPostWorker();
            } catch (error) {
              logger.error(`Error in post-limit retry: ${error}`);
            } finally {
              const now2 = new Date();
              recordLastRun(now2);
              scheduleNext(now2);
            }
          }, retryDelay);
          return; // Don't schedule normal next run yet
        }
      }
    } catch (error) {
      logger.error(`Error in scheduled job: ${error}`);
    } finally {
      const now2 = new Date();
      recordLastRun(now2);
      scheduleNext(now2);
    }
  }, delay);
}

export function scheduleJobs(lastRunAt?: Date, initialDelayMs?: number) {
  const anchor = lastRunAt || readLastRun() || new Date();
  if (initialDelayMs && initialDelayMs > 0) {
    const nextAt = new Date(Date.now() + initialDelayMs);
    logger.info(`Startup cooldown detected. First scheduled run at ${nextAt.toISOString()} (in ${Math.ceil(initialDelayMs/1000)}s)`);
    setTimeout(async () => {
      try {
        logger.info('Running scheduled translation job...');
        const result = await translateAndPostWorker();
        if (!tweetQueue.isEmpty()) {
          const followDelay = 2 * 60 * 1000; // 2 minutes
          const followAt = new Date(Date.now() + followDelay);
          logger.info(`Queue still has ${tweetQueue.size()} item(s). Scheduling fast follow-up at ${followAt.toISOString()} (in ${Math.ceil(followDelay/1000)}s)`);
          setTimeout(async () => {
            try {
              logger.info('Running fast follow-up (queue flush)...');
              await translateAndPostWorker();
            } catch (err) {
              logger.error(`Error in fast follow-up: ${err}`);
            } finally {
              const now3 = new Date();
              recordLastRun(now3);
              scheduleNext(now3);
            }
          }, followDelay);
          return;
        }
        
        // If blocked by cooldown, schedule next run for 20s after cooldown expires
        if (result.blockedByCooldown) {
          const timelineCooldown = rateLimitTracker.getSecondsUntilReset('timeline');
          if (timelineCooldown > 0) {
            const retryDelay = (timelineCooldown + 20) * 1000; // cooldown + 20s
            const retryAt = new Date(Date.now() + retryDelay);
            logger.info(`Blocked by cooldown. Retrying at ${retryAt.toISOString()} (in ${Math.ceil(retryDelay/1000)}s)`);
            setTimeout(async () => {
              try {
                logger.info('Running post-cooldown retry...');
                await translateAndPostWorker();
              } catch (error) {
                logger.error(`Error in post-cooldown retry: ${error}`);
              } finally {
                const now2 = new Date();
                recordLastRun(now2);
                scheduleNext(now2);
              }
            }, retryDelay);
            return; // Don't schedule normal next run yet
          }
        }
        
        // If blocked by post rate limit, schedule retry after post limit expires
        if (result.blockedByPostLimit) {
          const postCooldown = rateLimitTracker.getSecondsUntilReset('post');
          if (postCooldown > 0) {
            const retryDelay = (postCooldown + 20) * 1000; // cooldown + 20s
            const retryAt = new Date(Date.now() + retryDelay);
            logger.info(`Blocked by post rate limit. Retrying at ${retryAt.toISOString()} (in ${Math.ceil(retryDelay/1000)}s)`);
            setTimeout(async () => {
              try {
                logger.info('Running post-limit retry...');
                await translateAndPostWorker();
              } catch (error) {
                logger.error(`Error in post-limit retry: ${error}`);
              } finally {
                const now2 = new Date();
                recordLastRun(now2);
                scheduleNext(now2);
              }
            }, retryDelay);
            return; // Don't schedule normal next run yet
          }
        }
      } catch (error) {
        logger.error(`Error in scheduled job: ${error}`);
      } finally {
        const now2 = new Date();
        recordLastRun(now2);
        scheduleNext(now2);
      }
    }, initialDelayMs);
  } else {
    scheduleNext(anchor);
  }
  logger.info('Scheduler configured: running every 30 minutes since the last run');
}