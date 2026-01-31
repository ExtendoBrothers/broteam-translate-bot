/**
 * Tests for stream-based log reading
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  processLogFileLines,
  getUniqueLogEntries,
  searchLogFile,
  pruneLogFileLines
} from '../src/utils/streamLogReader';

const TEST_DIR = path.join(__dirname, 'test-data');
const TEST_LOG = path.join(TEST_DIR, 'stream-test.log');

describe('streamLogReader', () => {
  beforeEach(() => {
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    // Only delete the test log file, not the entire directory (other tests may be using it)
    if (fs.existsSync(TEST_LOG)) {
      fs.unlinkSync(TEST_LOG);
    }
  });

  describe('processLogFileLines', () => {
    it('should process all lines', async () => {
      const lines = ['Line 1', 'Line 2', 'Line 3'];
      fs.writeFileSync(TEST_LOG, lines.join('\n'));

      const processed: string[] = [];
      const count = await processLogFileLines(TEST_LOG, (logLine) => {
        processed.push(logLine);
        return true;
      });

      expect(count).toBe(3);
      expect(processed).toEqual(lines);
    });

    it('should stop processing when callback returns false', async () => {
      const lines = ['Line 1', 'Line 2', 'Line 3', 'Line 4', 'Line 5'];
      fs.writeFileSync(TEST_LOG, lines.join('\n'));

      const processed: string[] = [];
      const count = await processLogFileLines(TEST_LOG, (logLine) => {
        processed.push(logLine);
        return processed.length < 3; // Stop after 3 lines
      });

      expect(count).toBe(3);
      expect(processed).toEqual(['Line 1', 'Line 2', 'Line 3']);
    });

    it('should handle async processor', async () => {
      const lines = ['A', 'B', 'C'];
      fs.writeFileSync(TEST_LOG, lines.join('\n'));

      const processed: string[] = [];
      const count = await processLogFileLines(TEST_LOG, async (logLine) => {
        await new Promise(resolve => setTimeout(resolve, 10));
        processed.push(logLine);
        return true;
      });

      expect(count).toBe(3);
      expect(processed).toEqual(lines);
    });

    it('should return 0 for non-existent file', async () => {
      const count = await processLogFileLines('/nonexistent/file.log', () => true);
      expect(count).toBe(0);
    });

    it('should skip empty lines', async () => {
      fs.writeFileSync(TEST_LOG, 'Line 1\n\nLine 2\n  \nLine 3');
      const processed: string[] = [];
      await processLogFileLines(TEST_LOG, (logLine) => {
        processed.push(logLine);
        return true;
      });

      expect(processed).toEqual(['Line 1', 'Line 2', 'Line 3']);
    });
  });

  describe('getUniqueLogEntries', () => {
    it('should extract unique entries', async () => {
      const lines = ['A', 'B', 'A', 'C', 'B', 'D'];
      fs.writeFileSync(TEST_LOG, lines.join('\n'));

      const unique = await getUniqueLogEntries(TEST_LOG);
      expect(unique.size).toBe(4);
      expect(unique.has('A')).toBe(true);
      expect(unique.has('B')).toBe(true);
      expect(unique.has('C')).toBe(true);
      expect(unique.has('D')).toBe(true);
    });

    it('should respect maxEntries limit', async () => {
      const lines = Array.from({ length: 100 }, (_, i) => `Entry ${i}`);
      fs.writeFileSync(TEST_LOG, lines.join('\n'));

      const unique = await getUniqueLogEntries(TEST_LOG, 10);
      expect(unique.size).toBe(10);
    });

    it('should return empty set for non-existent file', async () => {
      const unique = await getUniqueLogEntries('/nonexistent/file.log');
      expect(unique.size).toBe(0);
    });
  });

  describe('searchLogFile', () => {
    it('should find matching lines with string pattern', async () => {
      const lines = [
        'ERROR: Something failed',
        'INFO: All good',
        'ERROR: Another failure',
        'DEBUG: Debug info'
      ];
      fs.writeFileSync(TEST_LOG, lines.join('\n'));

      const matches = await searchLogFile(TEST_LOG, 'ERROR');
      expect(matches).toHaveLength(2);
      expect(matches[0]).toContain('Something failed');
      expect(matches[1]).toContain('Another failure');
    });

    it('should find matching lines with regex pattern', async () => {
      const lines = [
        'User123 logged in',
        'User456 logged out',
        'System started',
        'User789 logged in'
      ];
      fs.writeFileSync(TEST_LOG, lines.join('\n'));

      const matches = await searchLogFile(TEST_LOG, /User\d+ logged in/);
      expect(matches).toHaveLength(2);
      expect(matches[0]).toContain('User123');
      expect(matches[1]).toContain('User789');
    });

    it('should respect maxMatches limit', async () => {
      const lines = Array.from({ length: 50 }, (_, i) => `Match ${i}`);
      fs.writeFileSync(TEST_LOG, lines.join('\n'));

      const matches = await searchLogFile(TEST_LOG, 'Match', 10);
      expect(matches).toHaveLength(10);
    });

    it('should return empty array when no matches found', async () => {
      fs.writeFileSync(TEST_LOG, 'No matching content here');
      const matches = await searchLogFile(TEST_LOG, 'ERROR');
      expect(matches).toHaveLength(0);
    });
  });

  describe('pruneLogFileLines', () => {
    it('should keep only last N lines', async () => {
      const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`);
      fs.writeFileSync(TEST_LOG, lines.join('\n'));

      const success = await pruneLogFileLines(TEST_LOG, 10);
      expect(success).toBe(true);

      const content = fs.readFileSync(TEST_LOG, 'utf-8');
      const remaining = content.trim().split('\n');
      expect(remaining).toHaveLength(10);
      expect(remaining[0]).toBe('Line 91');
      expect(remaining[9]).toBe('Line 100');
    });

    it('should handle file with fewer lines than limit', async () => {
      fs.writeFileSync(TEST_LOG, 'Line 1\nLine 2\nLine 3');

      const success = await pruneLogFileLines(TEST_LOG, 10);
      expect(success).toBe(true);

      const content = fs.readFileSync(TEST_LOG, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(3);
    });

    it('should return true for non-existent file', async () => {
      const success = await pruneLogFileLines('/nonexistent/file.log', 10);
      expect(success).toBe(true);
    });

    it('should handle empty file', async () => {
      fs.writeFileSync(TEST_LOG, '');
      const success = await pruneLogFileLines(TEST_LOG, 10);
      expect(success).toBe(true);
    });
  });
});
