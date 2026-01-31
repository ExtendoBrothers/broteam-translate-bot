/**
 * Tests for content deduplication
 */

import * as fs from 'fs';
import * as path from 'path';

const TEST_LOG = path.join(process.cwd(), 'posted-outputs.log');

describe('contentDeduplication', () => {
  let contentDeduplication: any;

  beforeEach(() => {
    // Clean up log file before each test
    try {
      if (fs.existsSync(TEST_LOG)) {
        fs.unlinkSync(TEST_LOG);
      }
    } catch (e) {
      // Ignore errors
    }

    // Clear module cache and reimport
    jest.resetModules();
    contentDeduplication = require('../src/utils/contentDeduplication');
  });

  afterEach(() => {
    // Clean up after each test
    try {
      if (fs.existsSync(TEST_LOG)) {
        fs.unlinkSync(TEST_LOG);
      }
    } catch (e) {
      // Ignore errors
    }
  });

  describe('isContentDuplicate (async)', () => {
    it('should return false for unique content', async () => {
      contentDeduplication.logPostedContent('tweet1', 'Previous content here');

      const result = await contentDeduplication.isContentDuplicate(
        'Completely different new content'
      );

      expect(result).toBe(false);
    });

    it('should return true for similar content (>85%)', async () => {
      const content = 'This is some example content with many words';
      contentDeduplication.logPostedContent('tweet1', content);

      // Very similar content (same words, minor variation)
      const result = await contentDeduplication.isContentDuplicate(
        'This is some example content with many words also'
      );

      expect(result).toBe(true);
    });

    it('should return false for empty log file', async () => {
      fs.writeFileSync(TEST_LOG, '', 'utf-8');

      const result = await contentDeduplication.isContentDuplicate(
        'New content'
      );

      expect(result).toBe(false);
    });

    it('should return false for missing log file', async () => {
      const result = await contentDeduplication.isContentDuplicate(
        'New content'
      );

      expect(result).toBe(false);
    });

    it('should check against multiple log entries', async () => {
      contentDeduplication.logPostedContent('tweet1', 'First piece of content');
      contentDeduplication.logPostedContent('tweet2', 'Second piece of content with many words here');
      contentDeduplication.logPostedContent('tweet3', 'Third piece of content');

      const result = await contentDeduplication.isContentDuplicate(
        'Second piece of content with many words here now'
      );

      expect(result).toBe(true);
    });

    it('should handle very long log files', async () => {
      // Create log with 1000 entries
      for (let i = 0; i < 1000; i++) {
        contentDeduplication.logPostedContent(`tweet${i}`, `Content entry number ${i} with some unique text`);
      }

      const result = await contentDeduplication.isContentDuplicate(
        'Completely unique new content that does not match'
      );

      expect(result).toBe(false);
    });

    it('should detect duplicates case-insensitively', async () => {
      contentDeduplication.logPostedContent('tweet1', 'Hello World Test Content');

      const result = await contentDeduplication.isContentDuplicate(
        'HELLO WORLD TEST CONTENT'
      );

      expect(result).toBe(true);
    });
  });

  describe('isContentDuplicateSync', () => {
    it('should return false for unique content', () => {
      contentDeduplication.logPostedContent('tweet1', 'Previous content here');

      const result = contentDeduplication.isContentDuplicateSync(
        'Completely different new content'
      );

      expect(result).toBe(false);
    });

    it('should return true for similar content (>85%)', () => {
      const content = 'This is some example content with many words';
      contentDeduplication.logPostedContent('tweet1', content);

      const result = contentDeduplication.isContentDuplicateSync(
        'This is some example content with many words also'
      );

      expect(result).toBe(true);
    });

    it('should return false for missing log file', () => {
      const result = contentDeduplication.isContentDuplicateSync(
        'New content'
      );

      expect(result).toBe(false);
    });
  });

  describe('logPostedContent', () => {
    it('should append content to log file', () => {
      contentDeduplication.logPostedContent('tweet1', 'Test content');

      expect(fs.existsSync(TEST_LOG)).toBe(true);
      const content = fs.readFileSync(TEST_LOG, 'utf-8');
      expect(content).toContain('Test content');
      expect(content).toContain('tweet1');
    });

    it('should append to existing log', () => {
      contentDeduplication.logPostedContent('tweet1', 'Existing content');
      contentDeduplication.logPostedContent('tweet2', 'New content');

      const content = fs.readFileSync(TEST_LOG, 'utf-8');
      expect(content).toContain('Existing content');
      expect(content).toContain('New content');
    });

    it('should handle multiple appends', () => {
      contentDeduplication.logPostedContent('tweet1', 'Content 1');
      contentDeduplication.logPostedContent('tweet2', 'Content 2');
      contentDeduplication.logPostedContent('tweet3', 'Content 3');

      const content = fs.readFileSync(TEST_LOG, 'utf-8');
      expect(content).toContain('Content 1');
      expect(content).toContain('Content 2');
      expect(content).toContain('Content 3');
    });

    it('should create log file if missing', () => {
      expect(fs.existsSync(TEST_LOG)).toBe(false);

      contentDeduplication.logPostedContent('tweet1', 'New content');

      expect(fs.existsSync(TEST_LOG)).toBe(true);
    });

    it('should store JSON format with timestamp', () => {
      contentDeduplication.logPostedContent('tweet123', 'Test content');

      const content = fs.readFileSync(TEST_LOG, 'utf-8');
      const entry = JSON.parse(content.trim());
      
      expect(entry.tweetId).toBe('tweet123');
      expect(entry.content).toBe('Test content');
      expect(entry.timestamp).toBeDefined();
    });
  });

  describe('prunePostedOutputs', () => {
    it('should keep only last N lines', () => {
      for (let i = 0; i < 1000; i++) {
        contentDeduplication.logPostedContent(`tweet${i}`, `Line ${i}`);
      }

      contentDeduplication.prunePostedOutputs(500);

      const content = fs.readFileSync(TEST_LOG, 'utf-8');
      const resultLines = content.trim().split('\n');
      
      expect(resultLines.length).toBe(500);
      expect(resultLines[0]).toContain('Line 500');
      expect(resultLines[499]).toContain('Line 999');
    });

    it('should not modify file with fewer lines than limit', () => {
      for (let i = 0; i < 100; i++) {
        contentDeduplication.logPostedContent(`tweet${i}`, `Line ${i}`);
      }

      contentDeduplication.prunePostedOutputs(500);

      const content = fs.readFileSync(TEST_LOG, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(100);
    });

    it('should handle missing log file', () => {
      expect(() => {
        contentDeduplication.prunePostedOutputs(500);
      }).not.toThrow();
    });

    it('should handle empty log file', () => {
      fs.writeFileSync(TEST_LOG, '', 'utf-8');

      expect(() => {
        contentDeduplication.prunePostedOutputs(500);
      }).not.toThrow();
    });
  });

  describe('isAcceptableWithSemanticCheck', () => {
    it('should return true for acceptable content', () => {
      const translation = 'This is a unique translation';
      const originalText = 'Different source text';
      const postedOutputs: string[] = [];

      const result = contentDeduplication.isAcceptableWithSemanticCheck(
        translation,
        originalText,
        postedOutputs
      );

      expect(result.acceptable).toBe(true);
      expect(result.reason).toBe('');
    });

    it('should reject empty translations', () => {
      const result = contentDeduplication.isAcceptableWithSemanticCheck(
        '',
        'Source text',
        []
      );

      expect(result.acceptable).toBe(false);
      expect(result.reason).toContain('empty');
    });

    it('should reject whitespace-only translations', () => {
      const result = contentDeduplication.isAcceptableWithSemanticCheck(
        '   \n\t  ',
        'Source text',
        []
      );

      expect(result.acceptable).toBe(false);
      expect(result.reason).toContain('empty');
    });

    it('should reject translations identical to source', () => {
      const sameText = 'Test tweet content';
      const result = contentDeduplication.isAcceptableWithSemanticCheck(
        sameText,
        sameText,
        []
      );

      expect(result.acceptable).toBe(false);
      expect(result.reason).toContain('same as the input');
    });

    it('should reject very short translations', () => {
      const result = contentDeduplication.isAcceptableWithSemanticCheck(
        'OK',
        'This is much longer source text with many words',
        []
      );

      expect(result.acceptable).toBe(false);
      expect(result.reason).toContain('Too short');
    });

    it('should reject exact duplicates', () => {
      const translation = 'This is a translation';
      const result = contentDeduplication.isAcceptableWithSemanticCheck(
        translation,
        'Different source',
        [translation] // Already posted
      );

      expect(result.acceptable).toBe(false);
      expect(result.reason).toContain('duplicate');
    });

    it('should accept translations with sufficient change', () => {
      const result = contentDeduplication.isAcceptableWithSemanticCheck(
        'This is a completely different translation with unique content',
        'Short source',
        []
      );

      expect(result.acceptable).toBe(true);
      expect(result.reason).toBe('');
    });
  });

  describe('similarity threshold', () => {
    it('should use 85% threshold for duplicates', async () => {
      const baseContent = 'hello world this is test content for similarity';
      contentDeduplication.logPostedContent('tweet1', baseContent);

      // 100% match
      expect(await contentDeduplication.isContentDuplicate(baseContent)).toBe(true);

      // ~90% match (add a few words)
      expect(await contentDeduplication.isContentDuplicate(
        'hello world this is test content for similarity check'
      )).toBe(true);

      // ~70% match (significant difference)
      expect(await contentDeduplication.isContentDuplicate(
        'hello world completely different content now'
      )).toBe(false);
    });

    it('should normalize whitespace before comparison', async () => {
      contentDeduplication.logPostedContent('tweet1', 'hello   world');

      const result = await contentDeduplication.isContentDuplicate(
        'hello world'
      );

      expect(result).toBe(true);
    });

    it('should handle special characters', async () => {
      const content = 'Hello! How are you? #test @mention';
      contentDeduplication.logPostedContent('tweet1', content);

      const result = await contentDeduplication.isContentDuplicate(
        content
      );

      expect(result).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle very short content', async () => {
      contentDeduplication.logPostedContent('tweet1', 'hi');

      const result = await contentDeduplication.isContentDuplicate('hi');
      expect(result).toBe(true);
    });

    it('should handle very long content', async () => {
      const longContent = 'word '.repeat(1000);
      contentDeduplication.logPostedContent('tweet1', longContent);

      const result = await contentDeduplication.isContentDuplicate(longContent);
      expect(result).toBe(true);
    });

    it('should handle unicode content', async () => {
      const unicodeContent = '你好世界 🌍 مرحبا بالعالم';
      contentDeduplication.logPostedContent('tweet1', unicodeContent);

      const result = await contentDeduplication.isContentDuplicate(unicodeContent);
      expect(result).toBe(true);
    });

    it('should handle line breaks in content', async () => {
      const content = 'Line 1\nLine 2\nLine 3';
      contentDeduplication.logPostedContent('tweet1', content);

      const result = await contentDeduplication.isContentDuplicate(content);
      expect(result).toBe(true);
    });
  });
});
