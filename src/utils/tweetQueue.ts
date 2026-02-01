/**
 * Tweet queue for handling tweets that couldn't be posted due to rate limits
 * Persists queue to file so it survives restarts
 */

import * as path from 'path';
import { logger } from './logger';
import { safeReadJsonSync, safeWriteJsonSync } from './safeFileOps';

const QUEUE_FILE = path.join(process.cwd(), '.tweet-queue.json');

export interface QueuedTweet {
    sourceTweetId: string;
    finalTranslation: string;
    queuedAt: string;
    attemptCount: number;
}

interface QueueState {
    queue: QueuedTweet[];
}

class TweetQueue {
  private queue: QueuedTweet[] = [];

  constructor() {
    this.loadState();
  }

  /**
     * Load persisted queue from file
     */
  private loadState() {
    const state = safeReadJsonSync<QueueState>(QUEUE_FILE, { queue: [] });
    this.queue = state.queue || [];
    logger.info(`Loaded ${this.queue.length} queued tweets from persistent storage`);
  }

  /**
     * Save queue to file
     */
  private saveState() {
    const state: QueueState = { queue: this.queue };
    safeWriteJsonSync(QUEUE_FILE, state);
  }

  /**
     * Add a tweet to the queue
     */
  public async enqueue(sourceTweetId: string, finalTranslation: string) {
    // Check if already queued to avoid duplicates
    const existing = this.queue.find(t => t.sourceTweetId === sourceTweetId);
    if (existing) {
      logger.info(`Tweet ${sourceTweetId} already in queue, skipping`);
      return;
    }

    // CRITICAL: Check if already processed to prevent queuing tweets that have been posted
    // Import dynamically to avoid circular dependency
    const { tweetTracker } = await import('./tweetTracker');
    if (tweetTracker.isProcessed(sourceTweetId)) {
      logger.info(`Tweet ${sourceTweetId} already processed, not adding to queue`);
      return;
    }

    this.queue.push({
      sourceTweetId,
      finalTranslation,
      queuedAt: new Date().toISOString(),
      attemptCount: 0
    });
    this.saveState();
    logger.info(`Queued tweet ${sourceTweetId} for later posting. Queue size: ${this.queue.length}`);
  }

  /**
     * Get the next tweet from the queue without removing it
     */
  public peek(): QueuedTweet | null {
    return this.queue.length > 0 ? this.queue[0] : null;
  }

  /**
     * Remove the first tweet from the queue (after successful post)
     */
  public dequeue(): QueuedTweet | null {
    if (this.queue.length === 0) return null;
        
    const tweet = this.queue.shift();
    if (!tweet) return null;
    this.saveState();
    logger.info(`Dequeued tweet ${tweet.sourceTweetId}. Queue size: ${this.queue.length}`);
    return tweet;
  }

  /**
     * Increment attempt count for the current queued tweet
     */
  public incrementAttempt() {
    if (this.queue.length > 0) {
      this.queue[0].attemptCount++;
      this.saveState();
    }
  }

  /**
     * Get queue size
     */
  public size(): number {
    return this.queue.length;
  }

  /**
     * Check if queue is empty
     */
  public isEmpty(): boolean {
    return this.queue.length === 0;
  }

  /**
     * Check if a tweet is already in the queue
     */
  public isQueued(sourceTweetId: string): boolean {
    return this.queue.some(t => t.sourceTweetId === sourceTweetId);
  }

  /**
     * Remove a specific tweet from the queue by ID (without marking as processed)
     */
  public removeById(sourceTweetId: string): boolean {
    const index = this.queue.findIndex(t => t.sourceTweetId === sourceTweetId);
    if (index === -1) return false;
    this.queue.splice(index, 1);
    this.saveState();
    logger.info(`Removed tweet ${sourceTweetId} from queue. Queue size: ${this.queue.length}`);
    return true;
  }

  /**
     * Get the full queue (for inspection)
     */
  public getQueue(): QueuedTweet[] {
    return [...this.queue];
  }

  /**
     * Clear the queue (for testing/manual override)
     */
  public clear() {
    this.queue = [];
    this.saveState();
    logger.info('Tweet queue cleared');
  }
}

// Singleton instance
export const tweetQueue = new TweetQueue();
