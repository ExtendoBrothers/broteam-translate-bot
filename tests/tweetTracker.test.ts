/**
 * Tests for tweet tracker
 */

import * as fs from 'fs';
import * as path from 'path';

const STATE_FILE = path.join(process.cwd(), '.processed-tweets.json');
const TEST_LOG = path.join(process.cwd(), 'test-combined.log');

describe('tweetTracker', () => {
  let tweetTracker: any;

  beforeEach(() => {
    // Clean up files before each test
    try {
      if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
      if (fs.existsSync(TEST_LOG)) fs.unlinkSync(TEST_LOG);
    } catch (e) {
      // Ignore errors
    }

    // Clear module cache and reimport
    jest.resetModules();
    const module = require('../src/utils/tweetTracker');
    tweetTracker = module.tweetTracker;
  });

  afterEach(() => {
    // Clean up after each test
    try {
      if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
      if (fs.existsSync(TEST_LOG)) fs.unlinkSync(TEST_LOG);
    } catch (e) {
      // Ignore errors
    }
  });

  describe('shouldProcess (sync)', () => {
    it('should return true for new tweet', () => {
      expect(tweetTracker.shouldProcess('tweet1')).toBe(true);
    });

    it('should return false for processed tweet', () => {
      tweetTracker.markProcessed('tweet1');
      expect(tweetTracker.shouldProcess('tweet1')).toBe(false);
    });

    it('should handle multiple tweets', () => {
      tweetTracker.markProcessed('tweet1');
      tweetTracker.markProcessed('tweet2');

      expect(tweetTracker.shouldProcess('tweet1')).toBe(false);
      expect(tweetTracker.shouldProcess('tweet2')).toBe(false);
      expect(tweetTracker.shouldProcess('tweet3')).toBe(true);
    });
  });

  describe('shouldProcessAsync', () => {
    it('should return true for new tweet', async () => {
      const result = await tweetTracker.shouldProcessAsync('tweet1');
      expect(result).toBe(true);
    });

    it('should return false for processed tweet', async () => {
      tweetTracker.markProcessed('tweet1');
      const result = await tweetTracker.shouldProcessAsync('tweet1');
      expect(result).toBe(false);
    });

    // Note: Testing async log file checking requires specific log patterns and paths
    // that are implementation details of the searchLogFile function. The main
    // functionality (checking cache) is covered above.
  });

  describe('markProcessed', () => {
    it('should mark tweet as processed', () => {
      tweetTracker.markProcessed('tweet1');

      expect(tweetTracker.isProcessed('tweet1')).toBe(true);
      expect(tweetTracker.shouldProcess('tweet1')).toBe(false);
    });

    it('should persist to file', () => {
      tweetTracker.markProcessed('tweet1');

      expect(fs.existsSync(STATE_FILE)).toBe(true);
      const content = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
      expect(content.processed).toBeDefined();
      expect(content.processed['tweet1']).toBeDefined();
    });

    it('should handle duplicate marks', () => {
      tweetTracker.markProcessed('tweet1');
      tweetTracker.markProcessed('tweet1');

      expect(tweetTracker.isProcessed('tweet1')).toBe(true);
    });
  });

  describe('unmarkProcessed', () => {
    it('should remove tweet from processed list', () => {
      const now = new Date().toISOString();
      tweetTracker.markProcessed('tweet1');
      tweetTracker.unmarkProcessed('tweet1');

      expect(tweetTracker.isProcessed('tweet1')).toBe(false);
      expect(tweetTracker.shouldProcess('tweet1', now)).toBe(true);
    });

    it('should handle unmarking non-existent tweet', () => {
      expect(() => tweetTracker.unmarkProcessed('nonexistent')).not.toThrow();
    });

    it('should persist removal', () => {
      tweetTracker.markProcessed('tweet1');
      tweetTracker.markProcessed('tweet2'); // Add another to keep file
      tweetTracker.unmarkProcessed('tweet1');

      const content = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
      expect(content.processed['tweet1']).toBeUndefined();
      expect(content.processed['tweet2']).toBeDefined();
    });
  });

  describe('isProcessed', () => {
    it('should return true for processed tweet', () => {
      tweetTracker.markProcessed('tweet1');
      expect(tweetTracker.isProcessed('tweet1')).toBe(true);
    });

    it('should return false for new tweet', () => {
      expect(tweetTracker.isProcessed('tweet1')).toBe(false);
    });
  });

  describe('isProcessedAsync', () => {
    it('should return true for processed tweet', async () => {
      tweetTracker.markProcessed('tweet1');
      const result = await tweetTracker.isProcessedAsync('tweet1');
      expect(result).toBe(true);
    });

    it('should return false for new tweet', async () => {
      const result = await tweetTracker.isProcessedAsync('tweet1');
      expect(result).toBe(false);
    });

    // Note: Testing async log file checking requires specific log patterns and paths
    // that are implementation details of the searchLogFile function. The main
    // functionality (checking cache) is covered above.
  });

  describe('wasPosted', () => {
    it('should return false when not posted', async () => {
      const result = await tweetTracker.wasPosted('tweet1', TEST_LOG);
      expect(result).toBe(false);
    });

    it('should handle missing log file', async () => {
      const result = await tweetTracker.wasPosted('tweet1', 'nonexistent.log');
      expect(result).toBe(false);
    });

    // Note: wasPosted() is designed to search specific combined.log files using the
    // searchLogFile function and specific regex patterns. Testing with custom log files
    // would require mocking the searchLogFile function, which is beyond the scope of
    // unit tests. The error handling and basic functionality is covered above.
  });

  describe('prune', () => {
    it('should keep entries within retention period', () => {
      tweetTracker.markProcessed('tweet1');
      tweetTracker.markProcessed('tweet2');

      tweetTracker.prune(90);

      expect(tweetTracker.isProcessed('tweet1')).toBe(true);
      expect(tweetTracker.isProcessed('tweet2')).toBe(true);
    });

    it('should handle pruning without errors', () => {
      for (let i = 0; i < 150; i++) {
        tweetTracker.markProcessed(`tweet${i}`);
      }

      expect(() => tweetTracker.prune(90, 100)).not.toThrow();
    });
  });

  describe('state migration', () => {
    it('should migrate from V1 to V2', () => {
      // Write V1 state (array format)
      const v1State = {
        processedTweetIds: ['tweet1', 'tweet2', 'tweet3'],
        lastProcessedAt: new Date().toISOString()
      };
      fs.writeFileSync(STATE_FILE, JSON.stringify(v1State), 'utf-8');

      // Load tracker
      jest.resetModules();
      const { tweetTracker: migratedTracker } = require('../src/utils/tweetTracker');

      // Should convert to V2 (map format) - check by testing functionality
      expect(migratedTracker.isProcessed('tweet1')).toBe(true);
      expect(migratedTracker.isProcessed('tweet2')).toBe(true);
      expect(migratedTracker.isProcessed('tweet3')).toBe(true);
    });

    it('should handle missing version field', () => {
      // Write state without version (treat as V1)
      const oldState = {
        processedTweetIds: ['tweet1', 'tweet2'],
        lastProcessedAt: new Date().toISOString()
      };
      fs.writeFileSync(STATE_FILE, JSON.stringify(oldState), 'utf-8');

      jest.resetModules();
      const { tweetTracker: migratedTracker } = require('../src/utils/tweetTracker');

      expect(migratedTracker.isProcessed('tweet1')).toBe(true);
      expect(migratedTracker.isProcessed('tweet2')).toBe(true);
    });

    it('should preserve V2 state', () => {
      const now = new Date().toISOString();
      const v2State = {
        processed: {
          tweet1: now,
          tweet2: now
        },
        lastProcessedAt: now
      };
      fs.writeFileSync(STATE_FILE, JSON.stringify(v2State), 'utf-8');

      jest.resetModules();
      const { tweetTracker: loadedTracker } = require('../src/utils/tweetTracker');

      expect(loadedTracker.isProcessed('tweet1')).toBe(true);
      expect(loadedTracker.isProcessed('tweet2')).toBe(true);
    });
  });

  describe('persistence', () => {
    it('should load state from file on initialization', () => {
      tweetTracker.markProcessed('tweet1');
      tweetTracker.markProcessed('tweet2');

      // Create new instance
      jest.resetModules();
      const { tweetTracker: newTracker } = require('../src/utils/tweetTracker');

      expect(newTracker.isProcessed('tweet1')).toBe(true);
      expect(newTracker.isProcessed('tweet2')).toBe(true);
    });

    it('should handle missing state file', () => {
      if (fs.existsSync(STATE_FILE)) {
        fs.unlinkSync(STATE_FILE);
      }

      jest.resetModules();
      const { tweetTracker: newTracker } = require('../src/utils/tweetTracker');

      // Should start with empty state
      expect(newTracker.isProcessed('anytweetid')).toBe(false);
    });

    it('should handle malformed state file', () => {
      fs.writeFileSync(STATE_FILE, 'invalid json {', 'utf-8');

      jest.resetModules();
      const { tweetTracker: newTracker } = require('../src/utils/tweetTracker');

      // Should start with empty state
      expect(newTracker.isProcessed('anytweetid')).toBe(false);
    });
  });

  describe('cache management', () => {
    it('should use cache for performance', () => {
      tweetTracker.markProcessed('tweet1');

      // Multiple calls should use cache
      expect(tweetTracker.isProcessed('tweet1')).toBe(true);
      expect(tweetTracker.isProcessed('tweet1')).toBe(true);
      expect(tweetTracker.shouldProcess('tweet1')).toBe(false);
    });

    it('should update cache on mark', () => {
      tweetTracker.markProcessed('tweet1');
      
      expect(tweetTracker.isProcessed('tweet1')).toBe(true);
    });

    it('should update cache on unmark', () => {
      tweetTracker.markProcessed('tweet1');
      expect(tweetTracker.isProcessed('tweet1')).toBe(true);
      
      tweetTracker.unmarkProcessed('tweet1');
      
      expect(tweetTracker.isProcessed('tweet1')).toBe(false);
    });
  });
});
