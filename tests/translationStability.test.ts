/**
 * Tests for translation stability checker
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  checkTranslationStability,
  getStabilityMetrics,
  pruneStabilityLog
} from '../src/utils/translationStability';

const STABILITY_LOG = path.join(process.cwd(), 'translation-stability.log');

describe('translationStability', () => {
  beforeEach(() => {
    // Clean up log file before each test
    try {
      if (fs.existsSync(STABILITY_LOG)) {
        fs.unlinkSync(STABILITY_LOG);
      }
    } catch (e) {
      // Ignore errors
    }
  });

  afterEach(() => {
    // Clean up after each test
    try {
      if (fs.existsSync(STABILITY_LOG)) {
        fs.unlinkSync(STABILITY_LOG);
      }
    } catch (e) {
      // Ignore errors
    }
  });

  describe('checkTranslationStability', () => {
    it('should return stable for first translation', () => {
      const result = checkTranslationStability(
        'tweet1',
        'Hello world',
        'Hola mundo',
        'en-es',
        1
      );

      expect(result.isStable).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should log translation to file', () => {
      checkTranslationStability('tweet1', 'Hello', 'Hola', 'en-es', 1);

      expect(fs.existsSync(STABILITY_LOG)).toBe(true);
      const content = fs.readFileSync(STABILITY_LOG, 'utf-8');
      expect(content).toContain('tweet1');
      expect(content).toContain('Hello');
      expect(content).toContain('Hola');
    });

    it('should detect repetitive outputs', () => {
      const sameOutput = 'Same translation result';

      // Create multiple translations with similar outputs
      for (let i = 0; i < 4; i++) {
        checkTranslationStability(`tweet${i}`, `Input ${i}`, sameOutput, 'en-es', 1);
      }

      const result = checkTranslationStability('tweet5', 'Input 5', sameOutput, 'en-es', 1);

      expect(result.isStable).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues.some(issue => issue.includes('similarity'))).toBe(true);
    });

    it('should detect chain getting stuck', () => {
      const chain = 'en-es-en';
      const similarText = 'The quick brown fox jumps over the lazy dog';

      // Add multiple similar translations in same chain
      for (let i = 0; i < 4; i++) {
        checkTranslationStability(
          `tweet${i}`,
          `Input ${i}`,
          similarText,
          chain,
          1
        );
      }

      const result = checkTranslationStability('tweet5', 'Input 5', similarText, chain, 1);

      expect(result.isStable).toBe(false);
      expect(result.issues.some(issue => issue.includes('Chain'))).toBe(true);
    });

    it('should detect high attempt counts', () => {
      const result = checkTranslationStability(
        'tweet1',
        'Test input',
        'Test output',
        'en-es',
        15 // High attempt count
      );

      expect(result.isStable).toBe(false);
      expect(result.issues.some(issue => issue.includes('High attempt count'))).toBe(true);
    });

    it('should detect input text repetition', () => {
      const sameInput = 'Repeated input text';

      // Process same input multiple times
      for (let i = 0; i < 3; i++) {
        checkTranslationStability(
          `tweet${i}`,
          sameInput,
          `Output ${i}`,
          'en-es',
          1
        );
      }

      const result = checkTranslationStability('tweet3', sameInput, 'Output 3', 'en-es', 1);

      expect(result.isStable).toBe(false);
      expect(result.issues.some(issue => issue.includes('retry loop'))).toBe(true);
    });

    it('should consider different outputs as stable', () => {
      // Add several translations with different outputs
      checkTranslationStability('tweet1', 'Hello world', 'Hola mundo', 'en-es', 1);
      checkTranslationStability('tweet2', 'Good morning', 'Buenos días', 'en-es', 1);
      checkTranslationStability('tweet3', 'Thank you', 'Gracias', 'en-es', 1);
      
      const result = checkTranslationStability('tweet4', 'Goodbye', 'Adiós', 'en-es', 1);

      expect(result.isStable).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should handle empty input/output', () => {
      const result = checkTranslationStability('tweet1', '', '', 'en-es', 1);

      expect(result.isStable).toBe(true);
    });

    it('should handle very long text', () => {
      const longText = 'word '.repeat(1000);
      const result = checkTranslationStability('tweet1', longText, longText, 'en-es', 1);

      expect(result.isStable).toBe(true);
    });

    it('should only check recent translations (window size)', () => {
      // Add many translations to exceed window with DIFFERENT outputs
      for (let i = 0; i < 20; i++) {
        checkTranslationStability(
          `tweet${i}`,
          `Input ${i}`,
          `Different output number ${i}`,
          'en-es',
          1
        );
      }

      // New translation with unique output
      const result = checkTranslationStability(
        'tweet21',
        'New input',
        'Completely unique output for this one',
        'en-es',
        1
      );

      // Should be stable since outputs are all different
      expect(result.isStable).toBe(true);
    });

    it('should handle different chains independently', () => {
      // Add translations in one chain with VARIED outputs
      checkTranslationStability('tweet0', 'Input 0', 'Output A', 'en-es', 1);
      checkTranslationStability('tweet1', 'Input 1', 'Output B', 'en-es', 1);
      checkTranslationStability('tweet2', 'Input 2', 'Output C', 'en-es', 1);

      // Different chain with unique output should be stable
      const result = checkTranslationStability('tweet4', 'Input', 'Unique output D', 'es-en', 1);

      expect(result.isStable).toBe(true);
    });
  });

  describe('getStabilityMetrics', () => {
    it('should return zero metrics when no log exists', () => {
      const metrics = getStabilityMetrics();

      expect(metrics.totalTranslations).toBe(0);
      expect(metrics.averageAttempts).toBe(0);
      expect(metrics.stabilityIssues).toBe(0);
      expect(metrics.recentIssues).toHaveLength(0);
    });

    it('should count total translations', () => {
      checkTranslationStability('tweet1', 'Input 1', 'Output 1', 'en-es', 1);
      checkTranslationStability('tweet2', 'Input 2', 'Output 2', 'en-es', 1);
      checkTranslationStability('tweet3', 'Input 3', 'Output 3', 'en-es', 1);

      const metrics = getStabilityMetrics();

      expect(metrics.totalTranslations).toBe(3);
    });

    it('should calculate average attempts', () => {
      checkTranslationStability('tweet1', 'Input 1', 'Output 1', 'en-es', 1);
      checkTranslationStability('tweet2', 'Input 2', 'Output 2', 'en-es', 3);
      checkTranslationStability('tweet3', 'Input 3', 'Output 3', 'en-es', 5);

      const metrics = getStabilityMetrics();

      expect(metrics.totalTranslations).toBe(3);
      expect(metrics.averageAttempts).toBe(3); // (1+3+5)/3
    });

    it('should limit to last 50 translations', () => {
      // Add more than 50 translations
      for (let i = 0; i < 60; i++) {
        checkTranslationStability(`tweet${i}`, `Input ${i}`, `Output ${i}`, 'en-es', 1);
      }

      const metrics = getStabilityMetrics();

      expect(metrics.totalTranslations).toBeLessThanOrEqual(50);
    });

    it('should handle malformed log entries', () => {
      fs.writeFileSync(STABILITY_LOG, 'invalid json\n', 'utf-8');
      checkTranslationStability('tweet1', 'Input', 'Output', 'en-es', 1);

      const metrics = getStabilityMetrics();

      // Should skip invalid entry and count valid one
      expect(metrics.totalTranslations).toBeGreaterThan(0);
    });
  });

  describe('pruneStabilityLog', () => {
    it('should not fail when log does not exist', () => {
      expect(() => pruneStabilityLog(100)).not.toThrow();
    });

    it('should not modify log when entries are under limit', () => {
      checkTranslationStability('tweet1', 'Input 1', 'Output 1', 'en-es', 1);
      checkTranslationStability('tweet2', 'Input 2', 'Output 2', 'en-es', 1);

      const beforeContent = fs.readFileSync(STABILITY_LOG, 'utf-8');
      const beforeLines = beforeContent.split('\n').filter(l => l.trim());

      pruneStabilityLog(100);

      const afterContent = fs.readFileSync(STABILITY_LOG, 'utf-8');
      const afterLines = afterContent.split('\n').filter(l => l.trim());

      expect(afterLines.length).toBe(beforeLines.length);
    });

    it('should keep only last N entries when over limit', () => {
      // Add many translations
      for (let i = 0; i < 50; i++) {
        checkTranslationStability(`tweet${i}`, `Input ${i}`, `Output ${i}`, 'en-es', 1);
      }

      pruneStabilityLog(10);

      const content = fs.readFileSync(STABILITY_LOG, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());

      expect(lines.length).toBe(10);
    });

    it('should keep most recent entries', () => {
      // Add translations with identifiable data
      for (let i = 0; i < 20; i++) {
        checkTranslationStability(`tweet${i}`, `Input ${i}`, `Output ${i}`, 'en-es', 1);
      }

      pruneStabilityLog(5);

      const content = fs.readFileSync(STABILITY_LOG, 'utf-8');

      // Should contain recent entries (15-19)
      expect(content).toContain('tweet19');
      expect(content).toContain('tweet18');
      
      // Should not contain old entries (use quotes to avoid matching tweet10-14)
      expect(content).not.toContain('"tweetId":"tweet0"');
      expect(content).not.toContain('"tweetId":"tweet5"');
    });

    it('should maintain valid JSON format after pruning', () => {
      for (let i = 0; i < 50; i++) {
        checkTranslationStability(`tweet${i}`, `Input ${i}`, `Output ${i}`, 'en-es', 1);
      }

      pruneStabilityLog(10);

      const content = fs.readFileSync(STABILITY_LOG, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());

      lines.forEach(line => {
        expect(() => JSON.parse(line)).not.toThrow();
      });
    });

    it('should handle empty log file', () => {
      fs.writeFileSync(STABILITY_LOG, '', 'utf-8');
      
      expect(() => pruneStabilityLog(100)).not.toThrow();
    });

    it('should handle custom maxEntries parameter', () => {
      for (let i = 0; i < 30; i++) {
        checkTranslationStability(`tweet${i}`, `Input ${i}`, `Output ${i}`, 'en-es', 1);
      }

      pruneStabilityLog(15);

      const content = fs.readFileSync(STABILITY_LOG, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());

      expect(lines.length).toBe(15);
    });
  });
});
