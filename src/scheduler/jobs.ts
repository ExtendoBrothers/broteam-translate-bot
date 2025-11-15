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
  // Always schedule 30 minutes after the last post (preferred) or last run
  const anchor = readLastPost() || from;
  const now = new Date();
  const elapsed = now.getTime() - anchor.getTime();
  const intervalMs = 30 * 60 * 1000; // 30 minutes
  return Math.max(0, intervalMs - elapsed);
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
  const debugMsg = `Scheduling details: baseDelay=${Math.ceil(baseDelay/1000)}s` +
    (timelineCooldown > 0 ? `, timelineCooldown=${timelineCooldown}s` : '') +
    (lastPostAt ? `, lastPostAt=${lastPostAt.toISOString()}` : ', lastPostAt=none');
  logger.info(debugMsg);

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