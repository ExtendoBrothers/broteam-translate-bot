import { translateAndPostWorker } from '../workers/translateAndPostWorker';
import { logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

const LAST_RUN_FILE = path.join(process.cwd(), '.last-run.json');

function readLastRun(): Date | null {
  try {
    if (!fs.existsSync(LAST_RUN_FILE)) return null;
    const raw = fs.readFileSync(LAST_RUN_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as { lastRun?: string };
    const dt = new Date(parsed.lastRun || '');
    return isFinite(dt.getTime()) ? dt : null;
  } catch {
    return null;
  }
}

export function recordLastRun(when: Date) {
  try {
    fs.writeFileSync(LAST_RUN_FILE, JSON.stringify({ lastRun: when.toISOString() }, null, 2), 'utf-8');
  } catch {
    // ignore
  }
}

// No monthly spreading for posts; cadence is based on last post time

function readLastPost(): Date | null {
  try {
    const file = path.join(process.cwd(), '.post-tracker.json');
    if (!fs.existsSync(file)) return readLastRun(); // Fallback to last run timestamp
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw) as { postTimestamps?: string[] };
    const arr = parsed.postTimestamps || [];
    if (!arr.length) return readLastRun(); // Fallback if no post timestamps
    const latestIso = arr.reduce((max, cur) => (cur > max ? cur : max));
    const dt = new Date(latestIso);
    return isFinite(dt.getTime()) ? dt : readLastRun(); // Fallback if invalid date
  } catch {
    return readLastRun(); // Fallback on error
  }
}

function computeDynamicIntervalMs(): number {
  // Always schedule 30 minutes after the last run (most recent operation)
  const anchor = readLastRun() || readLastPost();
  if (!anchor) {
    // No previous run/post found, schedule in 30 minutes from now
    logger.info('No previous run or post found, scheduling in 30 minutes');
    return 30 * 60 * 1000;
  }
  const now = new Date();
  const elapsed = now.getTime() - anchor.getTime();
  const intervalMs = 30 * 60 * 1000; // 30 minutes

  logger.info(`Interval calculation: now=${now.toISOString()}, anchor=${anchor.toISOString()}, elapsed=${Math.ceil(elapsed/1000)}s, target=1800s`);

  return Math.max(0, intervalMs - elapsed);
}

function scheduleNext() {
  const baseDelay = computeDynamicIntervalMs();

  // Check if timeline cooldown is active and ensure we don't schedule before it expires
  // const timelineCooldown = rateLimitTracker.getSecondsUntilReset('timeline');
  // if (timelineCooldown > 0) {
  //   const cooldownMs = timelineCooldown * 1000;
  //   const BUFFER_MS = 20 * 1000; // 20s buffer after cooldown expires
  //   const minDelay = cooldownMs + BUFFER_MS;
  //   if (baseDelay < minDelay) {
  //     logger.info(`Adjusting schedule: timeline cooldown active for ${timelineCooldown}s; adding buffer`);
  //     baseDelay = minDelay;
  //   }
  // }

  // Add extra debug logging so we can see why the next run is scheduled
  const lastRunAt = readLastRun();
  const lastPostAt = readLastPost();
  const debugMsg = `Scheduling details: baseDelay=${Math.ceil(baseDelay/1000)}s` +
    // (timelineCooldown > 0 ? `, timelineCooldown=${timelineCooldown}s` : '') +
    (lastRunAt ? `, lastRunAt=${lastRunAt.toISOString()}` : ', lastRunAt=none') +
    (lastPostAt ? `, lastPostAt=${lastPostAt.toISOString()}` : ', lastPostAt=none');
  logger.info(debugMsg);

  const JITTER_MS = 15 * 1000; // up to 15s jitter to avoid bursts
  const jitter = Math.floor(Math.random() * JITTER_MS);
  const delay = baseDelay + jitter;
  const nextAt = new Date(Date.now() + delay);
  if (delay > 24 * 60 * 60 * 1000) { // 24 hours
    logger.info(`Delay too long (${Math.ceil(delay/1000)}s > 86400s). Not scheduling next run.`);
    return;
  }
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
      scheduleNext();
    }
  }, delay);
}

export function scheduleJobs() {
  scheduleNext();
  logger.info('Scheduler configured: running every 30 minutes since the last run');
}