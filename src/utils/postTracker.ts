/**
 * Post tracker to enforce Twitter's 17 posts per 24 hours limit
 * Tracks timestamps of posts and ensures we never exceed the limit
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger';

const POST_TRACKER_FILE = path.join(process.cwd(), '.post-tracker.json');
const MAX_POSTS_PER_24H = 17;
const WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

interface PostTrackerState {
    postTimestamps: string[]; // ISO timestamps of posts
}

class PostTracker {
  private postTimestamps: Date[] = [];

  constructor() {
    this.loadState();
    this.cleanOldPosts();
  }

  /**
     * Load persisted state from file
     */
  private loadState() {
    try {
      if (fs.existsSync(POST_TRACKER_FILE)) {
        const data = fs.readFileSync(POST_TRACKER_FILE, 'utf-8');
        const state: PostTrackerState = JSON.parse(data);
                
        this.postTimestamps = (state.postTimestamps || [])
          .map(ts => new Date(ts))
          .filter(date => !isNaN(date.getTime())); // Filter invalid dates
                
        logger.info(`Loaded ${this.postTimestamps.length} post timestamps from tracker`);
      }
    } catch (error) {
      logger.error(`Failed to load post tracker state: ${error}`);
    }
  }

  /**
     * Save state to file
     */
  private saveState() {
    try {
      const state: PostTrackerState = {
        postTimestamps: this.postTimestamps.map(date => date.toISOString())
      };
      const tmp = POST_TRACKER_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
      fs.renameSync(tmp, POST_TRACKER_FILE);
    } catch (error) {
      logger.error(`Failed to save post tracker state: ${error}`);
    }
  }

  /**
     * Remove posts older than 24 hours
     */
  private cleanOldPosts() {
    const cutoff = new Date(Date.now() - WINDOW_MS);
    const beforeCount = this.postTimestamps.length;
    this.postTimestamps = this.postTimestamps.filter(date => date > cutoff);
        
    if (beforeCount !== this.postTimestamps.length) {
      logger.info(`Cleaned ${beforeCount - this.postTimestamps.length} posts older than 24 hours`);
      this.saveState();
    }
  }

  /**
     * Get number of posts in the last 24 hours
     */
  public getPostCount24h(): number {
    this.cleanOldPosts();
    return this.postTimestamps.length;
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
     * Record a new post
     */
  public recordPost() {
    this.postTimestamps.push(new Date());
    this.saveState();
    logger.info(`Recorded post. Total in last 24h: ${this.getPostCount24h()}/${MAX_POSTS_PER_24H}`);
  }

  /**
     * Get time until oldest post expires (when we can post again)
     */
  public getTimeUntilNextSlot(): number {
    if (this.canPost()) return 0;
        
    // Find the oldest post timestamp
    const oldestPost = this.postTimestamps.reduce((oldest, current) => 
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
    this.saveState();
    logger.info('Post tracker cleared');
  }
}

// Singleton instance
export const postTracker = new PostTracker();
