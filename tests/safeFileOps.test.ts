/**
 * Tests for safe file operations
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  safeReadJsonSync,
  safeWriteJsonSync,
  safeReadJson,
  safeWriteJson,
  safeAppendFileSync,
  safeAppendFile,
  readLastLines,
  countLines
} from '../src/utils/safeFileOps';

const TEST_DIR = path.join(__dirname, 'test-data');
const TEST_FILE = path.join(TEST_DIR, 'test.json');
const TEST_LOG = path.join(TEST_DIR, 'test.log');

describe('safeFileOps', () => {
  beforeAll(() => {
    // Create test directory once
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  beforeEach(() => {
    // Clean up test files before each test
    try {
      if (fs.existsSync(TEST_FILE)) fs.unlinkSync(TEST_FILE);
      if (fs.existsSync(TEST_LOG)) fs.unlinkSync(TEST_LOG);
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  afterEach(() => {
    // Clean up test files after each test
    try {
      if (fs.existsSync(TEST_FILE)) fs.unlinkSync(TEST_FILE);
      if (fs.existsSync(TEST_LOG)) fs.unlinkSync(TEST_LOG);
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  afterAll(() => {
    // Remove test directory
    try {
      if (fs.existsSync(TEST_DIR)) {
        fs.rmSync(TEST_DIR, { recursive: true, force: true });
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe('safeReadJsonSync', () => {
    it('should read valid JSON file', () => {
      const data = { foo: 'bar', count: 42 };
      fs.writeFileSync(TEST_FILE, JSON.stringify(data));

      const result = safeReadJsonSync(TEST_FILE, {});
      expect(result).toEqual(data);
    });

    it('should return default value for non-existent file', () => {
      const defaultValue = { default: true };
      const result = safeReadJsonSync('/nonexistent/file.json', defaultValue);
      expect(result).toEqual(defaultValue);
    });

    it('should return default value for invalid JSON', () => {
      fs.writeFileSync(TEST_FILE, 'invalid json {');
      const defaultValue = { error: 'handled' };
      const result = safeReadJsonSync(TEST_FILE, defaultValue);
      expect(result).toEqual(defaultValue);
    });

    it('should handle empty file', () => {
      fs.writeFileSync(TEST_FILE, '');
      const defaultValue = { empty: true };
      const result = safeReadJsonSync(TEST_FILE, defaultValue);
      expect(result).toEqual(defaultValue);
    });
  });

  describe('safeWriteJsonSync', () => {
    it('should write JSON successfully', () => {
      const data = { test: 'data', number: 123 };
      const success = safeWriteJsonSync(TEST_FILE, data);

      expect(success).toBe(true);
      expect(fs.existsSync(TEST_FILE)).toBe(true);

      const content = JSON.parse(fs.readFileSync(TEST_FILE, 'utf-8'));
      expect(content).toEqual(data);
    });

    it('should handle write errors gracefully', () => {
      // Try to write to invalid path
      const success = safeWriteJsonSync('/invalid/path/file.json', {});
      expect(success).toBe(false);
    });
  });

  describe('safeReadJson (async)', () => {
    it('should read valid JSON file', async () => {
      const data = { async: true, value: 456 };
      fs.writeFileSync(TEST_FILE, JSON.stringify(data));

      const result = await safeReadJson(TEST_FILE, {});
      expect(result).toEqual(data);
    });

    it('should return default value for non-existent file', async () => {
      const defaultValue = { notFound: true };
      const result = await safeReadJson('/nonexistent/async.json', defaultValue);
      expect(result).toEqual(defaultValue);
    });
  });

  describe('safeWriteJson (async)', () => {
    it('should write JSON successfully', async () => {
      const data = { asyncWrite: true, count: 789 };
      const success = await safeWriteJson(TEST_FILE, data);

      expect(success).toBe(true);
      const content = JSON.parse(fs.readFileSync(TEST_FILE, 'utf-8'));
      expect(content).toEqual(data);
    });
  });

  describe('safeAppendFileSync', () => {
    it('should append to file', () => {
      const success1 = safeAppendFileSync(TEST_LOG, 'Line 1\n');
      const success2 = safeAppendFileSync(TEST_LOG, 'Line 2\n');

      expect(success1).toBe(true);
      expect(success2).toBe(true);

      const content = fs.readFileSync(TEST_LOG, 'utf-8');
      expect(content).toBe('Line 1\nLine 2\n');
    });

    it('should handle append errors gracefully', () => {
      const success = safeAppendFileSync('/invalid/path/log.txt', 'test');
      expect(success).toBe(false);
    });
  });

  describe('safeAppendFile (async)', () => {
    it('should append to file', async () => {
      const success1 = await safeAppendFile(TEST_LOG, 'Async 1\n');
      const success2 = await safeAppendFile(TEST_LOG, 'Async 2\n');

      expect(success1).toBe(true);
      expect(success2).toBe(true);

      const content = fs.readFileSync(TEST_LOG, 'utf-8');
      expect(content).toBe('Async 1\nAsync 2\n');
    });
  });

  describe('readLastLines', () => {
    it('should read last N lines from file', async () => {
      const lines = ['Line 1', 'Line 2', 'Line 3', 'Line 4', 'Line 5'];
      fs.writeFileSync(TEST_LOG, lines.join('\n') + '\n');

      const result = await readLastLines(TEST_LOG, 3);
      expect(result).toEqual(['Line 3', 'Line 4', 'Line 5']);
    });

    it('should handle file with fewer lines than requested', async () => {
      fs.writeFileSync(TEST_LOG, 'Only one line');
      const result = await readLastLines(TEST_LOG, 10);
      expect(result).toEqual(['Only one line']);
    });

    it('should return empty array for non-existent file', async () => {
      const result = await readLastLines('/nonexistent/file.log', 5);
      expect(result).toEqual([]);
    });

    it('should handle empty file', async () => {
      fs.writeFileSync(TEST_LOG, '');
      const result = await readLastLines(TEST_LOG, 5);
      expect(result).toEqual([]);
    });
  });

  describe('countLines', () => {
    it('should count lines in file', async () => {
      const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`);
      fs.writeFileSync(TEST_LOG, lines.join('\n'));

      const count = await countLines(TEST_LOG);
      expect(count).toBe(100);
    });

    it('should return 0 for non-existent file', async () => {
      const count = await countLines(path.join(TEST_DIR, 'nonexistent.log'));
      expect(count).toBe(0);
    });

    it('should handle empty file', async () => {
      fs.writeFileSync(TEST_LOG, '');
      const count = await countLines(TEST_LOG);
      expect(count).toBe(0);
    });

    it('should count file with trailing newline correctly', async () => {
      fs.writeFileSync(TEST_LOG, 'Line 1\nLine 2\nLine 3\n');
      const count = await countLines(TEST_LOG);
      expect(count).toBe(3);
    });
  });
});
