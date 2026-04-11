/// <reference types="jest" />

/**
 * Unit tests for GenerationQueue (manual-mode fork)
 *
 * The queue ensures only one generateCandidates() call runs at a time so
 * LibreTranslate is never hit concurrently. Jobs are processed FIFO.
 */

export {}; // ensure this file is treated as an ES module, not a global script

jest.mock('../src/workers/candidateGenerator', () => ({
  generateCandidates: jest.fn(),
}));

jest.mock('../src/server/candidateStore', () => ({
  candidateStore: {
    setReady: jest.fn(),
    setError: jest.fn(),
  },
}));

jest.mock('../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Drains all pending setImmediate callbacks and microtasks one "tick" at a time.
const flushPromises = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

const mockTweet = {
  id: 'tweet-1',
  text: 'Test tweet',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  user: { id: 'u1', username: 'user', displayName: 'User' },
};

const mockCandidates = [
  {
    chainIndex: 0,
    chainLabel: 'Chain A',
    languages: ['en', 'ja', 'en'],
    result: 'Result text',
    humorScore: 0.7,
    heuristicScore: 0.6,
    combinedScore: 0.65,
    isBestCandidate: true,
  },
];

describe('GenerationQueue', () => {
  let generationQueue: any;
  let mockGenerateCandidates: jest.Mock;
  let mockCandidateStore: { setReady: jest.Mock; setError: jest.Mock };

  beforeEach(() => {
    jest.resetModules();
    // Re-acquire fresh mock references after resetModules
    mockGenerateCandidates = require('../src/workers/candidateGenerator').generateCandidates;
    mockCandidateStore = require('../src/server/candidateStore').candidateStore;
    generationQueue = require('../src/server/generationQueue').generationQueue;
  });

  // ── depth ────────────────────────────────────────────────────────────────────

  describe('depth', () => {
    it('starts at 0', () => {
      expect(generationQueue.depth).toBe(0);
    });

    it('reflects the number of jobs waiting (not counting the running one)', () => {
      mockGenerateCandidates.mockImplementation(
        // never resolves — keeps the first job running indefinitely
        () => new Promise<typeof mockCandidates>(() => { /* intentionally pending */ })
      );

      generationQueue.enqueue('j1', mockTweet);
      generationQueue.enqueue('j2', mockTweet);
      generationQueue.enqueue('j3', mockTweet);

      // j1 started via setImmediate, j2 + j3 are pending
      expect(generationQueue.depth).toBe(2);
    });

    it('returns to 0 after all jobs complete', async () => {
      mockGenerateCandidates.mockResolvedValue(mockCandidates);
      generationQueue.enqueue('j1', mockTweet);
      generationQueue.enqueue('j2', mockTweet);
      // let both complete
      for (let i = 0; i < 6; i++) await flushPromises();
      expect(generationQueue.depth).toBe(0);
    });
  });

  // ── success path ─────────────────────────────────────────────────────────────

  describe('successful generation', () => {
    it('calls candidateStore.setReady with the candidates', async () => {
      mockGenerateCandidates.mockResolvedValue(mockCandidates);
      generationQueue.enqueue('q-success', mockTweet);
      for (let i = 0; i < 3; i++) await flushPromises();
      expect(mockCandidateStore.setReady).toHaveBeenCalledWith('q-success', mockCandidates);
    });

    it('does not call setError on success', async () => {
      mockGenerateCandidates.mockResolvedValue(mockCandidates);
      generationQueue.enqueue('q-ok', mockTweet);
      for (let i = 0; i < 3; i++) await flushPromises();
      expect(mockCandidateStore.setError).not.toHaveBeenCalled();
    });
  });

  // ── error path ────────────────────────────────────────────────────────────────

  describe('generation failure', () => {
    it('calls candidateStore.setError with the error string', async () => {
      mockGenerateCandidates.mockRejectedValue(new Error('Translation bombed'));
      generationQueue.enqueue('q-fail', mockTweet);
      for (let i = 0; i < 3; i++) await flushPromises();
      expect(mockCandidateStore.setError).toHaveBeenCalledWith(
        'q-fail',
        expect.stringContaining('Translation bombed')
      );
    });

    it('does not call setReady on failure', async () => {
      mockGenerateCandidates.mockRejectedValue(new Error('boom'));
      generationQueue.enqueue('q-err', mockTweet);
      for (let i = 0; i < 3; i++) await flushPromises();
      expect(mockCandidateStore.setReady).not.toHaveBeenCalled();
    });

    it('processes next job after a failure', async () => {
      mockGenerateCandidates
        .mockRejectedValueOnce(new Error('first fails'))
        .mockResolvedValue(mockCandidates);

      generationQueue.enqueue('q-err', mockTweet);
      generationQueue.enqueue('q-ok', mockTweet);
      for (let i = 0; i < 6; i++) await flushPromises();
      expect(mockCandidateStore.setReady).toHaveBeenCalledWith('q-ok', mockCandidates);
    });
  });

  // ── sequential processing ─────────────────────────────────────────────────────

  describe('sequential processing', () => {
    it('never runs two jobs concurrently', async () => {
      let concurrent = 0;
      let maxConcurrent = 0;

      mockGenerateCandidates.mockImplementation(async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await flushPromises(); // simulate async work
        concurrent--;
        return mockCandidates;
      });

      generationQueue.enqueue('j1', mockTweet);
      generationQueue.enqueue('j2', mockTweet);
      generationQueue.enqueue('j3', mockTweet);

      for (let i = 0; i < 15; i++) await flushPromises();

      expect(maxConcurrent).toBe(1);
    });

    it('processes jobs in FIFO order', async () => {
      const order: string[] = [];

      mockGenerateCandidates.mockImplementation(async (tweet: typeof mockTweet) => {
        order.push(tweet.id);
        return mockCandidates;
      });

      generationQueue.enqueue('j1', { ...mockTweet, id: 'a' });
      generationQueue.enqueue('j2', { ...mockTweet, id: 'b' });
      generationQueue.enqueue('j3', { ...mockTweet, id: 'c' });

      for (let i = 0; i < 9; i++) await flushPromises();

      expect(order).toEqual(['a', 'b', 'c']);
    });

    it('second job does not start until first completes', async () => {
      const calls: string[] = [];
      let resolveFirst!: () => void;

      mockGenerateCandidates.mockImplementation(async (tweet: typeof mockTweet) => {
        calls.push(`start:${tweet.id}`);
        if (tweet.id === 'first') {
          await new Promise<void>(r => { resolveFirst = r; });
        }
        calls.push(`end:${tweet.id}`);
        return mockCandidates;
      });

      generationQueue.enqueue('j1', { ...mockTweet, id: 'first' });
      generationQueue.enqueue('j2', { ...mockTweet, id: 'second' });

      // Let the first job start but not finish
      await flushPromises();
      expect(calls).toEqual(['start:first']);

      // Unblock first job, let pipeline drain
      resolveFirst();
      for (let i = 0; i < 6; i++) await flushPromises();

      expect(calls).toEqual(['start:first', 'end:first', 'start:second', 'end:second']);
    });

    it('safely enqueues new jobs while one is running', async () => {
      let resolveRunning!: () => void;
      mockGenerateCandidates
        .mockImplementationOnce(() => new Promise<typeof mockCandidates>(r => {
          resolveRunning = () => r(mockCandidates);
        }))
        .mockResolvedValue(mockCandidates);

      generationQueue.enqueue('j1', mockTweet);
      await flushPromises(); // start j1

      // Enqueue more jobs while j1 is running
      generationQueue.enqueue('j2', mockTweet);
      generationQueue.enqueue('j3', mockTweet);
      expect(generationQueue.depth).toBe(2);

      resolveRunning();
      for (let i = 0; i < 9; i++) await flushPromises();

      // All three should have been processed
      expect(mockCandidateStore.setReady).toHaveBeenCalledTimes(3);
      expect(generationQueue.depth).toBe(0);
    });
  });
});
