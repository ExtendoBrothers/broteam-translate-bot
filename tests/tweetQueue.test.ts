/**
 * Tests for tweet queue
 */

import * as fs from 'fs';
import * as path from 'path';
import { QueuedTweet } from '../src/utils/tweetQueue';

// Mock tweetTracker before importing tweetQueue
jest.mock('../src/utils/tweetTracker', () => ({
  tweetTracker: {
    isProcessed: jest.fn(() => false)
  }
}));

const QUEUE_FILE = path.join(process.cwd(), '.tweet-queue.json');

describe('tweetQueue', () => {
  let tweetQueue: any;

  beforeEach(() => {
    // Clean up queue file before each test
    try {
      if (fs.existsSync(QUEUE_FILE)) {
        fs.unlinkSync(QUEUE_FILE);
      }
    } catch (e) {
      // Ignore errors
    }

    // Clear module cache and reimport
    jest.resetModules();
    const module = require('../src/utils/tweetQueue');
    tweetQueue = module.tweetQueue;
    tweetQueue.clear();
  });

  afterEach(() => {
    // Clean up after each test
    try {
      if (fs.existsSync(QUEUE_FILE)) {
        fs.unlinkSync(QUEUE_FILE);
      }
    } catch (e) {
      // Ignore errors
    }
  });

  describe('enqueue', () => {
    it('should add tweet to queue', async () => {
      await tweetQueue.enqueue('tweet1', 'Translation 1');

      expect(tweetQueue.size()).toBe(1);
      const queued = tweetQueue.peek();
      expect(queued).not.toBeNull();
      expect(queued?.sourceTweetId).toBe('tweet1');
      expect(queued?.finalTranslation).toBe('Translation 1');
    });

    it('should set queuedAt timestamp', async () => {
      const beforeTime = Date.now();
      await tweetQueue.enqueue('tweet1', 'Translation 1');
      const afterTime = Date.now();

      const queued = tweetQueue.peek();
      const timestamp = new Date(queued?.queuedAt).getTime();
      
      expect(timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(timestamp).toBeLessThanOrEqual(afterTime);
    });

    it('should initialize attemptCount to 0', async () => {
      await tweetQueue.enqueue('tweet1', 'Translation 1');

      const queued = tweetQueue.peek();
      expect(queued?.attemptCount).toBe(0);
    });

    it('should not add duplicate tweets', async () => {
      await tweetQueue.enqueue('tweet1', 'Translation 1');
      await tweetQueue.enqueue('tweet1', 'Translation 1 Again');

      expect(tweetQueue.size()).toBe(1);
    });

    it('should persist to file', async () => {
      await tweetQueue.enqueue('tweet1', 'Translation 1');

      expect(fs.existsSync(QUEUE_FILE)).toBe(true);
      const content = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf-8'));
      expect(content.queue).toHaveLength(1);
      expect(content.queue[0].sourceTweetId).toBe('tweet1');
    });

    it('should not enqueue already processed tweets', async () => {
      const { tweetTracker } = require('../src/utils/tweetTracker');
      tweetTracker.isProcessed.mockReturnValue(true);

      await tweetQueue.enqueue('tweet1', 'Translation 1');

      expect(tweetQueue.size()).toBe(0);
    });

    it('should handle multiple tweets', async () => {
      await tweetQueue.enqueue('tweet1', 'Translation 1');
      await tweetQueue.enqueue('tweet2', 'Translation 2');
      await tweetQueue.enqueue('tweet3', 'Translation 3');

      expect(tweetQueue.size()).toBe(3);
    });
  });

  describe('peek', () => {
    it('should return first tweet without removing it', async () => {
      await tweetQueue.enqueue('tweet1', 'Translation 1');
      await tweetQueue.enqueue('tweet2', 'Translation 2');

      const peeked = tweetQueue.peek();

      expect(peeked?.sourceTweetId).toBe('tweet1');
      expect(tweetQueue.size()).toBe(2);
    });

    it('should return null for empty queue', () => {
      const peeked = tweetQueue.peek();
      expect(peeked).toBeNull();
    });

    it('should return same tweet on multiple peeks', async () => {
      await tweetQueue.enqueue('tweet1', 'Translation 1');

      const peek1 = tweetQueue.peek();
      const peek2 = tweetQueue.peek();

      expect(peek1).toEqual(peek2);
      expect(tweetQueue.size()).toBe(1);
    });
  });

  describe('dequeue', () => {
    it('should remove and return first tweet', async () => {
      await tweetQueue.enqueue('tweet1', 'Translation 1');
      await tweetQueue.enqueue('tweet2', 'Translation 2');

      const dequeued = tweetQueue.dequeue();

      expect(dequeued?.sourceTweetId).toBe('tweet1');
      expect(tweetQueue.size()).toBe(1);
    });

    it('should return null for empty queue', () => {
      const dequeued = tweetQueue.dequeue();
      expect(dequeued).toBeNull();
    });

    it('should update file after dequeue', async () => {
      await tweetQueue.enqueue('tweet1', 'Translation 1');
      await tweetQueue.enqueue('tweet2', 'Translation 2');

      tweetQueue.dequeue();

      const content = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf-8'));
      expect(content.queue).toHaveLength(1);
      expect(content.queue[0].sourceTweetId).toBe('tweet2');
    });

    it('should process queue in FIFO order', async () => {
      await tweetQueue.enqueue('tweet1', 'Translation 1');
      await tweetQueue.enqueue('tweet2', 'Translation 2');
      await tweetQueue.enqueue('tweet3', 'Translation 3');

      expect(tweetQueue.dequeue()?.sourceTweetId).toBe('tweet1');
      expect(tweetQueue.dequeue()?.sourceTweetId).toBe('tweet2');
      expect(tweetQueue.dequeue()?.sourceTweetId).toBe('tweet3');
      expect(tweetQueue.dequeue()).toBeNull();
    });
  });

  describe('incrementAttempt', () => {
    it('should increment attempt count for first tweet', async () => {
      await tweetQueue.enqueue('tweet1', 'Translation 1');

      tweetQueue.incrementAttempt();

      const queued = tweetQueue.peek();
      expect(queued?.attemptCount).toBe(1);
    });

    it('should increment multiple times', async () => {
      await tweetQueue.enqueue('tweet1', 'Translation 1');

      tweetQueue.incrementAttempt();
      tweetQueue.incrementAttempt();
      tweetQueue.incrementAttempt();

      const queued = tweetQueue.peek();
      expect(queued?.attemptCount).toBe(3);
    });

    it('should not fail on empty queue', () => {
      expect(() => tweetQueue.incrementAttempt()).not.toThrow();
    });

    it('should persist attempt count', async () => {
      await tweetQueue.enqueue('tweet1', 'Translation 1');
      tweetQueue.incrementAttempt();

      const content = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf-8'));
      expect(content.queue[0].attemptCount).toBe(1);
    });
  });

  describe('size', () => {
    it('should return 0 for empty queue', () => {
      expect(tweetQueue.size()).toBe(0);
    });

    it('should return correct size', async () => {
      await tweetQueue.enqueue('tweet1', 'Translation 1');
      await tweetQueue.enqueue('tweet2', 'Translation 2');

      expect(tweetQueue.size()).toBe(2);
    });
  });

  describe('isEmpty', () => {
    it('should return true for empty queue', () => {
      expect(tweetQueue.isEmpty()).toBe(true);
    });

    it('should return false for non-empty queue', async () => {
      await tweetQueue.enqueue('tweet1', 'Translation 1');

      expect(tweetQueue.isEmpty()).toBe(false);
    });
  });

  describe('isQueued', () => {
    it('should return true for queued tweet', async () => {
      await tweetQueue.enqueue('tweet1', 'Translation 1');

      expect(tweetQueue.isQueued('tweet1')).toBe(true);
    });

    it('should return false for non-queued tweet', () => {
      expect(tweetQueue.isQueued('tweet999')).toBe(false);
    });

    it('should return false after dequeue', async () => {
      await tweetQueue.enqueue('tweet1', 'Translation 1');
      tweetQueue.dequeue();

      expect(tweetQueue.isQueued('tweet1')).toBe(false);
    });
  });

  describe('removeById', () => {
    it('should remove specific tweet from queue', async () => {
      await tweetQueue.enqueue('tweet1', 'Translation 1');
      await tweetQueue.enqueue('tweet2', 'Translation 2');
      await tweetQueue.enqueue('tweet3', 'Translation 3');

      const removed = tweetQueue.removeById('tweet2');

      expect(removed).toBe(true);
      expect(tweetQueue.size()).toBe(2);
      expect(tweetQueue.isQueued('tweet2')).toBe(false);
    });

    it('should return false for non-existent tweet', () => {
      const removed = tweetQueue.removeById('nonexistent');
      expect(removed).toBe(false);
    });

    it('should persist after removal', async () => {
      await tweetQueue.enqueue('tweet1', 'Translation 1');
      await tweetQueue.enqueue('tweet2', 'Translation 2');

      tweetQueue.removeById('tweet1');

      const content = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf-8'));
      expect(content.queue).toHaveLength(1);
      expect(content.queue[0].sourceTweetId).toBe('tweet2');
    });
  });

  describe('getQueue', () => {
    it('should return copy of queue', async () => {
      await tweetQueue.enqueue('tweet1', 'Translation 1');
      await tweetQueue.enqueue('tweet2', 'Translation 2');

      const queue = tweetQueue.getQueue();

      expect(queue).toHaveLength(2);
      expect(queue[0].sourceTweetId).toBe('tweet1');
      expect(queue[1].sourceTweetId).toBe('tweet2');
    });

    it('should not allow modification of original queue', async () => {
      await tweetQueue.enqueue('tweet1', 'Translation 1');

      const queue = tweetQueue.getQueue();
      queue.push({
        sourceTweetId: 'tweet2',
        finalTranslation: 'Translation 2',
        queuedAt: new Date().toISOString(),
        attemptCount: 0
      });

      expect(tweetQueue.size()).toBe(1);
    });

    it('should return empty array for empty queue', () => {
      const queue = tweetQueue.getQueue();
      expect(queue).toEqual([]);
    });
  });

  describe('clear', () => {
    it('should remove all tweets', async () => {
      await tweetQueue.enqueue('tweet1', 'Translation 1');
      await tweetQueue.enqueue('tweet2', 'Translation 2');

      tweetQueue.clear();

      expect(tweetQueue.size()).toBe(0);
      expect(tweetQueue.isEmpty()).toBe(true);
    });

    it('should persist cleared state', async () => {
      await tweetQueue.enqueue('tweet1', 'Translation 1');
      tweetQueue.clear();

      const content = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf-8'));
      expect(content.queue).toEqual([]);
    });
  });

  describe('persistence', () => {
    it('should load queue from file on initialization', async () => {
      await tweetQueue.enqueue('tweet1', 'Translation 1');
      await tweetQueue.enqueue('tweet2', 'Translation 2');

      // Create new instance
      jest.resetModules();
      const { tweetQueue: newQueue } = require('../src/utils/tweetQueue');

      expect(newQueue.size()).toBe(2);
      expect(newQueue.peek()?.sourceTweetId).toBe('tweet1');
    });

    it('should handle missing queue file', () => {
      // Ensure file doesn't exist
      if (fs.existsSync(QUEUE_FILE)) {
        fs.unlinkSync(QUEUE_FILE);
      }

      jest.resetModules();
      const { tweetQueue: newQueue } = require('../src/utils/tweetQueue');

      expect(newQueue.size()).toBe(0);
    });

    it('should handle malformed queue file', () => {
      fs.writeFileSync(QUEUE_FILE, 'invalid json {', 'utf-8');

      jest.resetModules();
      const { tweetQueue: newQueue } = require('../src/utils/tweetQueue');

      expect(newQueue.size()).toBe(0);
    });
  });
});
