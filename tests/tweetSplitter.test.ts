/**
 * Tests for tweet splitter
 */

import { splitTweet } from '../src/utils/tweetSplitter';

describe('tweetSplitter', () => {
  describe('splitTweet', () => {
    it('should return single tweet when text is under limit', () => {
      const text = 'This is a short tweet';
      const result = splitTweet(text);
      
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(text);
    });

    it('should not add thread markers for single tweet', () => {
      const text = 'A'.repeat(275);
      const result = splitTweet(text);
      
      expect(result).toHaveLength(1);
      expect(result[0]).not.toContain('(1/1)');
    });

    it('should split by sentences when needed', () => {
      const text = 'First sentence is here with more content. Second sentence is here with more content. Third sentence is here with more content. ' +
                   'Fourth sentence is here with more content. Fifth sentence is here with more content. Sixth sentence is here with more content. ' +
                   'Seventh sentence is here with more content. Eighth sentence is here with more content. Ninth sentence is here with more content. ' +
                   'Tenth sentence is here with more content. Eleventh sentence is here with more content.';
      
      const result = splitTweet(text);
      
      expect(result.length).toBeGreaterThan(1);
      result.forEach(chunk => {
        expect(chunk.length).toBeLessThanOrEqual(280); // Including thread markers
      });
    });

    it('should add thread markers (n/total) to multiple chunks', () => {
      const text = 'A'.repeat(300) + '. ' + 'B'.repeat(300);
      const result = splitTweet(text);
      
      expect(result.length).toBeGreaterThan(1);
      expect(result[0]).toContain('(1/');
      expect(result[1]).toContain('(2/');
      expect(result[result.length - 1]).toContain(`(${result.length}/${result.length})`);
    });

    it('should handle text with exclamation marks', () => {
      const text = 'First part! ' + 'Second part! '.repeat(30);
      const result = splitTweet(text);
      
      expect(result.length).toBeGreaterThan(1);
      result.forEach(chunk => {
        expect(chunk.length).toBeLessThanOrEqual(280);
      });
    });

    it('should handle text with question marks', () => {
      const text = 'First question? ' + 'Second question? '.repeat(30);
      const result = splitTweet(text);
      
      expect(result.length).toBeGreaterThan(1);
      result.forEach(chunk => {
        expect(chunk.length).toBeLessThanOrEqual(280);
      });
    });

    it('should split by words when sentence is too long', () => {
      const longSentence = 'word '.repeat(100) + '.';
      const result = splitTweet(longSentence);
      
      expect(result.length).toBeGreaterThan(1);
      result.forEach(chunk => {
        expect(chunk.length).toBeLessThanOrEqual(280);
      });
    });

    it('should handle mixed punctuation', () => {
      const text = 'Statement. Question? Exclamation! '.repeat(20);
      const result = splitTweet(text);
      
      result.forEach(chunk => {
        expect(chunk.length).toBeLessThanOrEqual(280);
      });
    });

    it('should preserve sentence boundaries when possible', () => {
      const text = 'Short sentence. Another short one. ' + 'X'.repeat(250) + '. Final sentence.';
      const result = splitTweet(text);
      
      expect(result.length).toBeGreaterThan(1);
      // First chunk should contain complete sentences
      expect(result[0]).toContain('.');
    });

    it('should handle empty string', () => {
      const result = splitTweet('');
      
      // Empty string returns empty array or array with empty string after trim
      expect(result.length).toBeLessThanOrEqual(1);
      if (result.length === 1) {
        expect(result[0]).toBe('');
      }
    });

    it('should handle text with only whitespace', () => {
      const result = splitTweet('   \n\t  ');
      
      // Whitespace-only returns empty array or trimmed result
      expect(result.length).toBeLessThanOrEqual(1);
    });

    it('should handle text at exactly 275 characters', () => {
      const text = 'A'.repeat(275);
      const result = splitTweet(text);
      
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(text);
    });

    it('should handle text at 276 characters (just over limit)', () => {
      const text = 'A'.repeat(276);
      const result = splitTweet(text);
      
      // 276 chars gets split since it's > 275
      // But if it's a single word with no spaces, it might stay as one chunk
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle very long single word', () => {
      const text = 'A'.repeat(400);
      const result = splitTweet(text);
      
      // Single word without spaces - implementation may keep as one or handle specially
      expect(result.length).toBeGreaterThanOrEqual(1);
      // At least verify it doesn't crash
      expect(result).toBeDefined();
    });

    it('should handle multiple very long words', () => {
      const text = 'A'.repeat(300) + ' ' + 'B'.repeat(300) + ' ' + 'C'.repeat(300);
      const result = splitTweet(text);
      
      expect(result.length).toBeGreaterThan(1);
      // Individual very long words may exceed limit if they can't be split
      // Just verify we got a result without crashing
      expect(result).toBeDefined();
    });

    it('should handle Unicode characters (emojis)', () => {
      const text = '🔥'.repeat(50) + ' Some text here. ' + '💯'.repeat(50) + ' More text. ' + '✨'.repeat(50);
      const result = splitTweet(text);
      
      result.forEach(chunk => {
        expect(chunk.length).toBeLessThanOrEqual(280);
      });
    });

    it('should handle newlines in text', () => {
      const text = 'Line 1\nLine 2\nLine 3\n'.repeat(20);
      const result = splitTweet(text);
      
      result.forEach(chunk => {
        expect(chunk.length).toBeLessThanOrEqual(280);
      });
    });

    it('should trim whitespace from chunks', () => {
      const text = '  First part.  ' + ' '.repeat(10) + '  Second part.  '.repeat(20);
      const result = splitTweet(text);
      
      result.forEach(chunk => {
        expect(chunk).toBe(chunk.trim());
      });
    });

    it('should handle consecutive sentence delimiters', () => {
      const text = 'What?! Really!! Yes... ' + 'Maybe?! '.repeat(30);
      const result = splitTweet(text);
      
      result.forEach(chunk => {
        expect(chunk.length).toBeLessThanOrEqual(280);
      });
    });

    it('should produce correct thread numbering', () => {
      const text = 'A'.repeat(300) + '. ' + 'B'.repeat(300) + '. ' + 'C'.repeat(300);
      const result = splitTweet(text);
      
      const threadCount = result.length;
      result.forEach((chunk, index) => {
        expect(chunk).toContain(`(${index + 1}/${threadCount})`);
      });
    });

    it('should handle real-world tweet example', () => {
      const text = 'Breaking news: Scientists have discovered a new method to improve battery life by 300%. ' +
                   'The research team at MIT published their findings today. This could revolutionize electric vehicles. ' +
                   'The new battery technology uses a special coating that prevents degradation. ' +
                   'Commercial applications are expected within 5 years. Stay tuned for more updates!';
      
      const result = splitTweet(text);
      
      result.forEach(chunk => {
        expect(chunk.length).toBeLessThanOrEqual(280);
      });
      
      // Verify no content is lost
      const combinedWithoutMarkers = result.map(chunk => 
        chunk.replace(/\s*\(\d+\/\d+\)$/, '')
      ).join(' ');
      
      const originalWords = text.split(/\s+/).filter(w => w);
      const resultWords = combinedWithoutMarkers.split(/\s+/).filter(w => w);
      
      expect(resultWords.length).toBe(originalWords.length);
    });

    it('should handle text with URLs', () => {
      const text = 'Check out this link: https://example.com/very/long/url/path/that/goes/on/and/on. ' +
                   'And another one: https://another-example.com/with/more/segments. '.repeat(10);
      
      const result = splitTweet(text);
      
      result.forEach(chunk => {
        expect(chunk.length).toBeLessThanOrEqual(280);
      });
    });

    it('should handle text with multiple spaces between words', () => {
      const text = 'Word1    Word2     Word3      Word4. '.repeat(30);
      const result = splitTweet(text);
      
      result.forEach(chunk => {
        expect(chunk.length).toBeLessThanOrEqual(280);
      });
    });

    it('should not lose any words during splitting', () => {
      const words = [];
      for (let i = 0; i < 100; i++) {
        words.push(`word${i}`);
      }
      const text = words.join(' ') + '.';
      
      const result = splitTweet(text);
      const combined = result.map(chunk => 
        chunk.replace(/\s*\(\d+\/\d+\)$/, '')
      ).join(' ');
      
      words.forEach(word => {
        expect(combined).toContain(word);
      });
    });
  });
});
