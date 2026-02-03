/**
 * Tests for crash scenarios and error handling in the translation bot
 */

import { translateAndPostWorker } from '../src/workers/translateAndPostWorker';
import { translateText } from '../src/translator/googleTranslate';

// Mock all dependencies
jest.mock('../src/twitter/fetchTweets', () => ({
  fetchTweets: jest.fn()
}));

jest.mock('../src/twitter/postTweets', () => ({
  postTweet: jest.fn()
}));

jest.mock('../src/twitter/client', () => ({
  TwitterClient: jest.fn()
}));

jest.mock('../src/translator/googleTranslate', () => ({
  translateText: jest.fn()
}));

jest.mock('../src/config', () => ({
  config: {
    LANGUAGES: ['es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh', 'ar', 'hi', 'nl'],
    OLDSCHOOL_LANGUAGES: ['es', 'fr', 'de', 'it', 'pt']
  }
}));

jest.mock('../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  },
  rotateLogFile: jest.fn()
}));

jest.mock('../src/utils/tweetTracker', () => ({
  tweetTracker: {
    isProcessed: jest.fn(),
    markProcessed: jest.fn(),
    prune: jest.fn()
  }
}));

jest.mock('../src/utils/tweetQueue', () => ({
  tweetQueue: {
    size: jest.fn(),
    dequeue: jest.fn(),
    enqueue: jest.fn(),
    isEmpty: jest.fn(),
    peek: jest.fn(),
    incrementAttempt: jest.fn()
  }
}));

jest.mock('../src/utils/rateLimitTracker', () => ({
  rateLimitTracker: {
    isRateLimited: jest.fn(),
    setCooldown: jest.fn(),
    getSecondsUntilReset: jest.fn()
  }
}));

jest.mock('../src/utils/monthlyUsageTracker', () => ({
  monthlyUsageTracker: {
    canPost: jest.fn(),
    recordPost: jest.fn(),
    getCurrentMonthKey: jest.fn(),
    getFetchCount: jest.fn()
  }
}));

jest.mock('../src/utils/postTracker', () => ({
  postTracker: {
    canPost: jest.fn(),
    recordPost: jest.fn(),
    getPostCount24h: jest.fn(),
    getRemainingPosts: jest.fn(),
    getTimeUntilNextSlot: jest.fn()
  }
}));

jest.mock('../src/utils/humorScorer', () => ({
  scoreHumor: jest.fn()
}));

jest.mock('../src/utils/duplicatePrevention', () => ({
  checkForDuplicates: jest.fn(),
  recordSuccessfulPost: jest.fn(),
  initializeDuplicatePrevention: jest.fn()
}));

jest.mock('../src/utils/spamFilter', () => ({
  isSpammyResult: jest.fn(),
  isSpammyFeedbackEntry: jest.fn()
}));

jest.mock('../src/utils/heuristicEvaluator', () => ({
  evaluateHeuristics: jest.fn()
}));

jest.mock('../src/translator/lexicon', () => ({
  detectLanguageByLexicon: jest.fn()
}));

jest.mock('langdetect', () => ({
  detect: jest.fn()
}));

jest.mock('fs', () => ({
  appendFileSync: jest.fn(),
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn()
}));

jest.mock('path', () => ({
  join: jest.fn(),
  resolve: jest.fn()
}));

import { fetchTweets } from '../src/twitter/fetchTweets';
import { logger } from '../src/utils/logger';

describe('Crash Scenario Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('fetchTweets failure', () => {
    it('should handle fetchTweets throwing an error gracefully', async () => {
      (fetchTweets as jest.Mock).mockRejectedValue(new Error('Network error'));

      const result = await translateAndPostWorker();

      expect(result.didWork).toBe(false);
      expect(result.blockedByCooldown).toBe(false);
      expect(result.blockedByPostLimit).toBe(false);
      expect(logger.error).toHaveBeenCalledWith('Failed to fetch tweets: Error: Network error');
    });

    it('should handle fetchTweets throwing a non-Error object', async () => {
      (fetchTweets as jest.Mock).mockRejectedValue('String error');

      const result = await translateAndPostWorker();

      expect(result.didWork).toBe(false);
      expect(logger.error).toHaveBeenCalledWith('Failed to fetch tweets: String error');
    });
  });

  describe('critical errors', () => {
    it('should handle critical errors in main worker gracefully', async () => {
      // Mock initializeDuplicatePrevention to throw
      const { initializeDuplicatePrevention } = require('../src/utils/duplicatePrevention');
      (initializeDuplicatePrevention as jest.Mock).mockImplementation(() => {
        throw new Error('Init failed');
      });

      const result = await translateAndPostWorker();

      expect(result.didWork).toBe(false);
      expect(result.blockedByCooldown).toBe(false);
      expect(result.blockedByPostLimit).toBe(false);
      expect(logger.error).toHaveBeenCalledWith('Failed to initialize duplicate prevention: Error: Init failed');
    });
  });
});