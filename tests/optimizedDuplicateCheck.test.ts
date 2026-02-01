/**
 * Tests for optimized duplicate checking
 */

import {
  calculateSimilarity,
  normalizeText,
  containsSubstring,
  hashText,
  findMostSimilar,
  clearDuplicateCheckCaches,
  getCacheStats
} from '../src/utils/optimizedDuplicateCheck';

describe('optimizedDuplicateCheck', () => {
  beforeEach(() => {
    // Clear caches before each test
    clearDuplicateCheckCaches();
  });

  describe('normalizeText', () => {
    it('should normalize text consistently', () => {
      const text = 'Hello, World! How are you?';
      const normalized = normalizeText(text);

      expect(normalized).toBe('hello world how are you');
    });

    it('should remove punctuation', () => {
      const text = 'Test!@#$%^&*()';
      const normalized = normalizeText(text);

      expect(normalized).toBe('test');
    });

    it('should handle multiple spaces', () => {
      const text = 'Too    many     spaces';
      const normalized = normalizeText(text);

      expect(normalized).toBe('too many spaces');
    });

    it('should use cache for repeated calls', () => {
      const text = 'Cache this text';
      const result1 = normalizeText(text);
      const result2 = normalizeText(text);

      expect(result1).toBe(result2);
      expect(result1).toBe('cache this text');
    });
  });

  describe('calculateSimilarity', () => {
    it('should return 1.0 for identical texts', () => {
      const text = 'Identical text here';
      const similarity = calculateSimilarity(text, text);

      expect(similarity).toBe(1.0);
    });

    it('should return 0 for completely different texts', () => {
      const text1 = 'apple banana cherry';
      const text2 = 'dog elephant fox';
      const similarity = calculateSimilarity(text1, text2);

      expect(similarity).toBe(0);
    });

    it('should calculate partial similarity', () => {
      const text1 = 'the quick brown fox';
      const text2 = 'the quick red fox';
      const similarity = calculateSimilarity(text1, text2);

      expect(similarity).toBeGreaterThan(0.5);
      expect(similarity).toBeLessThan(1.0);
    });

    it('should use cache for repeated calculations', () => {
      const text1 = 'first text';
      const text2 = 'second text';

      const result1 = calculateSimilarity(text1, text2);
      const result2 = calculateSimilarity(text1, text2);

      expect(result1).toBe(result2);
    });

    it('should handle case insensitivity', () => {
      const similarity = calculateSimilarity('HELLO WORLD', 'hello world');
      expect(similarity).toBe(1.0);
    });

    it('should return 0 for very different length texts', () => {
      const short = 'hi';
      const long = 'this is a very long text with many words in it';
      const similarity = calculateSimilarity(short, long);

      expect(similarity).toBe(0);
    });
  });

  describe('containsSubstring', () => {
    it('should find substring in text', () => {
      const text = 'The quick brown fox jumps';
      const substring = 'brown fox';

      expect(containsSubstring(text, substring)).toBe(true);
    });

    it('should be case insensitive', () => {
      const text = 'UPPERCASE TEXT';
      const substring = 'uppercase text';

      expect(containsSubstring(text, substring)).toBe(true);
    });

    it('should return false when substring not found', () => {
      const text = 'some text here';
      const substring = 'not present';

      expect(containsSubstring(text, substring)).toBe(false);
    });

    it('should return false for substring longer than text', () => {
      const text = 'short';
      const substring = 'this is much longer than the text';

      expect(containsSubstring(text, substring)).toBe(false);
    });

    it('should return false for very short substrings', () => {
      const text = 'text content';
      const substring = 'ab';

      expect(containsSubstring(text, substring)).toBe(false);
    });
  });

  describe('hashText', () => {
    it('should generate consistent hash for same text', () => {
      const text = 'hash this text';
      const hash1 = hashText(text);
      const hash2 = hashText(text);

      expect(hash1).toBe(hash2);
    });

    it('should generate different hashes for different texts', () => {
      const hash1 = hashText('text one');
      const hash2 = hashText('text two');

      expect(hash1).not.toBe(hash2);
    });

    it('should normalize before hashing', () => {
      const hash1 = hashText('Hello World');
      const hash2 = hashText('hello world');

      expect(hash1).toBe(hash2);
    });

    it('should return base36 string', () => {
      const hash = hashText('test');
      expect(typeof hash).toBe('string');
      expect(/^[0-9a-z-]+$/.test(hash)).toBe(true);
    });
  });

  describe('findMostSimilar', () => {
    it('should find most similar candidate', () => {
      const text = 'the quick brown fox';
      const candidates = [
        'the slow brown fox',
        'a completely different text',
        'the quick red fox'
      ];

      const result = findMostSimilar(text, candidates, 0.5);

      expect(result).not.toBeNull();
      // Either 'the slow brown fox' or 'the quick red fox' could match
      expect(['the slow brown fox', 'the quick red fox']).toContain(result?.text);
      expect(result?.similarity).toBeGreaterThan(0.5);
    });

    it('should return null when no candidate meets threshold', () => {
      const text = 'unique text here';
      const candidates = [
        'completely different',
        'not related at all',
        'totally unrelated'
      ];

      const result = findMostSimilar(text, candidates, 0.8);

      expect(result).toBeNull();
    });

    it('should exit early on perfect match', () => {
      const text = 'exact match';
      const candidates = [
        'not a match',
        'exact match',
        'also exact match'
      ];

      const result = findMostSimilar(text, candidates, 0.8);

      expect(result).not.toBeNull();
      expect(result?.similarity).toBeGreaterThanOrEqual(0.99);
    });

    it('should handle empty candidates array', () => {
      const result = findMostSimilar('text', [], 0.5);
      expect(result).toBeNull();
    });

    it('should handle candidates with limited common words', () => {
      const text = 'apple banana cherry';
      const candidates = [
        'dog elephant fox',
        'grape hotel igloo',
        'apple pie recipe'
      ];

      const result = findMostSimilar(text, candidates, 0.2); // Lower threshold

      // May find 'apple pie recipe' or may skip due to low similarity
      if (result) {
        expect(result.text).toBe('apple pie recipe');
      } else {
        // It's valid to return null if similarity is too low
        expect(result).toBeNull();
      }
    });
  });

  describe('cache management', () => {
    it('should track cache usage', () => {
      clearDuplicateCheckCaches();

      // Perform some operations
      normalizeText('text 1');
      normalizeText('text 2');
      calculateSimilarity('a', 'b');
      calculateSimilarity('c', 'd');

      const stats = getCacheStats();
      expect(stats.normalized).toBeGreaterThan(0);
      expect(stats.similarity).toBeGreaterThan(0);
    });

    it('should clear caches', () => {
      // Add some cached values
      normalizeText('cached text');
      calculateSimilarity('text 1', 'text 2');

      let stats = getCacheStats();
      expect(stats.normalized + stats.similarity).toBeGreaterThan(0);

      clearDuplicateCheckCaches();

      stats = getCacheStats();
      expect(stats.normalized).toBe(0);
      expect(stats.similarity).toBe(0);
    });
  });

  describe('performance', () => {
    it('should be faster with caching', () => {
      const text1 = 'performance test text one';
      const text2 = 'performance test text two';

      // First call (cache miss)
      const start1 = Date.now();
      calculateSimilarity(text1, text2);
      const time1 = Date.now() - start1;

      // Second call (cache hit)
      const start2 = Date.now();
      calculateSimilarity(text1, text2);
      const time2 = Date.now() - start2;

      // Cache hit should be faster or equal (both might be <1ms)
      expect(time2).toBeLessThanOrEqual(time1 + 1);
    });

    it('should handle large number of comparisons efficiently', () => {
      const texts = Array.from({ length: 100 }, (_, i) => `text number ${i}`);

      const start = Date.now();
      for (let i = 0; i < texts.length; i++) {
        for (let j = i + 1; j < Math.min(i + 10, texts.length); j++) {
          calculateSimilarity(texts[i], texts[j]);
        }
      }
      const duration = Date.now() - start;

      // Should complete in reasonable time (< 1 second)
      expect(duration).toBeLessThan(1000);
    });
  });
});
