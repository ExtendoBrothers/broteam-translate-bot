/**
 * Sequential generation queue.
 *
 * Ensures only one `generateCandidates` call runs at a time so LibreTranslate
 * is never hit with concurrent chain requests. New items enqueued while a job
 * is running are appended and processed immediately after the current one
 * finishes — no artificial delays.
 */

import { Tweet } from '../types';
import { generateCandidates } from '../workers/candidateGenerator';
import { candidateStore } from './candidateStore';
import { logger } from '../utils/logger';
import { tweetTracker } from '../utils/tweetTracker';

interface Job {
  queueId: string;
  tweet: Tweet;
}

class GenerationQueue {
  private pending: Job[] = [];
  private running = false;

  /** Add a tweet to the generation queue. Returns immediately. */
  enqueue(queueId: string, tweet: Tweet): void {
    this.pending.push({ queueId, tweet });
    logger.debug(`[GenQueue] Enqueued ${queueId} (queue depth: ${this.pending.length})`);
    this._drain();
  }

  /** Number of jobs waiting (not counting the currently running one). */
  get depth(): number {
    return this.pending.length;
  }

  private _drain(): void {
    if (this.running || this.pending.length === 0) return;
    this.running = true;
    const job = this.pending.shift()!;
    setImmediate(() => this._run(job));
  }

  private async _run(job: Job): Promise<void> {
    logger.info(`[GenQueue] Starting generation for ${job.queueId} (${this.pending.length} waiting)`);
    try {
      const candidates = await generateCandidates(job.tweet);
      candidateStore.setReady(job.queueId, candidates);
      logger.info(`[GenQueue] Done: ${job.queueId}`);
    } catch (err) {
      candidateStore.setError(job.queueId, String(err));
      logger.error(`[GenQueue] Failed: ${job.queueId}: ${err}`);
    } finally {
      this.running = false;
      // Prune tweet tracker to prevent file growing unboundedly (same as main bot)
      try { tweetTracker.prune(90, 50000); } catch { /* non-critical */ }
      this._drain(); // immediately start next job if any
    }
  }
}

export const generationQueue = new GenerationQueue();
