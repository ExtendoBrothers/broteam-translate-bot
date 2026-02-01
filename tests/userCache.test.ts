/**
 * Tests for user cache
 */

import * as fs from 'fs';
import * as path from 'path';
import { getCachedUserId, setCachedUserId } from '../src/utils/userCache';

const TEST_CACHE_FILE = path.join(process.cwd(), '.twitter-user-cache.json');

describe('userCache', () => {
  beforeEach(() => {
    // Clean up cache file before each test
    try {
      if (fs.existsSync(TEST_CACHE_FILE)) {
        fs.unlinkSync(TEST_CACHE_FILE);
      }
    } catch (e) {
      // Ignore errors
    }
  });

  afterEach(() => {
    // Clean up after each test
    try {
      if (fs.existsSync(TEST_CACHE_FILE)) {
        fs.unlinkSync(TEST_CACHE_FILE);
      }
    } catch (e) {
      // Ignore errors
    }
  });

  describe('getCachedUserId', () => {
    it('should return null when cache is empty', () => {
      const result = getCachedUserId('testuser');
      expect(result).toBeNull();
    });

    it('should return null for non-existent user', () => {
      setCachedUserId('existinguser', '12345');
      const result = getCachedUserId('nonexistentuser');
      expect(result).toBeNull();
    });

    it('should return cached userId for existing user', () => {
      const username = 'testuser';
      const userId = '123456789';
      
      setCachedUserId(username, userId);
      const result = getCachedUserId(username);
      
      expect(result).toBe(userId);
    });

    it('should be case-insensitive for usernames', () => {
      setCachedUserId('TestUser', '12345');
      
      expect(getCachedUserId('testuser')).toBe('12345');
      expect(getCachedUserId('TESTUSER')).toBe('12345');
      expect(getCachedUserId('TeStUsEr')).toBe('12345');
    });

    it('should handle cache file not existing', () => {
      const result = getCachedUserId('anyuser');
      expect(result).toBeNull();
    });

    it('should handle malformed cache file gracefully', () => {
      fs.writeFileSync(TEST_CACHE_FILE, 'invalid json {', 'utf-8');
      
      const result = getCachedUserId('testuser');
      expect(result).toBeNull();
    });

    it('should handle empty cache file', () => {
      fs.writeFileSync(TEST_CACHE_FILE, '', 'utf-8');
      
      const result = getCachedUserId('testuser');
      expect(result).toBeNull();
    });
  });

  describe('setCachedUserId', () => {
    it('should create cache file if it does not exist', () => {
      setCachedUserId('testuser', '12345');
      
      expect(fs.existsSync(TEST_CACHE_FILE)).toBe(true);
    });

    it('should store userId in cache', () => {
      const username = 'testuser';
      const userId = '123456789';
      
      setCachedUserId(username, userId);
      
      const result = getCachedUserId(username);
      expect(result).toBe(userId);
    });

    it('should store username in lowercase', () => {
      setCachedUserId('TestUser', '12345');
      
      const cacheContent = JSON.parse(fs.readFileSync(TEST_CACHE_FILE, 'utf-8'));
      expect(cacheContent).toHaveProperty('testuser');
      expect(cacheContent['testuser']).toBe('12345');
    });

    it('should update existing user', () => {
      setCachedUserId('testuser', '12345');
      setCachedUserId('testuser', '67890');
      
      const result = getCachedUserId('testuser');
      expect(result).toBe('67890');
    });

    it('should handle multiple users', () => {
      setCachedUserId('user1', '111');
      setCachedUserId('user2', '222');
      setCachedUserId('user3', '333');
      
      expect(getCachedUserId('user1')).toBe('111');
      expect(getCachedUserId('user2')).toBe('222');
      expect(getCachedUserId('user3')).toBe('333');
    });

    it('should preserve existing cache entries', () => {
      setCachedUserId('user1', '111');
      setCachedUserId('user2', '222');
      
      const cacheContent = JSON.parse(fs.readFileSync(TEST_CACHE_FILE, 'utf-8'));
      expect(Object.keys(cacheContent)).toHaveLength(2);
      expect(cacheContent['user1']).toBe('111');
      expect(cacheContent['user2']).toBe('222');
    });

    it('should handle special characters in username', () => {
      setCachedUserId('user_123', '12345');
      setCachedUserId('user-456', '67890');
      
      expect(getCachedUserId('user_123')).toBe('12345');
      expect(getCachedUserId('user-456')).toBe('67890');
    });

    it('should handle empty username', () => {
      setCachedUserId('', '12345');
      
      expect(getCachedUserId('')).toBe('12345');
    });

    it('should persist cache across multiple operations', () => {
      setCachedUserId('user1', '111');
      const result1 = getCachedUserId('user1');
      
      setCachedUserId('user2', '222');
      const result2a = getCachedUserId('user1');
      const result2b = getCachedUserId('user2');
      
      expect(result1).toBe('111');
      expect(result2a).toBe('111');
      expect(result2b).toBe('222');
    });

    it('should create valid JSON format', () => {
      setCachedUserId('user1', '111');
      setCachedUserId('user2', '222');
      
      const content = fs.readFileSync(TEST_CACHE_FILE, 'utf-8');
      expect(() => JSON.parse(content)).not.toThrow();
      
      const parsed = JSON.parse(content);
      expect(typeof parsed).toBe('object');
    });

    it('should handle very long userId', () => {
      const longId = '1'.repeat(100);
      setCachedUserId('testuser', longId);
      
      expect(getCachedUserId('testuser')).toBe(longId);
    });

    it('should handle very long username', () => {
      const longUsername = 'a'.repeat(100);
      setCachedUserId(longUsername, '12345');
      
      expect(getCachedUserId(longUsername)).toBe('12345');
    });

    it('should handle numeric userId', () => {
      setCachedUserId('testuser', '1234567890');
      
      expect(getCachedUserId('testuser')).toBe('1234567890');
    });

    it('should overwrite when setting same user twice with different case', () => {
      setCachedUserId('TestUser', '111');
      setCachedUserId('testuser', '222');
      
      const cacheContent = JSON.parse(fs.readFileSync(TEST_CACHE_FILE, 'utf-8'));
      expect(Object.keys(cacheContent)).toHaveLength(1);
      expect(cacheContent['testuser']).toBe('222');
    });
  });

  describe('cache persistence', () => {
    it('should load cache from existing file', () => {
      const cacheData = {
        'user1': '111',
        'user2': '222'
      };
      fs.writeFileSync(TEST_CACHE_FILE, JSON.stringify(cacheData, null, 2), 'utf-8');
      
      expect(getCachedUserId('user1')).toBe('111');
      expect(getCachedUserId('user2')).toBe('222');
    });

    it('should maintain cache format with pretty printing', () => {
      setCachedUserId('testuser', '12345');
      
      const content = fs.readFileSync(TEST_CACHE_FILE, 'utf-8');
      expect(content).toContain('\n'); // Should be formatted with newlines
      expect(content).toContain('  '); // Should be indented
    });
  });
});
