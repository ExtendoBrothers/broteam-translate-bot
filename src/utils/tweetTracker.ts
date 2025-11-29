/**
 * Tweet tracker to avoid processing duplicates
 * Persists processed tweet IDs to file
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger';
import { tweetQueue } from './tweetQueue';

const TWEET_TRACKER_FILE = path.join(process.cwd(), '.processed-tweets.json');
const START_DATE = new Date('2025-11-12T00:00:00.000Z'); // Ignore tweets before this date

interface TweetTrackerStateV1 {
    processedTweetIds: string[];
    lastProcessedAt: string | null;
}
interface TweetTrackerStateV2 {
    processed: Record<string, string>; // id -> ISO timestamp
    lastProcessedAt: string | null;
}

class TweetTracker {
  private processed: Map<string, Date> = new Map();
  private lastProcessedAt: Date | null = null;

  constructor() {
    this.loadState();
  }

  /**
     * Load persisted state from file
     */
  private loadState() {
    try {
      if (fs.existsSync(TWEET_TRACKER_FILE)) {
        const data = fs.readFileSync(TWEET_TRACKER_FILE, 'utf-8');
        const parsed = JSON.parse(data);
        if (parsed && parsed.processed) {
          const state = parsed as TweetTrackerStateV2;
          for (const [id, ts] of Object.entries(state.processed)) {
            const dt = new Date(ts);
            if (isFinite(dt.getTime())) this.processed.set(id, dt);
          }
          this.lastProcessedAt = state.lastProcessedAt ? new Date(state.lastProcessedAt) : null;
          logger.info(`Loaded ${this.processed.size} processed tweet IDs from tracker (v2)`);
        } else {
          const state = parsed as TweetTrackerStateV1;
          const now = new Date();
          for (const id of state.processedTweetIds || []) {
            this.processed.set(id, now);
          }
          this.lastProcessedAt = state.lastProcessedAt ? new Date(state.lastProcessedAt) : null;
          logger.info(`Loaded ${this.processed.size} processed tweet IDs from tracker (v1→v2)`);
          this.saveState();
        }
      }
    } catch (error) {
      logger.error(`Failed to load tweet tracker state: ${error}`);
    }
  }

  /**
     * Save state to file
     */
  private saveState() {
    try {
      const processedObj: Record<string, string> = {};
      for (const [id, dt] of this.processed.entries()) {
        processedObj[id] = dt.toISOString();
      }
      if (Object.keys(processedObj).length === 0) {
        logger.warn('[SAFEGUARD] Attempted to save processed tweets file with zero entries. Save aborted to prevent data loss.');
        return;
      }
      const state: TweetTrackerStateV2 = {
        processed: processedObj,
        lastProcessedAt: this.lastProcessedAt ? this.lastProcessedAt.toISOString() : null
      };
      const tmp = TWEET_TRACKER_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
      fs.renameSync(tmp, TWEET_TRACKER_FILE);
    } catch (error) {
      logger.error(`Failed to save tweet tracker state: ${error}`);
    }
  }

  /**
     * Check if tweet should be processed
     */
  public shouldProcess(tweetId: string, createdAt: string): boolean {
    // Check if already processed
    if (this.processed.has(tweetId)) {
      logger.info(`Skipping tweet ${tweetId} - already processed`);
      return false;
    }

    // Check if already in queue (being retried)
    if (tweetQueue.isQueued(tweetId)) {
      logger.info(`Skipping tweet ${tweetId} - already in posting queue`);
      return false;
    }

    // Check if tweet is before start date
    const tweetDate = new Date(createdAt);
    if (tweetDate < START_DATE) {
      logger.info(`Skipping tweet ${tweetId} - created before ${START_DATE.toISOString()}`);
      return false;
    }

    return true;
  }

  /**
     * Mark tweet as processed
     */
  public markProcessed(tweetId: string) {
    this.processed.set(tweetId, new Date());
    this.lastProcessedAt = new Date();
    this.saveState();
    logger.info(`Marked tweet ${tweetId} as processed`);
  }

  /**
     * Get the last processed timestamp
     */
  public getLastProcessedAt(): Date | null {
    return this.lastProcessedAt;
  }

  /**
     * Clear all processed tweets (for testing)
     */
  public clear() {
    this.processed.clear();
    this.lastProcessedAt = null;
        
    try {
      if (fs.existsSync(TWEET_TRACKER_FILE)) {
        fs.unlinkSync(TWEET_TRACKER_FILE);
      }
    } catch (error) {
      logger.error(`Failed to remove tweet tracker file: ${error}`);
    }
        
    logger.info('Tweet tracker cleared');
  }

  /**
     * Prune processed IDs older than retentionDays and cap max entries
     */
  public prune(retentionDays = 90, maxEntries = 50000) {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    let removed = 0;
    // Remove by age
    for (const [id, dt] of Array.from(this.processed.entries())) {
      if (dt < cutoff) {
        this.processed.delete(id);
        removed++;
      }
    }
    // Cap by size (remove oldest)
    if (this.processed.size > maxEntries) {
      const entries = Array.from(this.processed.entries());
      entries.sort((a, b) => a[1].getTime() - b[1].getTime());
      const toRemove = this.processed.size - maxEntries;
      for (let i = 0; i < toRemove; i++) this.processed.delete(entries[i][0]);
      removed += toRemove;
    }
    if (removed > 0) {
      logger.info(`Pruned ${removed} processed tweet IDs (retention ${retentionDays}d, max ${maxEntries})`);
      this.saveState();
    }
  }
}

// Singleton instance
export const tweetTracker = new TweetTracker();
