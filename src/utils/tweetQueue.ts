/**
 * Tweet queue for handling tweets that couldn't be posted due to rate limits
 * Persists queue to file so it survives restarts
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger';

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
    try {
      if (fs.existsSync(QUEUE_FILE)) {
        const data = fs.readFileSync(QUEUE_FILE, 'utf-8');
        const state: QueueState = JSON.parse(data);
        this.queue = state.queue || [];
        logger.info(`Loaded ${this.queue.length} queued tweets from persistent storage`);
      }
    } catch (error) {
      logger.error(`Failed to load tweet queue state: ${error}`);
    }
  }

  /**
     * Save queue to file
     */
  private saveState() {
    try {
      const state: QueueState = {
        queue: this.queue
      };
      const tmp = QUEUE_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
      fs.renameSync(tmp, QUEUE_FILE);
    } catch (error) {
      logger.error(`Failed to save tweet queue state: ${error}`);
    }
  }

  /**
     * Add a tweet to the queue
     */
  public enqueue(sourceTweetId: string, finalTranslation: string) {
    // Check if already queued to avoid duplicates
    const existing = this.queue.find(t => t.sourceTweetId === sourceTweetId);
    if (existing) {
      logger.info(`Tweet ${sourceTweetId} already in queue, skipping`);
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
