import { isSpammyResult } from '../src/utils/spamFilter';

describe('Spam Filtering', () => {
  describe('isSpammyResult', () => {
    it('should return false for normal text', () => {
      const normalText = 'This is a normal translation result.';
      expect(isSpammyResult(normalText)).toBe(false);
    });

    it('should return true for text with excessive word repetition', () => {
      const spammyText = 'zero zero zero zero zero zero zero zero zero zero zero';
      expect(isSpammyResult(spammyText)).toBe(true);
    });

    it('should return true for very long text', () => {
      const longText = 'a '.repeat(1000) + 'very long text';
      expect(isSpammyResult(longText)).toBe(true);
    });

    it('should return false for text with some repetition but not excessive', () => {
      const acceptableText = 'the the the the the cat sat on the mat';
      expect(isSpammyResult(acceptableText)).toBe(false);
    });

    it('should handle empty strings', () => {
      expect(isSpammyResult('')).toBe(false);
    });

    it('should handle single words', () => {
      expect(isSpammyResult('hello')).toBe(false);
    });

    it('should handle punctuation correctly', () => {
      const textWithPunctuation = 'word, word. word! word? word';
      expect(isSpammyResult(textWithPunctuation)).toBe(false);
    });
  });
});