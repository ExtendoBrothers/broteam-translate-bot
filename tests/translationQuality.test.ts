import { describe, expect, it } from '@jest/globals';

import { getMinimumLengthPercent, getMinimumLengthRatio } from '../src/utils/translationQuality';

describe('translationQuality', () => {
  it('uses 33 percent for short tweets', () => {
    const text = 'one two three four five six nine';
    expect(getMinimumLengthRatio(text)).toBeCloseTo(0.33, 2);
    expect(getMinimumLengthPercent(text)).toBe(33);
  });

  it('uses 40 percent once the tweet reaches 10 words', () => {
    const text = 'one two three four five six seven eight nine ten';
    expect(getMinimumLengthRatio(text)).toBeCloseTo(0.4, 2);
    expect(getMinimumLengthPercent(text)).toBe(40);
  });
});