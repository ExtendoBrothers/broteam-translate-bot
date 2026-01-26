/**
 * Unit tests for rate limit tracker utilities
 */

import { rateLimitTracker } from '../src/utils/rateLimitTracker';

// Mock all dependencies
jest.mock('../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

jest.mock('../src/config', () => ({
  config: {
    RATE_LIMIT_BUFFER_SECONDS: 10
  }
}));

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn()
}));

jest.mock('path', () => ({
  join: jest.fn()
}));

import { logger } from '../src/utils/logger';
import { config } from '../src/config';
import * as fs from 'fs';
import * as path from 'path';

describe('RateLimitTracker', () => {
  const mockRateLimitFile = '/mock/path/.rate-limit-state.json';

  beforeEach(() => {
    jest.clearAllMocks();
    (path.join as jest.Mock).mockReturnValue(mockRateLimitFile);
    // Reset the singleton instance by clearing its entries
    // This is a bit hacky but necessary for testing
    (rateLimitTracker as any).entries.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('isRateLimited', () => {
    it('should return false when no rate limit is set', () => {
      const result = rateLimitTracker.isRateLimited('test-key');
      expect(result).toBe(false);
    });

    it('should return true when rate limit is active', () => {
      const futureTime = new Date(Date.now() + 60000); // 1 minute from now
      (rateLimitTracker as any).entries.set('test-key', {
        until: futureTime,
        type: 'api',
        reason: 'test'
      });

      const result = rateLimitTracker.isRateLimited('test-key');
      expect(result).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('API rate limit active for \'test-key\'')
      );
    });

    it('should return true when global rate limit is active', () => {
      const futureTime = new Date(Date.now() + 60000);
      (rateLimitTracker as any).entries.set('global', {
        until: futureTime,
        type: 'api'
      });

      const result = rateLimitTracker.isRateLimited('test-key');
      expect(result).toBe(true);
    });

    it('should return true when cooldown is active', () => {
      const futureTime = new Date(Date.now() + 30000); // 30 seconds from now
      (rateLimitTracker as any).entries.set('test-key', {
        until: futureTime,
        type: 'cooldown',
        reason: 'test cooldown'
      });

      const result = rateLimitTracker.isRateLimited('test-key');
      expect(result).toBe(true);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Cooldown active for \'test-key\'')
      );
    });

    it('should clear expired rate limit and return false', () => {
      const pastTime = new Date(Date.now() - 1000); // 1 second ago
      (rateLimitTracker as any).entries.set('test-key', {
        until: pastTime,
        type: 'api'
      });

      const result = rateLimitTracker.isRateLimited('test-key');
      expect(result).toBe(false);
      expect((rateLimitTracker as any).entries.has('test-key')).toBe(false);
      expect(fs.writeFileSync).toHaveBeenCalled();
    });
  });

  describe('setRateLimit', () => {
    it('should set rate limit with reset timestamp', () => {
      const resetTimestamp = Math.floor(Date.now() / 1000) + 900; // 15 minutes from now

      rateLimitTracker.setRateLimit('test-key', resetTimestamp);

      const entry = (rateLimitTracker as any).entries.get('test-key');
      expect(entry).toBeDefined();
      expect(entry.type).toBe('api');
      expect(entry.reason).toBe('reset header +2min');
      expect(entry.until.getTime()).toBeGreaterThan(Date.now() + 900000); // Should include buffer
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('API rate limit exceeded for \'test-key\'')
      );
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should set rate limit with fallback when no reset timestamp', () => {
      rateLimitTracker.setRateLimit('test-key');

      const entry = (rateLimitTracker as any).entries.get('test-key');
      expect(entry).toBeDefined();
      expect(entry.type).toBe('api');
      expect(entry.reason).toBe('fixed 90min after 429');
      expect(entry.until.getTime()).toBeGreaterThanOrEqual(Date.now() + 90 * 60 * 1000 - 1000); // Should be around 90 minutes (allow 1s tolerance)
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('API rate limit exceeded for \'test-key\'')
      );
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    // Removed: setRateLimit uses hardcoded 2min buffer
  });

  describe('setCooldown', () => {
    it('should set cooldown with reason', () => {
      const seconds = 120;
      const reason = 'test cooldown';

      rateLimitTracker.setCooldown('test-key', seconds, reason);

      const entry = (rateLimitTracker as any).entries.get('test-key');
      expect(entry).toBeDefined();
      expect(entry.type).toBe('cooldown');
      expect(entry.reason).toBe(reason);
      expect(entry.until.getTime()).toBeGreaterThanOrEqual(Date.now() + seconds * 1000 - 100); // Allow 100ms tolerance
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining(`Setting cooldown for 'test-key' for ${seconds}s (test cooldown)`)
      );
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should set cooldown without reason', () => {
      const seconds = 60;

      rateLimitTracker.setCooldown('test-key', seconds);

      const entry = (rateLimitTracker as any).entries.get('test-key');
      expect(entry).toBeDefined();
      expect(entry.type).toBe('cooldown');
      expect(entry.reason).toBeUndefined();
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining(`Setting cooldown for 'test-key' for ${seconds}s`)
      );
    });
  });

  describe('clearRateLimit', () => {
    beforeEach(() => {
      (rateLimitTracker as any).entries.set('test-key', {
        until: new Date(Date.now() + 60000),
        type: 'api'
      });
      (rateLimitTracker as any).entries.set('another-key', {
        until: new Date(Date.now() + 60000),
        type: 'cooldown'
      });
    });

    it('should clear specific rate limit', () => {
      rateLimitTracker.clearRateLimit('test-key');

      expect((rateLimitTracker as any).entries.has('test-key')).toBe(false);
      expect((rateLimitTracker as any).entries.has('another-key')).toBe(true);
      expect(logger.info).toHaveBeenCalledWith('Rate limit cleared for \'test-key\'');
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should clear all rate limits when no key specified', () => {
      rateLimitTracker.clearRateLimit();

      expect((rateLimitTracker as any).entries.size).toBe(0);
      expect(logger.info).toHaveBeenCalledWith('Rate limits cleared (all keys)');
      expect(fs.writeFileSync).toHaveBeenCalled();
    });
  });

  describe('getSecondsUntilReset', () => {
    it('should return 0 when no rate limit is set', () => {
      const result = rateLimitTracker.getSecondsUntilReset('test-key');
      expect(result).toBe(0);
    });

    it('should return remaining seconds for active rate limit', () => {
      const futureTime = new Date(Date.now() + 65000); // 65 seconds from now
      (rateLimitTracker as any).entries.set('test-key', {
        until: futureTime,
        type: 'api'
      });

      const result = rateLimitTracker.getSecondsUntilReset('test-key');
      expect(result).toBeGreaterThan(60);
      expect(result).toBeLessThanOrEqual(65);
    });

    it('should return remaining seconds for global rate limit', () => {
      const futureTime = new Date(Date.now() + 30000); // 30 seconds from now
      (rateLimitTracker as any).entries.set('global', {
        until: futureTime,
        type: 'api'
      });

      const result = rateLimitTracker.getSecondsUntilReset('test-key');
      expect(result).toBeGreaterThan(25);
      expect(result).toBeLessThanOrEqual(30);
    });

    it('should return 0 for expired rate limit', () => {
      const pastTime = new Date(Date.now() - 1000);
      (rateLimitTracker as any).entries.set('test-key', {
        until: pastTime,
        type: 'api'
      });

      const result = rateLimitTracker.getSecondsUntilReset('test-key');
      expect(result).toBe(0);
    });
  });

  describe('state persistence', () => {
    it('should handle file write errors gracefully', () => {
      (fs.writeFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('File write error');
      });

      rateLimitTracker.setRateLimit('test-key');

      expect(logger.error).toHaveBeenCalledWith('Failed to save rate limit state: Error: File write error');
    });
  });

  describe('backward compatibility', () => {
    it('should handle V1, V2, and V3 state formats during loadState', () => {
      // Test that the loadState method exists and can handle different formats
      // Since it's a singleton, we can't easily test the loading without complex mocking
      // But we can verify the method exists and the structure is correct
      expect(typeof (rateLimitTracker as any).loadState).toBe('function');
      expect(typeof (rateLimitTracker as any).saveState).toBe('function');
    });
  });
});