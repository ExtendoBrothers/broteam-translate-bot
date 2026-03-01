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
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const STORE_FILE = path.join(process.cwd(), 'candidate-queue.json');
// Maximum items to keep in the queue (oldest skipped/posted items are pruned)
const MAX_QUEUE_SIZE = 100;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type QueueStatus = 'generating' | 'ready' | 'posted' | 'skipped';

export interface QueueItem {
  id: string;
  tweet: Tweet & { createdAt: string }; // serialized as ISO string
  candidates: Candidate[];
  fetchedAt: string;  // ISO date
  status: QueueStatus;
  postedCandidateIndex?: number;
  postedAt?: string;
  skippedAt?: string;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Store implementation
// ─────────────────────────────────────────────────────────────────────────────

class CandidateStore {
  private items: Map<string, QueueItem> = new Map();

  constructor() {
    this._load();
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  private _load(): void {
    try {
      if (!fs.existsSync(STORE_FILE)) return;
      const raw = fs.readFileSync(STORE_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as QueueItem[];
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          this.items.set(item.id, item);
        }
        logger.info(`[CandidateStore] Loaded ${this.items.size} item(s) from disk`);
      }
    } catch (err) {
      logger.warn(`[CandidateStore] Could not load store file: ${err}`);
    }
  }

  private _save(): void {
    try {
      const arr = Array.from(this.items.values());
      atomicWriteJsonSync(STORE_FILE, arr);
    } catch (err) {
      logger.error(`[CandidateStore] Failed to persist store: ${err}`);
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
      if (item.status === 'posted' || item.status === 'skipped') {
        this.items.delete(item.id);
      }
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
    if (!item) return null;
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
    if (!item) return false;
    item.status = 'skipped';
    item.skippedAt = new Date().toISOString();
    this._save();
    return true;
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
}

// Singleton
export const candidateStore = new CandidateStore();
