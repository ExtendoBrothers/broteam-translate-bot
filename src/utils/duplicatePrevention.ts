/**
 * Comprehensive duplicate prevention system
 * Integrates multiple layers of protection against duplicate posts
 */

import { logger } from './logger';
import { tweetTracker } from './tweetTracker';
import { postTracker } from './postTracker';
import { tweetQueue } from './tweetQueue';
import { isContentDuplicateSync, logPostedContent, prunePostedOutputs } from './contentDeduplication';
import { checkTranslationStability, pruneStabilityLog } from './translationStability';
import { acquireLock } from './enhancedInstanceLock';

interface DuplicateCheckResult {
  canProceed: boolean;
  reason: string;
  severity: 'block' | 'warn' | 'info';
}

/**
 * Comprehensive duplicate prevention check
 * Runs all available duplicate detection mechanisms
 */
export async function checkForDuplicates(
  tweetId: string,
  content: string,
  inputText: string,
  chain: string,
  attempt: number
): Promise<DuplicateCheckResult> {

  // 1. Check instance lock (prevents multiple bots)
  if (!acquireLock()) {
    return {
      canProceed: false,
      reason: 'Another bot instance is already running',
      severity: 'block'
    };
  }

  // 2. Check if tweet was already processed
  if (tweetTracker.isProcessed(tweetId)) {
    return {
      canProceed: false,
      reason: `Tweet ${tweetId} was already processed`,
      severity: 'block'
    };
  }

  // 3. Check if tweet is already queued
  if (tweetQueue.isQueued(tweetId)) {
    return {
      canProceed: false,
      reason: `Tweet ${tweetId} is already in posting queue`,
      severity: 'block'
    };
  }

  // 4. Check post rate limits
  if (!postTracker.canPost()) {
    return {
      canProceed: false,
      reason: `Post rate limit reached (${postTracker.getPostCount24h()}/17 posts in 24h)`,
      severity: 'block'
    };
  }

  // 4. Check content-based duplicates (semantic similarity) - use sync version for performance
  if (isContentDuplicateSync(content)) {
    return {
      canProceed: false,
      reason: 'Content is semantically similar to previously posted content',
      severity: 'block'
    };
  }

  // 6. Check translation stability (detects repetitive results)
  const stability = checkTranslationStability(tweetId, inputText, content, chain, attempt);
  if (!stability.isStable) {
    logger.warn(`Translation stability issues detected: ${stability.issues.join(', ')}`);

    // Don't block, but warn if there are multiple issues
    if (stability.issues.length > 2) {
      return {
        canProceed: false,
        reason: `Translation stability issues: ${stability.issues.join(', ')}`,
        severity: 'block'
      };
    }
  }

  // 7. Check for minimum post interval
  const lastPostTime = getLastPostTime();
  const timeSinceLastPost = Date.now() - lastPostTime;
  const minInterval = 15 * 60 * 1000; // 15 minutes

  if (lastPostTime > 0 && timeSinceLastPost < minInterval) {
    const waitMinutes = Math.ceil((minInterval - timeSinceLastPost) / (60 * 1000));
    return {
      canProceed: false,
      reason: `Minimum post interval not met. Wait ${waitMinutes} more minutes`,
      severity: 'block'
    };
  }

  return {
    canProceed: true,
    reason: 'All duplicate checks passed',
    severity: 'info'
  };
}

/**
 * Record a successful post and update all tracking systems
 */
export function recordSuccessfulPost(tweetId: string, content: string) {
  try {
    // Mark tweet as processed
    tweetTracker.markProcessed(tweetId);

    // Record the post
    postTracker.recordPost();

    // Log posted content for duplicate detection
    logPostedContent(tweetId, content);

    // Update last post time
    updateLastPostTime();

    logger.info(`Successfully recorded post for tweet ${tweetId}`);

  } catch (error) {
    logger.error(`Failed to record successful post: ${error}`);
  }
}

/**
 * Clean up old tracking data to prevent storage bloat
 */
export function cleanupTrackingData() {
  try {
    // Prune tweet tracker
    tweetTracker.prune(90, 50000);

    // Prune posted outputs
    prunePostedOutputs(1000);

    // Prune stability log
    pruneStabilityLog(1000);

    logger.info('Completed cleanup of tracking data');

  } catch (error) {
    logger.error(`Failed to cleanup tracking data: ${error}`);
  }
}

/**
 * Get comprehensive duplicate prevention status
 */
export function getDuplicatePreventionStatus() {
  return {
    instanceLocked: acquireLock(),
    postCount24h: postTracker.getPostCount24h(),
    postLimit: 17,
    remainingPosts: postTracker.getRemainingPosts(),
    queuedTweets: tweetQueue.size(),
    processedTweets: tweetTracker ? 'tracked' : 'not available',
    lastCleanup: new Date().toISOString() // Could be enhanced to track actual cleanup times
  };
}

// Helper functions for post timing
let lastPostTime = 0;

function getLastPostTime(): number {
  return lastPostTime;
}

function updateLastPostTime() {
  lastPostTime = Date.now();
}

/**
 * Initialize duplicate prevention system
 */
export function initializeDuplicatePrevention() {
  logger.info('Initializing comprehensive duplicate prevention system...');

  // Set up periodic cleanup
  setInterval(cleanupTrackingData, 24 * 60 * 60 * 1000); // Daily cleanup

  // Log initial status
  const status = getDuplicatePreventionStatus();
  logger.info('Duplicate prevention status:', status);

  logger.info('Duplicate prevention system initialized');
}