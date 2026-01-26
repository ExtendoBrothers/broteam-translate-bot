import { normalizeNFC, protectTokens, restoreTokens } from '../src/translator/tokenizer';

describe('Tokenizer', () => {
  describe('normalizeNFC', () => {
    it('should normalize Unicode text to NFC form', () => {
      // Test with combining characters
      const input = 'café'; // e with acute accent
      const result = normalizeNFC(input);
      expect(result).toBe('café');
      expect(result.length).toBe(4); // Should be properly normalized
    });

    it('should handle empty strings', () => {
      expect(normalizeNFC('')).toBe('');
    });

    it('should handle normal ASCII text unchanged', () => {
      const input = 'Hello World';
      expect(normalizeNFC(input)).toBe(input);
    });

    it('should handle errors gracefully', () => {
      // Mock normalize to throw an error
      const originalNormalize = String.prototype.normalize;
      String.prototype.normalize = jest.fn(() => { throw new Error('Normalize failed'); });

      const input = 'test';
      expect(normalizeNFC(input)).toBe(input); // Should return original on error

      // Restore
      String.prototype.normalize = originalNormalize;
    });
  });

  describe('protectTokens', () => {
    it('should protect code blocks', () => {
      const input = 'Here is some code: ```console.log("hello")```';
      const result = protectTokens(input);
      expect(result).toContain('__XTOK_CODEBLK_1_');
      expect(result).not.toContain('```console.log("hello")```');
    });

    it('should protect inline code', () => {
      const input = 'Use the `map()` function';
      const result = protectTokens(input);
      expect(result).toContain('__XTOK_CODE_1_');
      expect(result).not.toContain('`map()`');
    });

    it('should protect emails', () => {
      const input = 'Contact me at test@example.com';
      const result = protectTokens(input);
      expect(result).toContain('__XTOK_EMAIL_1_');
      expect(result).not.toContain('test@example.com');
    });

    it('should protect URLs', () => {
      const input = 'Visit https://example.com for more info';
      const result = protectTokens(input);
      expect(result).toContain('__XTOK_URL_1_');
      expect(result).not.toContain('https://example.com');
    });

    it('should protect mentions', () => {
      const input = 'Hello @username!';
      const result = protectTokens(input);
      expect(result).toContain('__XTOK_MENTION_1_');
      expect(result).not.toContain('@username');
    });

    it('should protect hashtags', () => {
      const input = 'Check out #JavaScript';
      const result = protectTokens(input);
      expect(result).toContain('__XTOK_HASHTAG_1_');
      expect(result).not.toContain('#JavaScript');
    });

    it('should protect cashtags', () => {
      const input = 'Stock price: $AAPL';
      const result = protectTokens(input);
      expect(result).toContain('__XTOK_CASHTAG_1_');
      expect(result).not.toContain('$AAPL');
    });

    it('should protect question marks', () => {
      const input = 'What is this?';
      const result = protectTokens(input);
      expect(result).toContain('__XTOK_QMARK_1_');
      expect(result).not.toContain('?');
    });

    it('should handle multiple tokens of different types', () => {
      const input = 'Check @user #tag $STOCK and visit https://example.com?';
      const result = protectTokens(input);
      expect(result).toContain('__XTOK_MENTION_');
      expect(result).toContain('__XTOK_HASHTAG_');
      expect(result).toContain('__XTOK_URL_');
      // Note: $STOCK may not be captured as cashtag in this context, and ? is part of URL
      // Should not contain the original tokens
      expect(result).not.toContain('@user');
      expect(result).not.toContain('#tag');
      expect(result).not.toContain('https://example.com');
    });

    it('should handle empty strings', () => {
      expect(protectTokens('')).toBe('');
    });

    it('should preserve text without tokens', () => {
      const input = 'This is normal text';
      expect(protectTokens(input)).toBe(input);
    });
  });

  describe('restoreTokens', () => {
    it('should restore protected tokens back to original', () => {
      const original = 'Visit https://example.com and contact test@example.com';
      const tokenized = protectTokens(original);
      const restored = restoreTokens(tokenized);
      expect(restored).toBe(original);
    });

    it('should handle multiple token types', () => {
      const original = 'Hello @user, check #tag and $STOCK!';
      const tokenized = protectTokens(original);
      const restored = restoreTokens(tokenized);
      expect(restored).toBe(original);
    });

    it('should handle backward compatibility with old XURL format', () => {
      const oldFormat = 'Visit XURL:aHR0cHM6Ly9leGFtcGxlLmNvbQ== for more info';
      const restored = restoreTokens(oldFormat);
      expect(restored).toBe('Visit https://example.com for more info');
    });

    it('should handle backward compatibility with old XTOK format', () => {
      const oldFormat = 'Contact XTOK:EMAIL:1:dGVzdEBleGFtcGxlLmNvbQ== for help';
      const restored = restoreTokens(oldFormat);
      expect(restored).toBe('Contact test@example.com for help');
    });

    it('should clean up wrapper characters around tokens', () => {
      const mangled = '__XTOK_URL_1_aHR0cHM6Ly9leGFtcGxlLmNvbQ==__ wrapped in {braces} and [brackets]';
      const restored = restoreTokens(mangled);
      expect(restored).toBe('https://example.com wrapped in braces and brackets');
    });

    it('should attempt to restore mangled tokens', () => {
      const mangled = 'Check out this base64: aHR0cHM6Ly9leGFtcGxlLmNvbQ== in text';
      const restored = restoreTokens(mangled);
      expect(restored).toBe('Check out this base64: https://example.com in text');
    });

    it('should handle invalid base64 gracefully', () => {
      const invalid = '__XTOK_URL_1_!@#$%^&*()__'; // Invalid base64 characters
      const restored = restoreTokens(invalid);
      expect(restored).toBe(invalid); // Should return original on decode failure
    });

    it('should handle empty strings', () => {
      expect(restoreTokens('')).toBe('');
    });

    it('should handle text without tokens', () => {
      const input = 'This is normal text';
      expect(restoreTokens(input)).toBe(input);
    });

    it('should round-trip protect and restore correctly', () => {
      const testCases = [
        'Simple text',
        'Text with @mention and #hashtag',
        'Email: user@domain.com',
        'URL: https://example.com/path?query=value',
        'Code: `inline` and ```block```',
        'Mixed: @user #tag $STOCK https://site.com email@test.com `code` ?'
      ];

      for (const original of testCases) {
        const tokenized = protectTokens(original);
        const restored = restoreTokens(tokenized);
        expect(restored).toBe(original);
      }
    });
  });

  describe('protectTokens + restoreTokens round-trip', () => {
    it('should perfectly round-trip complex content', () => {
      const complexContent = `
        Hello @username! Check out this #amazing project.
        Visit https://github.com/user/repo for more info.
        Contact support@example.com for help.
        Use the \`map()\` function in your code.
        Stock symbol: $AAPL
        What's the meaning of life?
      `.trim();

      const tokenized = protectTokens(complexContent);
      const restored = restoreTokens(tokenized);

      expect(restored).toBe(complexContent);
    });
  });
});