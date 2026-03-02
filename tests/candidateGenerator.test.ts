/**
 * Unit tests for candidateGenerator (manual-mode fork)
 */

export {}; // ensure this file is treated as an ES module, not a global script

// Disable per-hop delay so tests run at full speed
process.env.TRANSLATION_HOP_DELAY_MS = '0';

jest.mock('langdetect', () => ({
  detect: jest.fn().mockReturnValue([{ lang: 'en', prob: 0.95 }]),
}));

jest.mock('../src/translator/lexicon', () => ({
  detectLanguageByLexicon: jest.fn().mockReturnValue('en'),
  getEnglishMatchPercentage: jest.fn().mockReturnValue(80),
}));

jest.mock('../src/utils/spamFilter', () => ({
  isSpammyResult: jest.fn().mockReturnValue(false),
  isSpammyFeedbackEntry: jest.fn().mockReturnValue(false),
}));

jest.mock('../src/translator/googleTranslate', () => ({
  translateText: jest.fn(),
}));

jest.mock('../src/utils/humorScorer', () => ({
  scoreHumor: jest.fn(),
}));

jest.mock('../src/utils/heuristicEvaluator', () => ({
  evaluateHeuristics: jest.fn(),
}));

jest.mock('../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
  rotateLogFile: jest.fn(),
}));

jest.mock('../src/config', () => ({
  config: {
    LANGUAGES: ['es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh', 'ar', 'hi', 'nl'],
    OLDSCHOOL_LANGUAGES: ['es', 'fr', 'de', 'it', 'pt'],
  },
}));

import { generateCandidates, _resetCircuitBreaker } from '../src/workers/candidateGenerator';
import { translateText } from '../src/translator/googleTranslate';
import { scoreHumor } from '../src/utils/humorScorer';
import { evaluateHeuristics } from '../src/utils/heuristicEvaluator';

const mockTranslateText = translateText as jest.Mock;
const mockScoreHumor = scoreHumor as jest.Mock;
const mockEvaluateHeuristics = evaluateHeuristics as jest.Mock;

const baseTweet = {
  id: 'tweet-1',
  text: 'Hello world, this is a test tweet.',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  user: { id: 'u1', username: 'testuser', displayName: 'Test' },
};

// Chains now retry up to 33× per attempt — allow extra time for worst-case paths
jest.setTimeout(30000);

describe('generateCandidates', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _resetCircuitBreaker(); // prevent circuit state leaking between tests
    // Default: each translate call returns sensible translated text
    mockTranslateText.mockResolvedValue('Translated text');
    mockScoreHumor.mockResolvedValue({ score: 0.5 });
    mockEvaluateHeuristics.mockReturnValue({ score: 2.0 }); // normalised: (2+5)/10 = 0.7
  });

  // ── Output shape ──────────────────────────────────────────────────────────────

  describe('output shape', () => {
    it('returns exactly 4 candidates', async () => {
      const candidates = await generateCandidates(baseTweet);
      expect(candidates).toHaveLength(4);
    });

    it('labels candidates correctly: Random-1, Random-2, Random-3, Oldschool', async () => {
      const candidates = await generateCandidates(baseTweet);
      const labels = candidates.map(c => c.chainLabel);
      expect(labels).toEqual(['Random-1', 'Random-2', 'Random-3', 'Oldschool']);
    });

    it('assigns chainIndex 0–3 in order', async () => {
      const candidates = await generateCandidates(baseTweet);
      expect(candidates.map(c => c.chainIndex)).toEqual([0, 1, 2, 3]);
    });

    it('each candidate has a languages array', async () => {
      const candidates = await generateCandidates(baseTweet);
      for (const c of candidates) {
        expect(Array.isArray(c.languages)).toBe(true);
      }
    });

    it('candidate languages only contain known pivot languages (no "en" mid-chain)', async () => {
      const { config } = require('../src/config');
      const candidates = await generateCandidates(baseTweet);
      for (const c of candidates) {
        for (const lang of c.languages) {
          expect(config.LANGUAGES).toContain(lang);
        }
      }
    });

    it('exactly one candidate has isBestCandidate = true', async () => {
      const candidates = await generateCandidates(baseTweet);
      const best = candidates.filter(c => c.isBestCandidate);
      expect(best).toHaveLength(1);
    });
  });

  // ── Scoring ───────────────────────────────────────────────────────────────────

  describe('scoring', () => {
    it('combinedScore = 0.6 × humorScore + 0.4 × heuristicScore', async () => {
      mockScoreHumor.mockResolvedValue({ score: 0.8 });
      mockEvaluateHeuristics.mockReturnValue({ score: 5.0 }); // normalised: (5+5)/10 = 1.0
      const candidates = await generateCandidates(baseTweet);
      for (const c of candidates) {
        const expected = 0.6 * c.humorScore + 0.4 * c.heuristicScore;
        expect(c.combinedScore).toBeCloseTo(expected, 5);
      }
    });

    it('humorScore is clamped to [0, 1] when scorer returns >1', async () => {
      mockScoreHumor.mockResolvedValue({ score: 5.0 });
      const candidates = await generateCandidates(baseTweet);
      for (const c of candidates) {
        expect(c.humorScore).toBe(1);
      }
    });

    it('humorScore is clamped to [0, 1] when scorer returns negative', async () => {
      mockScoreHumor.mockResolvedValue({ score: -0.5 });
      const candidates = await generateCandidates(baseTweet);
      for (const c of candidates) {
        expect(c.humorScore).toBe(0);
      }
    });

    it('heuristicScore is normalised and clamped to [0, 1]', async () => {
      mockEvaluateHeuristics.mockReturnValue({ score: 100 }); // (100+5)/10=10.5 → clamped to 1
      const candidates = await generateCandidates(baseTweet);
      for (const c of candidates) {
        expect(c.heuristicScore).toBe(1);
      }
    });

    it('heuristicScore normalises large negative penalties to 0', async () => {
      mockEvaluateHeuristics.mockReturnValue({ score: -100 }); // deeply negative → 0
      const candidates = await generateCandidates(baseTweet);
      for (const c of candidates) {
        expect(c.heuristicScore).toBe(0);
      }
    });

    it('humorScore defaults to 0 when scoreHumor throws', async () => {
      mockScoreHumor.mockRejectedValue(new Error('model load failure'));
      const candidates = await generateCandidates(baseTweet);
      for (const c of candidates) {
        expect(c.humorScore).toBe(0);
      }
    });

    it('heuristicScore defaults to 0 when evaluateHeuristics throws', async () => {
      mockEvaluateHeuristics.mockImplementation(() => { throw new Error('oops'); });
      const candidates = await generateCandidates(baseTweet);
      for (const c of candidates) {
        expect(c.heuristicScore).toBe(0);
      }
    });
  });

  // ── Best candidate selection ───────────────────────────────────────────────────

  describe('best candidate selection', () => {
    it('flags the candidate with the highest combinedScore', async () => {
      // Give each chain a unique humor score so we can identify the winner
      mockScoreHumor
        .mockResolvedValueOnce({ score: 0.3 })  // Random-1
        .mockResolvedValueOnce({ score: 0.6 })  // Random-2
        .mockResolvedValueOnce({ score: 0.9 })  // Random-3  ← winner
        .mockResolvedValueOnce({ score: 0.1 }); // Oldschool

      mockEvaluateHeuristics.mockReturnValue({ score: 0 }); // neutral

      const candidates = await generateCandidates(baseTweet);
      const best = candidates.find(c => c.isBestCandidate)!;
      expect(best.chainLabel).toBe('Random-3');
    });

    it('flags chainIndex 0 when all scores are equal (first wins)', async () => {
      mockScoreHumor.mockResolvedValue({ score: 0.5 });
      mockEvaluateHeuristics.mockReturnValue({ score: 0 });
      const candidates = await generateCandidates(baseTweet);
      const best = candidates.find(c => c.isBestCandidate)!;
      expect(best.chainIndex).toBe(0);
    });

    it('only one candidate has isBestCandidate = true even with different scores', async () => {
      mockScoreHumor
        .mockResolvedValueOnce({ score: 0.1 })
        .mockResolvedValueOnce({ score: 0.95 })
        .mockResolvedValueOnce({ score: 0.4 })
        .mockResolvedValueOnce({ score: 0.7 });
      const candidates = await generateCandidates(baseTweet);
      expect(candidates.filter(c => c.isBestCandidate)).toHaveLength(1);
    });
  });

  // ── Translation chain behaviour ───────────────────────────────────────────────

  describe('translation chain', () => {
    it('calls translateText at least once per chain (4 chains = many calls)', async () => {
      await generateCandidates(baseTweet);
      // 4 chains × (depth pivot steps + 1 back-to-en) — at minimum 4 calls
      expect(mockTranslateText.mock.calls.length).toBeGreaterThanOrEqual(4);
    });

    it('carries forward previous result when a translation step returns empty string', async () => {
      mockTranslateText
        .mockResolvedValueOnce('first step')
        .mockResolvedValueOnce('')          // empty → skip, keep 'first step'
        .mockResolvedValueOnce('back to en') // final english step
        .mockResolvedValue('ok');           // all other chains
      const candidates = await generateCandidates(baseTweet);
      // First chain should not be an empty result
      expect(candidates[0].result).not.toBe('');
    });

    it('skips a failing translation step and continues the chain', async () => {
      mockTranslateText
        .mockRejectedValueOnce(new Error('network error')) // first step throws
        .mockResolvedValue('recovered');                   // rest succeed
      const candidates = await generateCandidates(baseTweet);
      // Should still produce 4 candidates
      expect(candidates).toHaveLength(4);
    });

    it('falls back to original tweet text when all translation steps throw', async () => {
      // runChain catches each step error internally, so result stays as the input text
      mockTranslateText.mockRejectedValue(new Error('libretranslate down'));
      const candidates = await generateCandidates(baseTweet);
      // All candidates should still be present
      expect(candidates).toHaveLength(4);
      // When every step throws, fromLang stays 'en' so no back-to-en attempt is made;
      // the result falls back to the original tweet text
      for (const c of candidates) {
        expect(c.result).toBe(baseTweet.text);
      }
    });

    it('preserves ALL CAPS input: lowercases through chain, uppercases result', async () => {
      const capsText = 'THIS IS SHOUTING AT YOU ALL CAPS';
      // translateText returns lowercase result
      mockTranslateText.mockResolvedValue('lowercase translated');
      const candidates = await generateCandidates({ ...baseTweet, text: capsText });
      // Results should be uppercased back
      for (const c of candidates) {
        if (!c.error) {
          expect(c.result).toBe(c.result.toUpperCase());
        }
      }
    });

    it('does NOT uppercase short or mixed-case input', async () => {
      mockTranslateText.mockResolvedValue('lowercase result');
      const candidates = await generateCandidates({ ...baseTweet, text: 'Normal tweet text.' });
      for (const c of candidates) {
        // result should not be uppercased
        expect(c.result).toBe('lowercase result');
      }
    });
  });

  // ── Oldschool chain ────────────────────────────────────────────────────────────

  describe('Oldschool chain', () => {
    it('uses OLDSCHOOL_LANGUAGES when they are configured', async () => {
      const translateCalls: Array<{ target: string }> = [];
      mockTranslateText.mockImplementation((_text: string, target: string) => {
        translateCalls.push({ target });
        return Promise.resolve('translated');
      });
      await generateCandidates(baseTweet);
      // Oldschool chain is index=3. Its pivot languages should come from OLDSCHOOL_LANGUAGES
      const { config } = require('../src/config');
      // At least some calls should be to oldschool languages ['es','fr','de','it','pt']
      const oldschoolLangs = new Set(config.OLDSCHOOL_LANGUAGES);
      const usedLangs = new Set(translateCalls.map(c => c.target));
      const intersection = [...usedLangs].filter(l => oldschoolLangs.has(l));
      expect(intersection.length).toBeGreaterThan(0);
    });

    it('falls back to random languages for Oldschool when OLDSCHOOL_LANGUAGES is empty', async () => {
      jest.resetModules();
      jest.doMock('../src/config', () => ({
        config: {
          LANGUAGES: ['es', 'fr', 'de', 'it', 'pt', 'ru', 'ja'],
          OLDSCHOOL_LANGUAGES: [],
        },
      }));
      jest.doMock('../src/translator/googleTranslate', () => ({ translateText: jest.fn().mockResolvedValue('ok') }));
      jest.doMock('../src/utils/humorScorer', () => ({ scoreHumor: jest.fn().mockResolvedValue({ score: 0.5 }) }));
      jest.doMock('../src/utils/heuristicEvaluator', () => ({ evaluateHeuristics: jest.fn().mockReturnValue({ score: 0 }) }));
      jest.doMock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }, rotateLogFile: jest.fn() }));
      jest.doMock('langdetect', () => ({ detect: jest.fn().mockReturnValue([{ lang: 'en', prob: 0.95 }]) }));
      jest.doMock('../src/translator/lexicon', () => ({ detectLanguageByLexicon: jest.fn().mockReturnValue('en'), getEnglishMatchPercentage: jest.fn().mockReturnValue(80) }));
      jest.doMock('../src/utils/spamFilter', () => ({ isSpammyResult: jest.fn().mockReturnValue(false) }));
      const { generateCandidates: freshGen } = require('../src/workers/candidateGenerator');
      const candidates = await freshGen(baseTweet);
      // Should still produce 4 candidates
      expect(candidates).toHaveLength(4);
    });
  });
});
