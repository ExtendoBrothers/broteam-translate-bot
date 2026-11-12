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

  it('uses the calculated weights to select languages', () => {
    resetStore({ ja: { positives: 50, negatives: 0 }, ru: { positives: 0, negatives: 0 } });
    const spy = jest.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      expect(weightedShuffle(['ru', 'ja'])[0]).toBe('ja');
    } finally {
      spy.mockRestore();
    }
  });

  it('keeps a heavily penalized language in the result', () => {
    resetStore({ ja: { positives: 0, negatives: 45000 } });
    expect(weightedShuffle(['ja', 'ru']).sort()).toEqual(['ja', 'ru']);
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

  it('applies the configured multiplier when recording negatives', () => {
    recordNegatives(['ja'], { multiplier: 2 });
    const written = capturedWrite as Record<string, { positives: number; negatives: number }>;
    expect(written['ja'].negatives).toBe(2);
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
      weight: expect.closeTo(0.1 + 1.8 * 25 / 32, 5),
    });
  });

  it('distinguishes heavily penalized languages using their lifetime ratios', () => {
    resetStore({
      de: { positives: 15, negatives: 45582 },
      ru: { positives: 180, negatives: 45328 },
      el: { positives: 650, negatives: 2933 },
    });
    const snap = getWeightsSnapshot();
    expect(snap.de.weight).toBeGreaterThan(0.1);
    expect(snap.ru.weight).toBeGreaterThan(snap.de.weight);
    expect(snap.el.weight).toBeGreaterThan(snap.ru.weight);
  });

  it('stays stable as the same signal ratio accumulates', () => {
    resetStore({
      earlier: { positives: 2500, negatives: 25000 },
      later: { positives: 25000, negatives: 250000 },
    });
    const snap = getWeightsSnapshot();
    expect(snap.earlier.weight).toBeCloseTo(snap.later.weight, 3);
    expect(snap.later.weight).toBeGreaterThan(0.6);
    expect(snap.later.weight).toBeLessThan(0.7);
  });

  it('responds to new signals while retaining lifetime counts', () => {
    resetStore({ ja: { positives: 5, negatives: 20 } });
    const initial = getWeightsSnapshot().ja.weight;
    recordPositives(['ja']);
    const afterPositive = getWeightsSnapshot().ja.weight;
    recordNegatives(['ja']);
    const afterNegative = getWeightsSnapshot().ja;
    expect(afterPositive).toBeGreaterThan(initial);
    expect(afterNegative.weight).toBeLessThan(afterPositive);
    expect(afterNegative.positives).toBe(6);
    expect(afterNegative.negatives).toBe(21);
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
    expect(w['ja']).toBeCloseTo(1.6, 5);
    expect(w['ru']).toBeCloseTo(0.55, 5);
  });

  it('only returns entries for the requested languages, not all stored ones', () => {
    resetStore({ ja: { positives: 1, negatives: 0 }, de: { positives: 1, negatives: 0 } });
    const w = getWeightsForLangs(['ja']);
    expect(Object.keys(w)).toEqual(['ja']);
  });

  it('keeps heavily penalized weights above 0.1', () => {
    resetStore({ bad: { positives: 0, negatives: 45000 } });
    const w = getWeightsForLangs(['bad']);
    expect(w['bad']).toBeGreaterThan(0.1);
  });
});
