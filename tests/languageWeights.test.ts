/**
 * Tests for src/utils/languageWeights.ts
 * Covers weightedShuffle(), recordPositives(), recordNegatives(), and getWeightsSnapshot().
 * safeFileOps is mocked so no actual disk I/O occurs.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// ── Mock safeFileOps before importing the module under test ──────────────────
const mockReadData: Record<string, unknown> = {};
let capturedWrite: unknown = null;

jest.mock('../src/utils/safeFileOps', () => ({
  safeReadJsonSync: jest.fn((_filePath: unknown, defaultVal: unknown) => {
    // Return a deep copy so the module can't mutate mockReadData directly
    return Object.keys(mockReadData).length
      ? JSON.parse(JSON.stringify(mockReadData))
      : defaultVal;
  }),
  atomicWriteJsonSync: jest.fn((_filePath: unknown, data: unknown) => {
    capturedWrite = JSON.parse(JSON.stringify(data));
    // Reflect the write back into mockReadData so subsequent reads see it
    Object.keys(mockReadData).forEach(k => delete mockReadData[k]);
    Object.assign(mockReadData, data as object);
    return true;
  }),
}));

// fs.existsSync / mkdirSync are called by saveWeights – stub them out
jest.mock('fs', () => ({
  ...jest.requireActual<typeof import('fs')>('fs'),
  existsSync: jest.fn(() => true),
  mkdirSync: jest.fn(),
}));

import {
  weightedShuffle,
  recordPositives,
  recordNegatives,
  getWeightsSnapshot,
  getWeightsForLangs,
  _resetCacheForTesting,
} from '../src/utils/languageWeights';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function resetStore(data: Record<string, { positives: number; negatives: number }> = {}): void {
  Object.keys(mockReadData).forEach(k => delete mockReadData[k]);
  Object.assign(mockReadData, data);
  capturedWrite = null;
  // Clear the module-level in-memory cache so each test starts from mockReadData
  _resetCacheForTesting();
}

// ─────────────────────────────────────────────────────────────────────────────
// weightedShuffle
// ─────────────────────────────────────────────────────────────────────────────

describe('weightedShuffle()', () => {
  beforeEach(() => resetStore());

  it('returns an empty array for empty input', () => {
    expect(weightedShuffle([])).toEqual([]);
  });

  it('returns a single-element array unchanged', () => {
    expect(weightedShuffle(['ja'])).toEqual(['ja']);
  });

  it('returns all input languages exactly once', () => {
    const langs = ['ja', 'ru', 'es', 'de', 'fr'];
    const result = weightedShuffle(langs);
    expect(result).toHaveLength(langs.length);
    expect([...result].sort()).toEqual([...langs].sort());
  });

  it('uniform weights (no stored data) always produce a valid permutation', () => {
    resetStore();
    const langs = ['ja', 'ru', 'es'];
    for (let trial = 0; trial < 20; trial++) {
      const result = weightedShuffle(langs);
      expect(result).toHaveLength(langs.length);
      expect([...result].sort()).toEqual([...langs].sort());
    }
  });

  it('with deterministic Math.random=0, always picks the first pool entry first', () => {
    const spy = jest.spyOn(Math, 'random').mockReturnValue(0);
    try {
      resetStore();
      const langs = ['ja', 'ru', 'es'];
      const result = weightedShuffle(langs);
      // rand=0 → cumulative of first element (≥0) is hit immediately every round
      expect(result[0]).toBe('ja');
    } finally {
      spy.mockRestore();
    }
  });

  it('high-weight language appears first more often under biased Math.random', () => {
    // Give 'ja' many positives so its weight >> others
    resetStore({ ja: { positives: 50, negatives: 0 }, ru: { positives: 0, negatives: 0 } });

    let jaFirst = 0;
    const trials = 200;
    for (let i = 0; i < trials; i++) {
      const result = weightedShuffle(['ja', 'ru']);
      if (result[0] === 'ja') jaFirst++;
    }
    // ja weight = 1 + 50*0.04 = 3.0, ru weight = 1.0, so ja should lead ~75% of the time
    // Allow generous margin to avoid flakiness
    expect(jaFirst / trials).toBeGreaterThan(0.6);
  });

  it('low-weight language still appears in the result (minimum weight 0.1)', () => {
    // 90 net negatives → weight = max(0.1, 1.0 - 0.9) = 0.1
    resetStore({ ja: { positives: 0, negatives: 90 } });
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      weightedShuffle(['ja', 'ru']).forEach(l => seen.add(l));
    }
    expect(seen.has('ja')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// recordPositives
// ─────────────────────────────────────────────────────────────────────────────

describe('recordPositives()', () => {
  beforeEach(() => resetStore());

  it('increments positive counts for each non-en language', () => {
    recordPositives(['ja', 'ru']);
    const written = capturedWrite as Record<string, { positives: number; negatives: number }>;
    expect(written['ja'].positives).toBe(1);
    expect(written['ru'].positives).toBe(1);
  });

  it('skips "en" entirely', () => {
    recordPositives(['en', 'ja']);
    const written = capturedWrite as Record<string, { positives: number; negatives: number }>;
    expect(written['en']).toBeUndefined();
    expect(written['ja'].positives).toBe(1);
  });

  it('accumulates across multiple calls', () => {
    recordPositives(['ja']);
    recordPositives(['ja']);
    const written = capturedWrite as Record<string, { positives: number; negatives: number }>;
    expect(written['ja'].positives).toBe(2);
    expect(written['ja'].negatives).toBe(0);
  });

  it('does nothing for an empty array', () => {
    recordPositives([]);
    expect(capturedWrite).toBeNull();
  });

  it('initialises negatives to 0 for a new language', () => {
    recordPositives(['de']);
    const written = capturedWrite as Record<string, { positives: number; negatives: number }>;
    expect(written['de'].negatives).toBe(0);
  });

  it('persists to disk (atomicWriteJsonSync is called)', () => {
    const { atomicWriteJsonSync } = jest.requireMock('../src/utils/safeFileOps') as {
      atomicWriteJsonSync: jest.Mock;
    };
    const callsBefore = atomicWriteJsonSync.mock.calls.length;
    recordPositives(['es']);
    expect(atomicWriteJsonSync.mock.calls.length).toBe(callsBefore + 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// recordNegatives
// ─────────────────────────────────────────────────────────────────────────────

describe('recordNegatives()', () => {
  beforeEach(() => resetStore());

  it('increments negative counts for each non-en language', () => {
    recordNegatives(['ja', 'ru']);
    const written = capturedWrite as Record<string, { positives: number; negatives: number }>;
    expect(written['ja'].negatives).toBe(1);
    expect(written['ru'].negatives).toBe(1);
  });

  it('skips "en"', () => {
    recordNegatives(['en', 'ru']);
    const written = capturedWrite as Record<string, { positives: number; negatives: number }>;
    expect(written['en']).toBeUndefined();
    expect(written['ru'].negatives).toBe(1);
  });

  it('accumulates across multiple calls', () => {
    recordNegatives(['fr']);
    recordNegatives(['fr']);
    recordNegatives(['fr']);
    const written = capturedWrite as Record<string, { positives: number; negatives: number }>;
    expect(written['fr'].negatives).toBe(3);
    expect(written['fr'].positives).toBe(0);
  });

  it('does nothing for an empty array', () => {
    recordNegatives([]);
    expect(capturedWrite).toBeNull();
  });

  it('persists to disk (atomicWriteJsonSync is called)', () => {
    const { atomicWriteJsonSync } = jest.requireMock('../src/utils/safeFileOps') as {
      atomicWriteJsonSync: jest.Mock;
    };
    const callsBefore = atomicWriteJsonSync.mock.calls.length;
    recordNegatives(['de']);
    expect(atomicWriteJsonSync.mock.calls.length).toBe(callsBefore + 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getWeightsSnapshot
// ─────────────────────────────────────────────────────────────────────────────

describe('getWeightsSnapshot()', () => {
  beforeEach(() => resetStore());

  it('returns an empty object when no weights are stored', () => {
    resetStore({});
    expect(getWeightsSnapshot()).toEqual({});
  });

  it('includes positives, negatives and computed weight for each language', () => {
    resetStore({ ja: { positives: 5, negatives: 2 } });
    const snap = getWeightsSnapshot();
    expect(snap['ja']).toEqual({
      positives: 5,
      negatives: 2,
      weight: expect.closeTo(1.0 + 5 * 0.04 - 2 * 0.01, 5),
    });
  });

  it('weight formula: max(0.1, 1.0 + pos*0.04 - neg*0.01)', () => {
    resetStore({ bad: { positives: 0, negatives: 90 } });
    const snap = getWeightsSnapshot();
    expect(snap['bad'].weight).toBeCloseTo(0.1, 5);
  });

  it('weight increases with positives', () => {
    resetStore({ hi: { positives: 10, negatives: 0 } });
    const snap = getWeightsSnapshot();
    expect(snap['hi'].weight).toBeCloseTo(1.4, 5);
  });

  it('weight decreases with negatives', () => {
    resetStore({ lo: { positives: 0, negatives: 20 } });
    const snap = getWeightsSnapshot();
    expect(snap['lo'].weight).toBeCloseTo(0.8, 5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getWeightsForLangs
// ─────────────────────────────────────────────────────────────────────────────

describe('getWeightsForLangs()', () => {
  beforeEach(() => resetStore());

  it('returns an empty object for an empty language list', () => {
    expect(getWeightsForLangs([])).toEqual({});
  });

  it('omits "en" from the result', () => {
    resetStore({ ja: { positives: 2, negatives: 0 } });
    const w = getWeightsForLangs(['en', 'ja']);
    expect(w['en']).toBeUndefined();
    expect(w['ja']).toBeDefined();
  });

  it('returns 1.0 for a language with no stored data', () => {
    resetStore();
    const w = getWeightsForLangs(['de']);
    expect(w['de']).toBeCloseTo(1.0, 5);
  });

  it('returns computed weights for stored languages', () => {
    resetStore({ ja: { positives: 5, negatives: 0 }, ru: { positives: 0, negatives: 10 } });
    const w = getWeightsForLangs(['ja', 'ru']);
    expect(w['ja']).toBeCloseTo(1.2, 5);  // 1.0 + 5*0.04
    expect(w['ru']).toBeCloseTo(0.9, 5);  // 1.0 - 10*0.01
  });

  it('only returns entries for the requested languages, not all stored ones', () => {
    resetStore({ ja: { positives: 1, negatives: 0 }, de: { positives: 1, negatives: 0 } });
    const w = getWeightsForLangs(['ja']);
    expect(Object.keys(w)).toEqual(['ja']);
  });

  it('applies the minimum weight floor of 0.1', () => {
    resetStore({ bad: { positives: 0, negatives: 90 } });
    const w = getWeightsForLangs(['bad']);
    expect(w['bad']).toBeCloseTo(0.1, 5);
  });
});
