import { translateAndPostWorker } from '../workers/translateAndPostWorker';
import { logger } from '../utils/logger';
import { rateLimitTracker } from '../utils/rateLimitTracker';
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

function scheduleNext(from: Date) {
  const THIRTY_MIN_MS = 30 * 60 * 1000;
  const now = new Date();
  const elapsed = now.getTime() - from.getTime();
  let baseDelay = Math.max(0, THIRTY_MIN_MS - elapsed);

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

  const JITTER_MS = 15 * 1000; // up to 15s jitter to avoid bursts
  const jitter = Math.floor(Math.random() * JITTER_MS);
  const delay = baseDelay + jitter;
  const nextAt = new Date(Date.now() + delay);
  logger.info(`Next scheduled run at ${nextAt.toISOString()} (in ${Math.ceil(delay/1000)}s)`);
  setTimeout(async () => {
    try {
      logger.info('Running scheduled translation job...');
      await translateAndPostWorker();
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
        await translateAndPostWorker();
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