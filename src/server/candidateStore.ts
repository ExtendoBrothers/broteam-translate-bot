/**
 * Candidate Store — Manual Mode Fork
 *
 * In-memory store of tweet queue items, each holding 4 translation candidates.
 * Persists state to candidate-queue.json (atomic writes) so items survive restarts.
 */

import { Tweet } from '../types';
import { Candidate } from '../workers/candidateGenerator';
import { atomicWriteJsonSync } from '../utils/safeFileOps';
import { logger } from '../utils/logger';
import { splitTweet } from '../utils/tweetSplitter';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const STORE_FILE = path.join(process.cwd(), 'candidate-queue.json');
// Maximum items to keep in the queue (oldest skipped/posted items are pruned)
const MAX_QUEUE_SIZE = 100;
export function isAutoPostEligible(item: QueueItem): boolean {
  return item.status === 'ready' && !item.autoPostState;
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type QueueStatus = 'generating' | 'ready' | 'posted' | 'skipped';

export interface QueueItem {
  id: string;
  tweet: Omit<Tweet, 'createdAt'> & { createdAt: string }; // serialized as ISO string
  candidates: Candidate[];
  fetchedAt: string;  // ISO date
  status: QueueStatus;
  postedCandidateIndex?: number;
  postedAt?: string;
  skippedAt?: string;
  error?: string;
  autoPostState?: 'posting' | 'posted' | 'uncertain' | 'blocked';
  autoPostError?: string;
  autoPostRetryCount?: number;
  autoPostRetryAt?: string;
  autoPostRetryable?: boolean;
  autoPostAttempt?: { timestamp: string; partCount: number; content: string };
  autoPostAccounted?: boolean;
  autoPostRecorded?: boolean;
  preferredCandidateIndex?: number;
  preferredAt?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Store implementation
// ─────────────────────────────────────────────────────────────────────────────

class CandidateStore {
  private items: Map<string, QueueItem> = new Map();
  private loadError?: string;
  private initialized = false;

  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;
    this._load();
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  private _load(): void {
    try {
      if (!fs.existsSync(STORE_FILE)) return;
      const raw = fs.readFileSync(STORE_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as QueueItem[];
      if (!Array.isArray(parsed)) throw new Error('Queue file must contain an array');
      if (Array.isArray(parsed)) {
        let changed = false;
        for (const item of parsed) {
          if (item.autoPostAttempt &&
              (typeof item.autoPostAttempt.timestamp !== 'string' ||
               isNaN(Date.parse(item.autoPostAttempt.timestamp)) ||
               !Number.isSafeInteger(item.autoPostAttempt.partCount) || item.autoPostAttempt.partCount < 1 ||
               typeof item.autoPostAttempt.content !== 'string')) {
            throw new Error(`Invalid automatic post attempt for ${item.id}`);
          }
          if (item.autoPostState === 'posting') {
            if (!item.autoPostAttempt) {
              const candidate = item.candidates[item.postedCandidateIndex ?? -1];
              if (!candidate) throw new Error(`Interrupted post ${item.id} has no candidate`);
              item.autoPostAttempt = {
                timestamp: new Date().toISOString(),
                partCount: splitTweet(candidate.result).length,
                content: candidate.result,
              };
            }
            item.autoPostState = 'uncertain';
            item.autoPostError = 'Posting was interrupted. Check Twitter before dismissing this item.';
            item.autoPostRetryable = false;
            delete item.autoPostRetryAt;
            changed = true;
          } else if (item.autoPostState === 'uncertain' &&
              (item.autoPostRetryable === true || item.autoPostRetryAt !== undefined ||
               (item.autoPostRetryable === undefined && item.autoPostError?.includes('Automatic retry')))) {
            item.autoPostRetryable = false;
            delete item.autoPostRetryAt;
            item.autoPostError = 'Posting outcome uncertain. Automatic retries are disabled; check X before confirming or dismissing this item.';
            changed = true;
          }
          this.items.set(item.id, item);
        }
        if (changed && !this._save()) {
          this.loadError = 'Could not persist uncertain post state';
          logger.error(`[CandidateStore] ${this.loadError}`);
        }
        logger.info(`[CandidateStore] Loaded ${this.items.size} item(s) from disk`);
      }
    } catch (err) {
      this.loadError = String(err);
      logger.warn(`[CandidateStore] Could not load store file: ${err}`);
    }
  }

  private _save(): boolean {
    try {
      const arr = Array.from(this.items.values());
      return atomicWriteJsonSync(STORE_FILE, arr);
    } catch (err) {
      logger.error(`[CandidateStore] Failed to persist store: ${err}`);
      return false;
    }
  }

  private _prune(): void {
    if (this.items.size <= MAX_QUEUE_SIZE) return;
    // Remove oldest non-pending items first
    const sorted = Array.from(this.items.values()).sort(
      (a, b) => new Date(a.fetchedAt).getTime() - new Date(b.fetchedAt).getTime()
    );
    for (const item of sorted) {
      if (this.items.size <= MAX_QUEUE_SIZE) break;
      if ((item.status === 'posted' && (item.autoPostState !== 'posted' ||
          (item.preferredAt && (!item.autoPostAttempt || item.autoPostRecorded)))) || item.status === 'skipped') {
        this.items.delete(item.id);
      }
    }
  }

  private _removeFromOldQueue(tweetId: string, oldQueuePath = path.join(process.cwd(), '.tweet-queue.json')): void {
    try {
      if (!fs.existsSync(oldQueuePath)) return;
      const raw = fs.readFileSync(oldQueuePath, 'utf-8');
      const parsed = JSON.parse(raw) as {
        queue?: Array<{ sourceTweetId: string; finalTranslation: string; queuedAt: string; attemptCount: number }>;
      };
      const queue = Array.isArray(parsed.queue) ? parsed.queue : [];
      const filtered = queue.filter(entry => entry.sourceTweetId !== tweetId);
      if (filtered.length === queue.length) return;

      atomicWriteJsonSync(oldQueuePath, { ...parsed, queue: filtered });
      logger.info(`[CandidateStore] Removed skipped tweet ${tweetId} from old queue source`);
    } catch (err) {
      logger.warn(`[CandidateStore] Could not prune old queue for skipped tweet ${tweetId}: ${err}`);
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Add a tweet to the queue with status 'generating'.
   * Returns the new queue item id.
   */
  add(tweet: Tweet): string {
    const id = crypto.randomUUID();
    const item: QueueItem = {
      id,
      tweet: { ...tweet, createdAt: tweet.createdAt instanceof Date
        ? tweet.createdAt.toISOString()
        : String(tweet.createdAt)
      } as QueueItem['tweet'],
      candidates: [],
      fetchedAt: new Date().toISOString(),
      status: 'generating',
    };
    this.items.set(id, item);
    this._prune();
    this._save();
    return id;
  }

  /**
   * Called when candidate generation is complete. Updates candidates and sets status to 'ready'.
   */
  setReady(id: string, candidates: Candidate[]): void {
    const item = this.items.get(id);
    if (!item) {
      logger.warn(`[CandidateStore] setReady: unknown id ${id}`);
      return;
    }
    item.candidates = candidates;
    item.status = 'ready';
    this._save();
  }

  /**
   * Called when candidate generation fails.
   */
  setError(id: string, error: string): void {
    const item = this.items.get(id);
    if (!item) return;
    item.status = 'ready'; // still show to the user, might have partial results
    item.error = error;
    this._save();
  }

  /**
   * Mark a candidate as posted. Returns the Twitter intent URL for the chosen text.
   */
  markPosted(id: string, candidateIndex: number): { intentUrl: string } | null {
    const item = this.items.get(id);
    if (!item || item.status !== 'ready' || item.autoPostState === 'posting' ||
        item.autoPostState === 'posted' || item.autoPostState === 'uncertain') return null;
    const candidate = item.candidates[candidateIndex];
    if (!candidate) return null;

    item.status = 'posted';
    item.postedCandidateIndex = candidateIndex;
    item.postedAt = new Date().toISOString();
    this._save();

    const encodedText = encodeURIComponent(candidate.result);
    return { intentUrl: `https://twitter.com/intent/tweet?text=${encodedText}` };
  }

  /** Mark a tweet as skipped (dismissed from queue). */
  markSkipped(id: string): boolean {
    const item = this.items.get(id);
    if (!item || item.autoPostState === 'posting' ||
        (item.autoPostAttempt && !item.autoPostAccounted)) return false;
    item.status = 'skipped';
    item.skippedAt = new Date().toISOString();
    this._removeFromOldQueue(item.tweet.id);
    this._save();
    return true;
  }

  /** Persist an in-flight marker before contacting Twitter, preventing blind retries after a crash. */
  beginAutoPost(id: string, candidateIndex: number, partCount: number): boolean {
    const item = this.items.get(id);
    if (!item || !isAutoPostEligible(item) || !item.candidates[candidateIndex] ||
        !Number.isSafeInteger(partCount) || partCount < 1) return false;
    const previous = { ...item };
    item.autoPostState = 'posting';
    item.postedCandidateIndex = candidateIndex;
    item.autoPostAttempt = {
      timestamp: new Date().toISOString(),
      partCount,
      content: item.candidates[candidateIndex].result,
    };
    if (this._save()) return true;
    Object.assign(item, previous);
    if (previous.autoPostState === undefined) delete item.autoPostState;
    if (previous.postedCandidateIndex === undefined) delete item.postedCandidateIndex;
    if (previous.autoPostAttempt === undefined) delete item.autoPostAttempt;
    return false;
  }

  markAutoPostAccounted(id: string): boolean {
    const item = this.items.get(id);
    if (!item?.autoPostAttempt) return false;
    if (item.autoPostAccounted) return true;
    item.autoPostAccounted = true;
    if (this._save()) return true;
    delete item.autoPostAccounted;
    return false;
  }

  markAutoPostRecorded(id: string): boolean {
    const item = this.items.get(id);
    if (!item?.autoPostAttempt || item.autoPostState !== 'posted') return false;
    if (item.autoPostRecorded) return true;
    item.autoPostRecorded = true;
    if (this._save()) return true;
    delete item.autoPostRecorded;
    return false;
  }

  finishAutoPost(id: string, state: 'posted' | 'uncertain' | 'blocked', error?: string): boolean {
    const item = this.items.get(id);
    if (!item || (state === 'blocked'
      ? !isAutoPostEligible(item)
      : item.autoPostState !== 'posting')) return false;
    item.autoPostState = state;
    item.autoPostError = error;
    item.autoPostRetryable = false;
    delete item.autoPostRetryAt;
    if (state === 'posted') {
      item.status = 'posted';
      item.postedAt = new Date().toISOString();
    }
    return this._save();
  }

  confirmUncertainPost(id: string): boolean {
    const item = this.items.get(id);
    if (!item || item.status !== 'ready' || item.autoPostState !== 'uncertain' ||
        item.postedCandidateIndex === undefined || !item.candidates[item.postedCandidateIndex]) return false;
    const previous = { ...item };
    item.status = 'posted';
    item.autoPostState = 'posted';
    item.postedAt = new Date().toISOString();
    item.autoPostRetryable = false;
    delete item.autoPostError;
    delete item.autoPostRetryAt;
    if (this._save()) return true;
    Object.assign(item, previous);
    if (previous.postedAt === undefined) delete item.postedAt;
    if (previous.autoPostRetryable === undefined) delete item.autoPostRetryable;
    return false;
  }

  selectPreference(id: string, candidateIndex: number): boolean {
    const item = this.items.get(id);
    if (!item || item.autoPostState !== 'posted' || item.preferredAt || !item.candidates[candidateIndex]) return false;
    item.preferredCandidateIndex = candidateIndex;
    item.preferredAt = new Date().toISOString();
    if (this._save()) return true;
    delete item.preferredCandidateIndex;
    delete item.preferredAt;
    return false;
  }

  /** Get all items (optionally filter by status). */
  list(filter?: QueueStatus | QueueStatus[]): QueueItem[] {
    const all = Array.from(this.items.values());
    if (!filter) return all;
    const statuses = Array.isArray(filter) ? filter : [filter];
    return all.filter(item => statuses.includes(item.status));
  }

  getById(id: string): QueueItem | undefined {
    return this.items.get(id);
  }

  getLoadError(): string | undefined {
    return this.loadError;
  }

  /**
   * Import unposted items from the old auto-bot's .tweet-queue.json.
   * Uses translation-logs/all-translations.log to recover the original tweet text.
   * Already-imported items (matched by tweet ID) are silently skipped.
   */
  importOldQueue(
    oldQueuePath = path.join(process.cwd(), '.tweet-queue.json'),
    logPath = path.join(process.cwd(), 'translation-logs', 'all-translations.log')
  ): number {
    // ── Parse translation log: build map tweetId → { input, finalResult, humorScore, chain }
    const logMap = new Map<string, { input: string; finalResult: string; humorScore: number; chain: string }>();
    try {
      const log = fs.readFileSync(logPath, 'utf-8');
      // Each entry is separated by `---\n` and contains:
      //   Timestamp: ...\nTweet ID: ...\nInput: ...\nChosen Chain: ...\nHumor Score: ...\nSteps:\nFinal Result: ...\n
      const entries = log.split(/^---\s*$/m);
      for (const entry of entries) {
        const idMatch    = entry.match(/^Tweet ID:\s*(.+)$/m);
        const inputMatch = entry.match(/^Input:\s*([\s\S]*?)(?=^Chosen Chain:|^---)/m);
        const chainMatch = entry.match(/^Chosen Chain:\s*(.+)$/m);
        const humorMatch = entry.match(/^Humor Score:\s*([\d.]+)/m);
        const resultMatch = entry.match(/^Final Result:\s*([\s\S]*?)(?=^---|$)/m);
        if (!idMatch) continue;
        logMap.set(idMatch[1].trim(), {
          input:       inputMatch  ? inputMatch[1].trim()          : '',
          finalResult: resultMatch ? resultMatch[1].trim()         : '',
          humorScore:  humorMatch  ? parseFloat(humorMatch[1])     : 0,
          chain:       chainMatch  ? chainMatch[1].trim()          : 'Pre-translated',
        });
      }
      logger.info(`[CandidateStore] Parsed ${logMap.size} entries from translation log`);
    } catch (err) {
      logger.warn(`[CandidateStore] Could not read translation log: ${err}`);
    }

    // ── Build set of tweet IDs already in this store (avoid duplicates)
    const existingTweetIds = new Set(
      Array.from(this.items.values()).map(item => item.tweet.id)
    );

    // ── Read old queue
    let oldQueue: Array<{ sourceTweetId: string; finalTranslation: string; queuedAt: string; attemptCount: number }> = [];
    try {
      const raw = fs.readFileSync(oldQueuePath, 'utf-8');
      const parsed = JSON.parse(raw) as { queue?: typeof oldQueue };
      oldQueue = parsed.queue || [];
    } catch (err) {
      logger.warn(`[CandidateStore] Could not read old queue: ${err}`);
      return 0;
    }

    let imported = 0;
    for (const entry of oldQueue) {
      if (existingTweetIds.has(entry.sourceTweetId)) continue;

      const logEntry = logMap.get(entry.sourceTweetId);
      const sourceText  = logEntry?.input       || `[Source tweet #${entry.sourceTweetId}]`;
      const finalText   = entry.finalTranslation || logEntry?.finalResult || '';
      const humorScore  = logEntry?.humorScore   || 0;
      const chainLabel  = logEntry?.chain        || 'Pre-translated';

      const candidate: Candidate = {
        chainIndex:     0,
        chainLabel,
        languages:      [],
        result:         finalText,
        humorScore,
        heuristicOffset: 0,
        finalScore:     humorScore,
        isBestCandidate: true,
      };

      const item: QueueItem = {
        id: crypto.randomUUID(),
        tweet: {
          id:          entry.sourceTweetId,
          text:        sourceText,
          createdAt:   entry.queuedAt,
          user:        { id: 'BroTeamPills', username: 'BroTeamPills', displayName: 'BroTeamPills' },
        } as QueueItem['tweet'],
        candidates:    [candidate],
        fetchedAt:     entry.queuedAt,
        status:        'ready',
      };

      this.items.set(item.id, item);
      imported++;
    }

    if (imported > 0) {
      this._save();
      logger.info(`[CandidateStore] Imported ${imported} item(s) from old tweet queue`);
    }

    return imported;
  }

  /**
   * On startup, any item still marked 'generating' means the process crashed
   * or was restarted mid-generation. Return them so the caller can re-enqueue
   * them in the generationQueue (avoids circular import).
   *
   * Items are left as 'generating' in the store — the generationQueue will call
   * setReady / setError when the job completes, same as normal.
   */
  rehydrateStuck(): Array<{ id: string; tweet: Tweet }> {
    const stuck = Array.from(this.items.values()).filter(i => i.status === 'generating');
    if (stuck.length === 0) return [];
    logger.warn(`[CandidateStore] Found ${stuck.length} stuck 'generating' item(s) — re-enqueueing for translation`);
    return stuck.map(item => ({
      id: item.id,
      tweet: {
        ...item.tweet,
        createdAt: new Date(item.tweet.createdAt),
      } as Tweet,
    }));
  }
}

// Singleton
export const candidateStore = new CandidateStore();
