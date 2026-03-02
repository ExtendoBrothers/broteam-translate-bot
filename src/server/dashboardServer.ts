/**
 * Dashboard HTTP Server — Manual Mode Fork
 *
 * Lightweight HTTP server (no external deps) that:
 *  - Serves dashboard/index.html on GET /
 *  - Provides a REST JSON API for the dashboard
 *
 * REST Endpoints:
 *   GET  /api/queue               → list pending queue items
 *   POST /api/queue/fetch         → trigger a manual nitter/jina fetch
 *   POST /api/queue/submit        → add a tweet by manual text input
 *   POST /api/queue/:id/post/:idx → mark candidate :idx as posted, returns intent URL
 *   DELETE /api/queue/:id         → skip/dismiss tweet
 *
 * Optional authentication: set DASHBOARD_PASSWORD env var for basic token auth.
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { candidateStore, QueueItem } from './candidateStore';
import { generationQueue } from './generationQueue';
import { fetchTweets } from '../twitter/fetchTweets';
import { tweetTracker } from '../utils/tweetTracker';
import { logger } from '../utils/logger';
import { atomicWriteTextSync } from '../utils/safeFileOps';
import { isSpammyFeedbackEntry } from '../utils/spamFilter';
import { recordSuccessfulPost } from '../utils/duplicatePrevention';
import { Tweet } from '../types';

const DASHBOARD_PORT = Number(process.env.DASHBOARD_PORT || '3456');
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || '';
const DASHBOARD_HTML = path.join(process.cwd(), 'dashboard', 'index.html');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function isAuthorized(req: http.IncomingMessage): boolean {
  if (!DASHBOARD_PASSWORD) return true;
  const auth = req.headers['authorization'] || '';
  return auth === `Bearer ${DASHBOARD_PASSWORD}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Feedback logging (ported from translateAndPostWorker)
// ─────────────────────────────────────────────────────────────────────────────

function writeFeedback(item: QueueItem, postedCandidateIndex: number): void {
  try {
    const selected = item.candidates[postedCandidateIndex];
    if (!selected) return;

    const botPick = item.candidates.find(c => c.isBestCandidate);

    const feedbackEntry = {
      timestamp:     new Date().toISOString(),
      tweetId:       item.tweet.id,
      originalText:  item.tweet.text,
      candidates:    item.candidates.map(c => ({
        source:            c.chainLabel,
        result:            c.result,
        humorScore:        c.humorScore,
        unifiedHumorScore: c.unifiedHumorScore ?? c.combinedScore,
        humorLabel:        c.humorScore >= 0.7 ? 'HUMOROUS' : c.humorScore >= 0.4 ? 'BORDERLINE' : 'NOT_HUMOROUS',
        combinedScore:     c.combinedScore,
        heuristicScore:    c.heuristicScore,
        isEnglish:         c.isEnglish ?? true,
        tieBreaker:        c.tieBreaker ?? 0,
        isBestCandidate:   c.isBestCandidate,
        acceptable:        (c.acceptabilityWarnings?.length ?? 0) === 0 && !c.error,
        acceptabilityWarnings: c.acceptabilityWarnings ?? [],
      })),
      botSelected:    botPick?.chainLabel ?? null,
      userSelected:   selected.chainLabel,
      selectedResult: selected.result,
      selectedScore:  selected.unifiedHumorScore ?? selected.combinedScore,
      userFeedback:   null,
    };

    const feedbackPath = path.join(process.cwd(), 'feedback-data.jsonl');

    // Read + dedup existing entries
    let existingEntries: typeof feedbackEntry[] = [];
    if (fs.existsSync(feedbackPath)) {
      try {
        const content = fs.readFileSync(feedbackPath, 'utf8');
        for (const line of content.split('\n').filter(l => l.trim())) {
          existingEntries.push(JSON.parse(line.trim()));
        }
      } catch (e) {
        logger.warn('[FEEDBACK] Could not read existing feedback, starting fresh:', e);
      }
    }

    if (isSpammyFeedbackEntry(feedbackEntry as Record<string, unknown>)) {
      logger.warn('[FEEDBACK] Blocked spammy feedback entry.');
      return;
    }
    existingEntries.push(feedbackEntry);

    // Dedup by tweetId — keep most recent
    const seen = new Set<string>();
    const deduped: typeof existingEntries = [];
    for (let i = existingEntries.length - 1; i >= 0; i--) {
      const e = existingEntries[i] as { tweetId?: string };
      const key = e.tweetId ?? '';
      if (!seen.has(key)) { seen.add(key); deduped.unshift(existingEntries[i]); }
    }

    const jsonl = deduped.map(e => JSON.stringify(
      JSON.parse(JSON.stringify(e, (_k, v) =>
        typeof v === 'string' ? v.replace(/\n/g, '\\n').replace(/\r/g, '\\r') : v
      ))
    )).filter(Boolean).join('\n') + '\n';

    atomicWriteTextSync(feedbackPath, jsonl);
    logger.info(`[FEEDBACK] Logged feedback for tweet ${item.tweet.id} (userSelected=${selected.chainLabel})`);

    // Record successful post for cross-session duplicate prevention
    // (marks tweetTracker + logs content to contentDeduplication, same as main bot)
    try {
      recordSuccessfulPost(item.tweet.id, selected.result);
    } catch (err) {
      logger.warn('[FEEDBACK] recordSuccessfulPost failed (non-critical):', err);
    }

    // Append to all-translations.log (same format as main bot; feeds importOldQueue migration)
    try {
      const logDir  = path.join(process.cwd(), 'translation-logs');
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
      const logFile = path.join(logDir, 'all-translations.log');
      const ts      = new Date().toISOString();
      const entry   =
        `---\nTimestamp: ${ts}\nTweet ID: ${item.tweet.id}\nInput: ${item.tweet.text}\n` +
        `Chosen Chain: ${selected.chainLabel}\nHumor Score: ${(selected.unifiedHumorScore ?? selected.combinedScore).toFixed(3)}\n` +
        `Steps:\nFinal Result: ${selected.result}\n`;
      fs.appendFileSync(logFile, entry, 'utf8');
    } catch (err) {
      logger.warn('[FEEDBACK] Failed to write all-translations.log (non-critical):', err);
    }

    // Trigger threshold check script (non-blocking, best-effort)
    setTimeout(() => {
      import('child_process')
        .then(({ execFile }) => {
          execFile(
            'node',
            ['scripts/check-feedback-threshold.js'],
            { cwd: process.cwd(), timeout: 10000 },
            (error) => {
              if (error) {
                logger.debug(
                  '[FEEDBACK] Threshold check skipped:',
                  error instanceof Error ? error.message : error,
                );
              }
            },
          );
        })
        .catch((e) => {
          logger.debug(
            '[FEEDBACK] Threshold check skipped:',
            e instanceof Error ? e.message : e,
          );
        });
    }, 100);
  } catch (err) {
    logger.error('[FEEDBACK] Failed to write feedback entry:', err);
  }
}



// ─────────────────────────────────────────────────────────────────────────────
// Route handlers
// ─────────────────────────────────────────────────────────────────────────────

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const method = req.method || 'GET';
  const url = req.url || '/';

  // ── CORS preflight ───────────────────────────────────────────────────────
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    });
    res.end();
    return;
  }

  // ── Auth check ───────────────────────────────────────────────────────────
  if (!isAuthorized(req)) {
    json(res, 401, { error: 'Unauthorized' });
    return;
  }

  // ── Serve dashboard HTML ─────────────────────────────────────────────────
  if (method === 'GET' && (url === '/' || url === '/index.html')) {
    try {
      const html = fs.readFileSync(DASHBOARD_HTML, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Dashboard not found. Ensure dashboard/index.html exists.');
    }
    return;
  }

  // ── GET /api/queue ───────────────────────────────────────────────────────
  if (method === 'GET' && url === '/api/queue') {
    const items = candidateStore.list(['generating', 'ready']);
    json(res, 200, { items, generatingCount: generationQueue.depth });
    return;
  }

  // ── POST /api/queue/fetch ────────────────────────────────────────────────
  if (method === 'POST' && url === '/api/queue/fetch') {
    json(res, 202, { message: 'Fetch started' });
    setImmediate(async () => {
      try {
        logger.info('[DashboardServer] Manual fetch triggered via API');
        const tweets = await fetchTweets(false);
        logger.info(`[DashboardServer] Fetched ${tweets.length} tweet(s)`);
        for (const tweet of tweets) {
          if (!tweetTracker.shouldProcess(tweet.id, tweet.createdAt.toISOString())) {
            logger.debug(`[DashboardServer] Skipping already-processed tweet ${tweet.id}`);
            continue;
          }
          const queueId = candidateStore.add(tweet);
          tweetTracker.markProcessed(tweet.id);
          generationQueue.enqueue(queueId, tweet);
        }
      } catch (err) {
        logger.error(`[DashboardServer] Fetch cycle error: ${err}`);
      }
    });
    return;
  }

  // ── POST /api/queue/submit ────────────────────────────────────────────────
  if (method === 'POST' && url === '/api/queue/submit') {
    let body: { text?: string; id?: string } = {};
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      json(res, 400, { error: 'Invalid JSON body' });
      return;
    }
    const text = (body.text || '').trim();
    if (!text) {
      json(res, 400, { error: 'text is required' });
      return;
    }

    // ── Dedup: tweet ID ──────────────────────────────────────────────────────
    // If the caller provides a real tweet ID, check it against tweetTracker so
    // we never queue a tweet that was already processed (auto-fetched or manually
    // submitted before with the same ID).
    const tweetId = (body.id || '').trim();
    if (tweetId) {
      if (!tweetTracker.shouldProcess(tweetId, new Date().toISOString())) {
        json(res, 409, { error: 'Tweet already processed', id: tweetId });
        return;
      }
    }

    // ── Dedup: text content ──────────────────────────────────────────────────
    // Guard against submitting the same text twice (e.g. double-click or
    // re-paste). Compare normalised text against items currently in the queue.
    const normalise = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
    const normText = normalise(text);
    const allItems = candidateStore.list(['generating', 'ready', 'posted']);
    const textDupe = allItems.find(item => normalise(item.tweet.text) === normText);
    if (textDupe) {
      json(res, 409, { error: 'Duplicate text already in queue', existingId: textDupe.id });
      return;
    }

    const syntheticTweet: Tweet = {
      id: tweetId || `manual-${Date.now()}`,
      text,
      createdAt: new Date(),
      user: { id: 'manual', username: 'manual', displayName: 'Manual Input' },
    };
    const queueId = candidateStore.add(syntheticTweet);
    if (tweetId) tweetTracker.markProcessed(tweetId);
    generationQueue.enqueue(queueId, syntheticTweet);
    json(res, 201, { id: queueId, message: 'Tweet added to queue, generating candidates…' });
    return;
  }

  // ── POST /api/queue/:id/post/:candidateIndex ─────────────────────────────
  const postMatch = url.match(/^\/api\/queue\/([^/]+)\/post\/(\d+)$/);
  if (method === 'POST' && postMatch) {
    const [, queueId, idxStr] = postMatch;
    const candidateIndex = parseInt(idxStr, 10);
    // Snapshot item before markPosted mutates it (needed for feedback)
    const item = candidateStore.getById(queueId);
    const result = candidateStore.markPosted(queueId, candidateIndex);
    if (!result) {
      json(res, 404, { error: 'Queue item or candidate not found' });
      return;
    }
    json(res, 200, { intentUrl: result.intentUrl });
    // Write feedback asynchronously — never block the response
    if (item) setImmediate(() => writeFeedback(item, candidateIndex));
    return;
  }

  // ── DELETE /api/queue/:id ─────────────────────────────────────────────────
  const deleteMatch = url.match(/^\/api\/queue\/([^/]+)$/);
  if (method === 'DELETE' && deleteMatch) {
    const [, queueId] = deleteMatch;
    const ok = candidateStore.markSkipped(queueId);
    json(res, ok ? 200 : 404, ok ? { message: 'Skipped' } : { error: 'Not found' });
    return;
  }

  // ── 404 ──────────────────────────────────────────────────────────────────
  json(res, 404, { error: 'Not found' });
}

// ─────────────────────────────────────────────────────────────────────────────
// Server lifecycle
// ─────────────────────────────────────────────────────────────────────────────

let server: http.Server | null = null;

export function startDashboardServer(): void {
  server = http.createServer((req, res) => {
    handleRequest(req, res).catch(err => {
      logger.error(`[DashboardServer] Unhandled error: ${err}`);
      try {
        json(res, 500, { error: 'Internal server error' });
      } catch {
        // response already sent
      }
    });
  });

  server.listen(DASHBOARD_PORT, '127.0.0.1', () => {
    logger.info(`[DashboardServer] Listening on http://127.0.0.1:${DASHBOARD_PORT}`);
    logger.info(`[DashboardServer] Open dashboard: http://127.0.0.1:${DASHBOARD_PORT}/`);
    if (DASHBOARD_PASSWORD) {
      logger.info('[DashboardServer] Password protection is enabled.');
    }
  });

  server.on('error', (err) => {
    logger.error(`[DashboardServer] Server error: ${err}`);
  });
}

export function stopDashboardServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) { resolve(); return; }
    server.close(() => {
      logger.info('[DashboardServer] Stopped.');
      resolve();
    });
  });
}
