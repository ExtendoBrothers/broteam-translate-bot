/**
 * Post tracker to enforce conservative 12 posts per 24 hours limit to prevent rate limiting
 * Tracks timestamps of posts and ensures we never exceed the limit
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger';
import { atomicWriteJsonSync } from './safeFileOps';

const POST_TRACKER_FILE = path.join(process.cwd(), '.post-tracker.json');
// NOTE: If you change MAX_POSTS_PER_24H, update tests/duplicate-prevention.test.ts expectations
const MAX_POSTS_PER_24H = 12; // Conservative limit to prevent rate limiting
const WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

interface PostTrackerState {
    postTimestamps: string[]; // ISO timestamps of posts
    automaticAttempts?: Record<string, AutomaticAttempt>;
}

interface AutomaticAttempt {
  timestamp: string;
  count: number;
}

class PostTracker {
  private postTimestamps: Date[] = [];
  private automaticAttempts: Record<string, AutomaticAttempt> = Object.create(null);
  private storageError?: string;

  constructor() {
    this.loadState();
  }

  public reload(): void {
    this.postTimestamps = [];
    this.automaticAttempts = Object.create(null);
    this.storageError = undefined;
    this.loadState();
  }

  /**
     * Load persisted state from file
     */
  private loadState() {
    try {
      if (fs.existsSync(POST_TRACKER_FILE)) {
        const data = fs.readFileSync(POST_TRACKER_FILE, 'utf-8');
        const state: PostTrackerState = JSON.parse(data);
        if (!Array.isArray(state.postTimestamps) ||
            state.postTimestamps.some(ts => typeof ts !== 'string' || isNaN(new Date(ts).getTime()))) {
          throw new Error('Invalid post timestamp history');
        }
        this.postTimestamps = state.postTimestamps.map(ts => new Date(ts));
        if (state.automaticAttempts !== undefined) {
          if (!state.automaticAttempts || typeof state.automaticAttempts !== 'object' ||
              Array.isArray(state.automaticAttempts)) throw new Error('Invalid automatic attempts');
          for (const [id, attempt] of Object.entries(state.automaticAttempts)) {
            if (!attempt || typeof attempt.timestamp !== 'string' ||
                isNaN(new Date(attempt.timestamp).getTime()) ||
                !Number.isSafeInteger(attempt.count) || attempt.count < 1) {
              throw new Error(`Invalid automatic attempt ${id}`);
            }
            this.automaticAttempts[id] = attempt;
          }
        }
                
        logger.info(`Loaded ${this.postTimestamps.length} post timestamps from tracker`);
      }
    } catch (error) {
      this.storageError = `Failed to load post tracker state: ${error}`;
      logger.error(`Failed to load post tracker state: ${error}`);
    }
  }

  /**
     * Save state to file
     */
  private saveState(): boolean {
    if (this.storageError) {
      logger.error(`Cannot save post tracker state: ${this.storageError}`);
      return false;
    }
    try {
      const state: PostTrackerState = {
        postTimestamps: this.postTimestamps.map(date => date.toISOString()),
        automaticAttempts: this.automaticAttempts,
      };
      if (!atomicWriteJsonSync(POST_TRACKER_FILE, state)) {
        this.storageError = 'Failed to persist post tracker state';
        logger.error(this.storageError);
        return false;
      }
      return true;
    } catch (error) {
      this.storageError = `Failed to save post tracker state: ${error}`;
      logger.error(`Failed to save post tracker state: ${error}`);
      return false;
    }
  }

  /**
     * Remove posts older than 24 hours
     */
  private cleanOldPosts() {
    const cutoff = new Date(Date.now() - WINDOW_MS);
    const beforeCount = this.postTimestamps.length;
    const attemptsBefore = Object.keys(this.automaticAttempts).length;
    this.postTimestamps = this.postTimestamps.filter(date => date > cutoff);
    for (const [id, attempt] of Object.entries(this.automaticAttempts)) {
      if (new Date(attempt.timestamp) <= cutoff) delete this.automaticAttempts[id];
    }
        
    if (beforeCount !== this.postTimestamps.length || attemptsBefore !== Object.keys(this.automaticAttempts).length) {
      logger.info(`Cleaned ${beforeCount - this.postTimestamps.length} posts older than 24 hours`);
      this.saveState();
    }
  }

  /**
     * Get number of posts in the last 24 hours
     */
  public getPostCount24h(): number {
    this.cleanOldPosts();
    return this.postTimestamps.length +
      Object.values(this.automaticAttempts).reduce((sum, attempt) => sum + attempt.count, 0);
  }

  public getPostCount30m(): number {
    const cutoff = Date.now() - 30 * 60 * 1000;
    return this.postTimestamps.filter(date => date.getTime() > cutoff).length +
      Object.values(this.automaticAttempts).filter(attempt => new Date(attempt.timestamp).getTime() > cutoff)
        .reduce((sum, attempt) => sum + attempt.count, 0);
  }

  public getStorageError(): string | undefined {
    return this.storageError;
  }

  public reserveAutomaticAttempt(id: string, timestamp: string, count: number): boolean {
    if (this.storageError) return false;
    if (!id || !Number.isSafeInteger(count) || count < 1 || isNaN(new Date(timestamp).getTime())) {
      this.storageError = 'Invalid automatic attempt accounting';
      logger.error(this.storageError);
      return false;
    }
    if (new Date(timestamp).getTime() <= Date.now() - WINDOW_MS) return true;
    const existing = this.automaticAttempts[id];
    if (existing) {
      if (existing.timestamp === timestamp && existing.count === count) return true;
      this.storageError = `Conflicting automatic attempt accounting for ${id}`;
      logger.error(this.storageError);
      return false;
    }
    this.automaticAttempts[id] = { timestamp, count };
    return this.saveState();
  }

  /**
     * Check if we can post without exceeding the limit
     */
  public canPost(): boolean {
    return this.getPostCount24h() < MAX_POSTS_PER_24H;
  }

  /**
     * Get how many more posts are allowed in the current 24h window
     */
  public getRemainingPosts(): number {
    return Math.max(0, MAX_POSTS_PER_24H - this.getPostCount24h());
  }

  /**
     * Get the maximum number of posts allowed per 24 hours
     */
  public getMaxPosts24h(): number {
    return MAX_POSTS_PER_24H;
  }

  /**
     * Record a new post
     */
  public recordPost() {
    this.postTimestamps.push(new Date());
    this.saveState();
    logger.info(`Recorded post. Total in last 24h: ${this.getPostCount24h()}`);
  }

  /**
     * Get time until oldest post expires (when we can post again)
     */
  public getTimeUntilNextSlot(): number {
    if (this.canPost()) return 0;
        
    // Find the oldest post timestamp
    const timestamps = [
      ...this.postTimestamps,
      ...Object.values(this.automaticAttempts).map(attempt => new Date(attempt.timestamp)),
    ];
    const oldestPost = timestamps.reduce((oldest, current) =>
      current < oldest ? current : oldest
    );
        
    const resetTime = new Date(oldestPost.getTime() + WINDOW_MS);
    const msUntilReset = resetTime.getTime() - Date.now();
        
    return Math.max(0, Math.ceil(msUntilReset / 1000)); // Return seconds
  }

  /**
     * Clear all posts (for testing)
     */
  public clear() {
    this.postTimestamps = [];
    this.automaticAttempts = Object.create(null);
    this.saveState();
    logger.info('Post tracker cleared');
  }
}

// Singleton instance
export const postTracker = new PostTracker();
