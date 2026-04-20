/// <reference types="jest" />

/**
 * Unit tests for CandidateStore (manual-mode fork)
 */

export {}; // ensure this file is treated as an ES module, not a global script

jest.mock('../src/utils/safeFileOps', () => ({
  atomicWriteJsonSync: jest.fn().mockReturnValue(true),
}));

jest.mock('../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(false),
  readFileSync: jest.fn(),
}));

describe('CandidateStore', () => {
  let candidateStore: any;
  let mockFs: any;
  let mockSafeFileOps: any;

  const mockTweet = {
    id: 'tweet-1',
    text: 'Test tweet text',
    createdAt: new Date('2026-01-01T12:00:00.000Z'),
    user: { id: 'user-1', username: 'testuser', displayName: 'Test User' },
  };

  const mockCandidate = {
    chainIndex: 0,
    chainLabel: 'Chain A',
    languages: ['en', 'ja', 'en'],
    result: 'Translated text',
    humorScore: 0.8,
    heuristicScore: 0.7,
    combinedScore: 0.75,
    isBestCandidate: true,
  };

  beforeEach(() => {
    jest.resetModules();
    // Get fresh mock references after resetModules
    mockFs = require('fs');
    mockFs.existsSync.mockReturnValue(false);
    mockFs.readFileSync.mockReset();
    mockSafeFileOps = require('../src/utils/safeFileOps');
    mockSafeFileOps.atomicWriteJsonSync.mockReturnValue(true);
    const mod = require('../src/server/candidateStore');
    candidateStore = mod.candidateStore;
  });

  // ── add() ────────────────────────────────────────────────────────────────────

  describe('add()', () => {
    it('returns a UUID string', () => {
      const id = candidateStore.add(mockTweet);
      expect(typeof id).toBe('string');
      expect(id).toHaveLength(36);
    });

    it('creates item with status generating and empty candidates', () => {
      const id = candidateStore.add(mockTweet);
      const item = candidateStore.getById(id);
      expect(item.status).toBe('generating');
      expect(item.candidates).toEqual([]);
    });

    it('stores tweet id and text', () => {
      const id = candidateStore.add(mockTweet);
      const item = candidateStore.getById(id);
      expect(item.tweet.id).toBe('tweet-1');
      expect(item.tweet.text).toBe('Test tweet text');
    });

    it('serialises createdAt to ISO string', () => {
      const id = candidateStore.add(mockTweet);
      const item = candidateStore.getById(id);
      expect(typeof item.tweet.createdAt).toBe('string');
      expect(item.tweet.createdAt).toBe('2026-01-01T12:00:00.000Z');
    });

    it('persists to disk via atomicWriteJsonSync', () => {
      candidateStore.add(mockTweet);
      expect(mockSafeFileOps.atomicWriteJsonSync).toHaveBeenCalled();
    });
  });

  // ── setReady() ───────────────────────────────────────────────────────────────

  describe('setReady()', () => {
    it('updates candidates and sets status to ready', () => {
      const id = candidateStore.add(mockTweet);
      candidateStore.setReady(id, [mockCandidate]);
      const item = candidateStore.getById(id);
      expect(item.status).toBe('ready');
      expect(item.candidates).toEqual([mockCandidate]);
    });

    it('is a no-op for unknown id', () => {
      expect(() => candidateStore.setReady('unknown', [mockCandidate])).not.toThrow();
    });
  });

  // ── setError() ───────────────────────────────────────────────────────────────

  describe('setError()', () => {
    it('sets status to ready and records error message', () => {
      const id = candidateStore.add(mockTweet);
      candidateStore.setError(id, 'Translation failed');
      const item = candidateStore.getById(id);
      expect(item.status).toBe('ready'); // still surfaced to user
      expect(item.error).toBe('Translation failed');
    });

    it('is a no-op for unknown id', () => {
      expect(() => candidateStore.setError('unknown', 'err')).not.toThrow();
    });
  });

  // ── markPosted() ─────────────────────────────────────────────────────────────

  describe('markPosted()', () => {
    it('returns a Twitter intent URL for the selected candidate', () => {
      const id = candidateStore.add(mockTweet);
      candidateStore.setReady(id, [mockCandidate]);
      const result = candidateStore.markPosted(id, 0);
      expect(result).not.toBeNull();
      expect(result!.intentUrl).toContain('twitter.com/intent/tweet');
      expect(result!.intentUrl).toContain(encodeURIComponent('Translated text'));
    });

    it('sets status to posted and records candidate index', () => {
      const id = candidateStore.add(mockTweet);
      candidateStore.setReady(id, [mockCandidate]);
      candidateStore.markPosted(id, 0);
      const item = candidateStore.getById(id);
      expect(item.status).toBe('posted');
      expect(item.postedCandidateIndex).toBe(0);
      expect(item.postedAt).toBeDefined();
    });

    it('returns null for an out-of-range candidate index', () => {
      const id = candidateStore.add(mockTweet);
      candidateStore.setReady(id, [mockCandidate]);
      expect(candidateStore.markPosted(id, 99)).toBeNull();
    });

    it('returns null for an unknown id', () => {
      expect(candidateStore.markPosted('unknown', 0)).toBeNull();
    });
  });

  // ── markSkipped() ────────────────────────────────────────────────────────────

  describe('markSkipped()', () => {
    it('returns true and sets status to skipped', () => {
      const id = candidateStore.add(mockTweet);
      expect(candidateStore.markSkipped(id)).toBe(true);
      expect(candidateStore.getById(id).status).toBe('skipped');
    });

    it('removes skipped tweet from old queue source file when present', () => {
      const oldQueue = {
        queue: [
          { sourceTweetId: 'tweet-1', finalTranslation: 'A', queuedAt: '2026-01-01T00:00:00.000Z', attemptCount: 0 },
          { sourceTweetId: 'tweet-2', finalTranslation: 'B', queuedAt: '2026-01-01T00:00:00.000Z', attemptCount: 0 },
        ],
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(oldQueue));

      const id = candidateStore.add(mockTweet);
      expect(candidateStore.markSkipped(id)).toBe(true);

      expect(mockSafeFileOps.atomicWriteJsonSync).toHaveBeenCalledWith(
        expect.stringContaining('.tweet-queue.json'),
        expect.objectContaining({
          queue: [
            expect.objectContaining({ sourceTweetId: 'tweet-2' }),
          ],
        })
      );
    });

    it('returns false for an unknown id', () => {
      expect(candidateStore.markSkipped('unknown')).toBe(false);
    });
  });

  // ── list() ───────────────────────────────────────────────────────────────────

  describe('list()', () => {
    it('returns all items when called without filter', () => {
      candidateStore.add(mockTweet);
      candidateStore.add({ ...mockTweet, id: 'tweet-2' });
      expect(candidateStore.list()).toHaveLength(2);
    });

    it('filters by single status string', () => {
      const id = candidateStore.add(mockTweet);
      candidateStore.setReady(id, [mockCandidate]);
      candidateStore.add({ ...mockTweet, id: 'tweet-2' }); // still generating
      expect(candidateStore.list('ready')).toHaveLength(1);
      expect(candidateStore.list('generating')).toHaveLength(1);
    });

    it('filters by multiple statuses', () => {
      const id = candidateStore.add(mockTweet);
      candidateStore.setReady(id, [mockCandidate]);
      candidateStore.add({ ...mockTweet, id: 'tweet-2' });
      expect(candidateStore.list(['ready', 'generating'])).toHaveLength(2);
    });

    it('returns empty array when no items match filter', () => {
      candidateStore.add(mockTweet);
      expect(candidateStore.list('posted')).toHaveLength(0);
    });
  });

  // ── getById() ────────────────────────────────────────────────────────────────

  describe('getById()', () => {
    it('returns the item for a known id', () => {
      const id = candidateStore.add(mockTweet);
      expect(candidateStore.getById(id)).toBeDefined();
      expect(candidateStore.getById(id).tweet.id).toBe('tweet-1');
    });

    it('returns undefined for an unknown id', () => {
      expect(candidateStore.getById('not-a-real-id')).toBeUndefined();
    });
  });

  // ── _load() — persistence on startup ─────────────────────────────────────────

  describe('persistence (_load)', () => {
    it('loads items from disk when store file exists', () => {
      const storeData = [
        {
          id: 'loaded-id-1',
          tweet: { ...mockTweet, createdAt: '2026-01-01T12:00:00.000Z' },
          candidates: [mockCandidate],
          fetchedAt: '2026-01-01T12:00:00.000Z',
          status: 'ready',
        },
      ];
      jest.resetModules();
      const freshFs = require('fs');
      freshFs.existsSync.mockReturnValue(true);
      freshFs.readFileSync.mockReturnValue(JSON.stringify(storeData));
      const { candidateStore: store } = require('../src/server/candidateStore');
      expect(store.getById('loaded-id-1')).toBeDefined();
      expect(store.getById('loaded-id-1').status).toBe('ready');
    });

    it('handles corrupted store file without throwing', () => {
      jest.resetModules();
      const freshFs = require('fs');
      freshFs.existsSync.mockReturnValue(true);
      freshFs.readFileSync.mockReturnValue('not valid json {{{{');
      expect(() => require('../src/server/candidateStore')).not.toThrow();
    });

    it('skips loading when store file does not exist', () => {
      jest.resetModules();
      const freshFs = require('fs');
      freshFs.existsSync.mockReturnValue(false);
      const { candidateStore: store } = require('../src/server/candidateStore');
      expect(store.list()).toHaveLength(0);
    });
  });

  // ── importOldQueue() ──────────────────────────────────────────────────────────

  describe('importOldQueue()', () => {
    it('returns 0 when old queue file cannot be read', () => {
      mockFs.readFileSync
        .mockReturnValueOnce('') // log file
        .mockImplementationOnce(() => { throw new Error('ENOENT'); }); // old queue
      expect(candidateStore.importOldQueue('/missing-queue.json', '/missing-log.log')).toBe(0);
    });

    it('imports entries from old queue JSON and returns count', () => {
      const oldQueue = {
        queue: [
          { sourceTweetId: 'old-1', finalTranslation: 'Translated!', queuedAt: '2026-01-01T00:00:00.000Z', attemptCount: 0 },
        ],
      };
      mockFs.readFileSync
        .mockReturnValueOnce('') // log file (empty → no log entries)
        .mockReturnValueOnce(JSON.stringify(oldQueue));
      const count = candidateStore.importOldQueue('/old-queue.json', '/log.log');
      expect(count).toBe(1);
    });

    it('skips tweet IDs already present in the store', () => {
      candidateStore.add({ ...mockTweet, id: 'existing-tweet' });
      const oldQueue = {
        queue: [
          { sourceTweetId: 'existing-tweet', finalTranslation: 'dup', queuedAt: '2026-01-01T00:00:00.000Z', attemptCount: 0 },
        ],
      };
      mockFs.readFileSync
        .mockReturnValueOnce('')
        .mockReturnValueOnce(JSON.stringify(oldQueue));
      expect(candidateStore.importOldQueue('/old-queue.json', '/log.log')).toBe(0);
    });

    it('recovers source text and humor score from translation log', () => {
      const logContent = [
        'Timestamp: 2026-01-01T00:00:00.000Z',
        'Tweet ID: log-tweet-1',
        'Input: Original tweet text here',
        'Chosen Chain: en→ja→ru→en',
        'Humor Score: 0.85',
        'Steps:',
        'en: step1',
        'Final Result: Funny translated text',
        '---',
      ].join('\n');
      const oldQueue = {
        queue: [
          { sourceTweetId: 'log-tweet-1', finalTranslation: 'Funny translated text', queuedAt: '2026-01-01T00:00:00.000Z', attemptCount: 0 },
        ],
      };
      mockFs.readFileSync
        .mockReturnValueOnce(logContent)
        .mockReturnValueOnce(JSON.stringify(oldQueue));
      candidateStore.importOldQueue('/old-queue.json', '/log.log');
      const items = candidateStore.list('ready');
      const imported = items.find((i: any) => i.tweet.id === 'log-tweet-1');
      expect(imported).toBeDefined();
      expect(imported.tweet.text).toBe('Original tweet text here');
      expect(imported.candidates[0].humorScore).toBe(0.85);
    });

    it('uses a placeholder source text when log entry is missing', () => {
      const oldQueue = {
        queue: [
          { sourceTweetId: 'mystery-tweet', finalTranslation: 'Something', queuedAt: '2026-01-01T00:00:00.000Z', attemptCount: 0 },
        ],
      };
      mockFs.readFileSync
        .mockReturnValueOnce('') // no log entries
        .mockReturnValueOnce(JSON.stringify(oldQueue));
      candidateStore.importOldQueue('/old-queue.json', '/log.log');
      const items = candidateStore.list('ready');
      const imported = items.find((i: any) => i.tweet.id === 'mystery-tweet');
      expect(imported.tweet.text).toContain('mystery-tweet');
    });

    it('imported items have status ready and isBestCandidate true', () => {
      const oldQueue = {
        queue: [
          { sourceTweetId: 'ready-tweet', finalTranslation: 'Text', queuedAt: '2026-01-01T00:00:00.000Z', attemptCount: 0 },
        ],
      };
      mockFs.readFileSync
        .mockReturnValueOnce('')
        .mockReturnValueOnce(JSON.stringify(oldQueue));
      candidateStore.importOldQueue('/old-queue.json', '/log.log');
      const item = candidateStore.list('ready').find((i: any) => i.tweet.id === 'ready-tweet');
      expect(item.status).toBe('ready');
      expect(item.candidates[0].isBestCandidate).toBe(true);
    });
  });

  // ── rehydrateStuck() ─────────────────────────────────────────────────────────
  describe('rehydrateStuck()', () => {
    it('returns empty array when no generating items exist', () => {
      const id = candidateStore.add(mockTweet);
      candidateStore.setReady(id, [mockCandidate]);
      expect(candidateStore.rehydrateStuck()).toHaveLength(0);
    });

    it('returns generating items with createdAt as Date', () => {
      candidateStore.add(mockTweet); // stays 'generating'
      const stuck = candidateStore.rehydrateStuck();
      expect(stuck).toHaveLength(1);
      expect(stuck[0].tweet.createdAt).toBeInstanceOf(Date);
      expect(stuck[0].tweet.id).toBe('tweet-1');
    });

    it('does not return ready, posted, or skipped items', () => {
      const readyId   = candidateStore.add(mockTweet);
      const skippedId = candidateStore.add({ ...mockTweet, id: 'tweet-skip' });
      candidateStore.setReady(readyId, [mockCandidate]);
      candidateStore.markSkipped(skippedId);
      // Add one genuinely stuck item
      candidateStore.add({ ...mockTweet, id: 'tweet-stuck' });
      const stuck = candidateStore.rehydrateStuck();
      expect(stuck).toHaveLength(1);
      expect(stuck[0].tweet.id).toBe('tweet-stuck');
    });

    it('leaves items as generating so generationQueue can resolve them normally', () => {
      candidateStore.add(mockTweet);
      candidateStore.rehydrateStuck();
      // Status must still be 'generating' — caller re-enqueues, setReady will resolve
      const items = candidateStore.list('generating');
      expect(items).toHaveLength(1);
    });
  });
});
