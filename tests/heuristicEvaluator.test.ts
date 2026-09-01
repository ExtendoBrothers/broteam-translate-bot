/**
 * Tests for src/utils/heuristicEvaluator.ts
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';

jest.mock('../src/utils/safeFileOps', () => ({
  atomicWriteJsonSync: jest.fn(() => true),
}));

jest.mock('fs', () => ({
  ...jest.requireActual<typeof import('fs')>('fs'),
  existsSync: jest.fn(() => false),
  readFileSync: jest.fn(),
}));

jest.mock('../src/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

let getWeights: typeof import('../src/utils/heuristicEvaluator').getWeights;
let updateWeightsFromFeedback: typeof import('../src/utils/heuristicEvaluator').updateWeightsFromFeedback;

describe('updateWeightsFromFeedback()', () => {
  beforeEach(() => {
    jest.resetModules();
    ({ getWeights, updateWeightsFromFeedback } = require('../src/utils/heuristicEvaluator'));
  });

  it('reduces the oldschoolChain loss by one third when oldschool loses', () => {
    updateWeightsFromFeedback(
      { oldschoolChain: { fired: false, contribution: 0 } },
      { oldschoolChain: { fired: true, contribution: 0.05 } },
    );

    const weights = getWeights();
    expect(weights.oldschoolChain.weight).toBeCloseTo(0.05 - (0.002 / 3), 6);
    expect(weights.oldschoolChain.wins).toBe(0);
    expect(weights.oldschoolChain.losses).toBe(1);
  });

  it('still applies the full learning rate to other losing rules', () => {
    updateWeightsFromFeedback(
      { sentenceStructure: { fired: true, contribution: 0.04 } },
      {
        sentenceStructure: { fired: false, contribution: 0 },
        tooShort: { fired: true, contribution: -0.05 },
      },
    );

    const weights = getWeights();
    expect(weights.sentenceStructure.weight).toBeCloseTo(0.04 + 0.002, 6);
    expect(weights.tooShort.weight).toBeCloseTo(-0.05 - 0.002, 6);
  });
});