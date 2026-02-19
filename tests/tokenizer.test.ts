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
    it('should protect mentions and URLs separately when separated by newlines', () => {
      // Regression test for bug where mention regex would capture URL with __XNL__ placeholder
      const input = '@Spark1892\nhumansubstrate.com\nyou\'ll be the first';
      const result = protectTokens(input);
      
      // Should have separate tokens for mention and URL
      expect(result).toContain('__XTOK_MENTION_');
      expect(result).toContain('__XTOK_URL_');
      
      // Extract and verify tokens
      const mentionMatch = result.match(/__XTOK_MENTION_\d+_([A-Za-z0-9+/=]+)__/);
      const urlMatch = result.match(/__XTOK_URL_\d+_([A-Za-z0-9+/=]+)__/);
      
      expect(mentionMatch).toBeTruthy();
      expect(urlMatch).toBeTruthy();
      
      if (mentionMatch && urlMatch) {
        const decodedMention = Buffer.from(mentionMatch[1], 'base64').toString('utf8');
        const decodedUrl = Buffer.from(urlMatch[1], 'base64').toString('utf8');
        
        // Mention should include the newline (or just @Spark1892)
        expect(decodedMention).toMatch(/^@Spark1892/);
        // URL should NOT contain XNL or underscores
        expect(decodedUrl).toBe('humansubstrate.com');
        expect(decodedUrl).not.toContain('XNL');
        expect(decodedUrl).not.toContain('_');
      }
    });

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

    it('should preserve space after mention followed by a word', () => {
      const original = '@hitlersnewgroov why';
      const tokenized = protectTokens(original);
      
      // Should have a space between the token and the word "why"
      // This ensures the word can be translated independently
      expect(tokenized).toMatch(/__XTOK_MENTION_\d+_[A-Za-z0-9+/=]+__\s+why/);
      
      const restored = restoreTokens(tokenized);
      expect(restored).toBe(original);
    });

    it('should preserve newline after mention followed by a word', () => {
      const original = '@hitlersnewgroov\nwhy';
      const tokenized = protectTokens(original);
      
      // Should have newline between the token and the word "why"
      // This ensures the word can be translated independently
      expect(tokenized).toMatch(/__XTOK_MENTION_\d+_[A-Za-z0-9+/=]+__\nwhy/);
      
      const restored = restoreTokens(tokenized);
      expect(restored).toBe(original);
    });

    it('should remove orphaned token placeholder fragments', () => {
      // Test cases from actual logs where fragments like XN, XNL were left behind
      const testCases = [
        { input: 'Hello XN world', expected: 'Hello world' },
        { input: 'Test XNL content', expected: 'Test content' },
        { input: 'Some __X text', expected: 'Some text' },
        { input: 'Data __XN here', expected: 'Data here' },
        { input: 'Check __XTOK fragment', expected: 'Check fragment' },
        { input: 'XTOK_ leftover', expected: 'leftover' },
        { input: 'XTOK_URL_1 broken', expected: 'broken' },
        { input: 'Something SILE else', expected: 'Something else' },
        { input: 'Text with __ABC__ fragment', expected: 'Text with fragment' },
        // Note: Multiple spaces without fragments are preserved (no false positives)
        { input: 'No  fragments  here', expected: 'No  fragments  here' },
      ];

      for (const { input, expected } of testCases) {
        const restored = restoreTokens(input);
        expect(restored).toBe(expected);
      }
    });

    it('should handle real-world mangled token examples from logs', () => {
      // From: "@hitlersnewgroov XN, ON TIME" - should remove XN
      const mangled1 = '@hitlersnewgroov XN, both';
      const restored1 = restoreTokens(mangled1);
      // The XN between spaces gets removed, leaving space cleanup
      expect(restored1).toBe('@hitlersnewgroov, both');
      expect(restored1).not.toContain('XN');

      // From: "HumanSubstrate.com SILE XNL" - should remove SILE and XNL
      const mangled2 = 'HumanSubstrate.com SILE XNL Look who you are';
      const restored2 = restoreTokens(mangled2);
      expect(restored2).toBe('HumanSubstrate.com Look who you are');
      expect(restored2).not.toContain('SILE');
      expect(restored2).not.toContain('XNL');
    });
  });
});