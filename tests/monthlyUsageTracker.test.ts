/**
 * Tests for monthly usage tracker
 */

import * as fs from 'fs';
import * as path from 'path';

// Mock the config before importing the tracker
jest.mock('../src/config', () => ({
  config: {
    MONTHLY_FETCH_LIMIT: 100
  }
}));

const USAGE_FILE = path.join(process.cwd(), '.monthly-fetch-usage.json');

describe('monthlyUsageTracker', () => {
  beforeEach(() => {
    // Clean up usage file before each test
    try {
      if (fs.existsSync(USAGE_FILE)) {
        fs.unlinkSync(USAGE_FILE);
      }
    } catch (e) {
      // Ignore errors
    }

    // Clear module cache to get fresh instance
    jest.resetModules();
  });

  afterEach(() => {
    // Clean up after each test
    try {
      if (fs.existsSync(USAGE_FILE)) {
        fs.unlinkSync(USAGE_FILE);
      }
    } catch (e) {
      // Ignore errors
    }
  });

  describe('getCurrentMonthKey', () => {
    it('should return current month in YYYY-MM format', () => {
      const { monthlyUsageTracker } = require('../src/utils/monthlyUsageTracker');
      const monthKey = monthlyUsageTracker.getCurrentMonthKey();

      expect(monthKey).toMatch(/^\d{4}-\d{2}$/);
      
      const now = new Date();
      const expectedKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
      expect(monthKey).toBe(expectedKey);
    });
  });

  describe('getFetchCount', () => {
    it('should return 0 for new month', () => {
      const { monthlyUsageTracker } = require('../src/utils/monthlyUsageTracker');
      const count = monthlyUsageTracker.getFetchCount();

      expect(count).toBe(0);
    });

    it('should return current count for month', () => {
      const { monthlyUsageTracker } = require('../src/utils/monthlyUsageTracker');
      
      monthlyUsageTracker.incrementFetch();
      monthlyUsageTracker.incrementFetch();
      monthlyUsageTracker.incrementFetch();

      expect(monthlyUsageTracker.getFetchCount()).toBe(3);
    });

    it('should accept custom month key', () => {
      const { monthlyUsageTracker } = require('../src/utils/monthlyUsageTracker');
      
      monthlyUsageTracker.incrementFetch('2025-01');
      monthlyUsageTracker.incrementFetch('2025-02');

      expect(monthlyUsageTracker.getFetchCount('2025-01')).toBe(1);
      expect(monthlyUsageTracker.getFetchCount('2025-02')).toBe(1);
    });
  });

  describe('incrementFetch', () => {
    it('should increment fetch count', () => {
      const { monthlyUsageTracker } = require('../src/utils/monthlyUsageTracker');
      
      expect(monthlyUsageTracker.getFetchCount()).toBe(0);
      
      monthlyUsageTracker.incrementFetch();
      expect(monthlyUsageTracker.getFetchCount()).toBe(1);
      
      monthlyUsageTracker.incrementFetch();
      expect(monthlyUsageTracker.getFetchCount()).toBe(2);
    });

    it('should persist to file', () => {
      const { monthlyUsageTracker } = require('../src/utils/monthlyUsageTracker');
      
      monthlyUsageTracker.incrementFetch();

      expect(fs.existsSync(USAGE_FILE)).toBe(true);
      
      const content = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf-8'));
      expect(content.months).toBeDefined();
    });

    it('should set firstFetchAt timestamp on first increment', () => {
      const { monthlyUsageTracker } = require('../src/utils/monthlyUsageTracker');
      
      const beforeTime = Date.now();
      monthlyUsageTracker.incrementFetch();
      const afterTime = Date.now();

      const content = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf-8'));
      const monthKey = monthlyUsageTracker.getCurrentMonthKey();
      const record = content.months[monthKey];

      expect(record.firstFetchAt).toBeDefined();
      const timestamp = new Date(record.firstFetchAt).getTime();
      expect(timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(timestamp).toBeLessThanOrEqual(afterTime);
    });

    it('should increment for specific month', () => {
      const { monthlyUsageTracker } = require('../src/utils/monthlyUsageTracker');
      
      monthlyUsageTracker.incrementFetch('2025-01');
      monthlyUsageTracker.incrementFetch('2025-01');
      monthlyUsageTracker.incrementFetch('2025-02');

      expect(monthlyUsageTracker.getFetchCount('2025-01')).toBe(2);
      expect(monthlyUsageTracker.getFetchCount('2025-02')).toBe(1);
    });
  });

  describe('isLimitReached', () => {
    it('should return false when under limit', () => {
      const { monthlyUsageTracker } = require('../src/utils/monthlyUsageTracker');
      
      monthlyUsageTracker.incrementFetch();
      
      expect(monthlyUsageTracker.isLimitReached()).toBe(false);
    });

    it('should return true when at limit', () => {
      const { monthlyUsageTracker } = require('../src/utils/monthlyUsageTracker');
      
      // Increment to limit (100)
      for (let i = 0; i < 100; i++) {
        monthlyUsageTracker.incrementFetch();
      }

      expect(monthlyUsageTracker.isLimitReached()).toBe(true);
    });

    it('should return true when over limit', () => {
      const { monthlyUsageTracker } = require('../src/utils/monthlyUsageTracker');
      
      // Increment beyond limit
      for (let i = 0; i < 105; i++) {
        monthlyUsageTracker.incrementFetch();
      }

      expect(monthlyUsageTracker.isLimitReached()).toBe(true);
    });

    it('should check specific month', () => {
      const { monthlyUsageTracker } = require('../src/utils/monthlyUsageTracker');
      
      for (let i = 0; i < 100; i++) {
        monthlyUsageTracker.incrementFetch('2025-01');
      }
      
      monthlyUsageTracker.incrementFetch('2025-02');

      expect(monthlyUsageTracker.isLimitReached('2025-01')).toBe(true);
      expect(monthlyUsageTracker.isLimitReached('2025-02')).toBe(false);
    });
  });

  describe('markLimitReached', () => {
    it('should set count to limit', () => {
      const { monthlyUsageTracker } = require('../src/utils/monthlyUsageTracker');
      
      monthlyUsageTracker.incrementFetch();
      monthlyUsageTracker.markLimitReached();

      expect(monthlyUsageTracker.getFetchCount()).toBe(100);
      expect(monthlyUsageTracker.isLimitReached()).toBe(true);
    });

    it('should work for month with no previous fetches', () => {
      const { monthlyUsageTracker } = require('../src/utils/monthlyUsageTracker');
      
      monthlyUsageTracker.markLimitReached();

      expect(monthlyUsageTracker.getFetchCount()).toBe(100);
      expect(monthlyUsageTracker.isLimitReached()).toBe(true);
    });

    it('should update existing month record', () => {
      const { monthlyUsageTracker } = require('../src/utils/monthlyUsageTracker');
      
      monthlyUsageTracker.incrementFetch();
      monthlyUsageTracker.incrementFetch();
      
      expect(monthlyUsageTracker.getFetchCount()).toBe(2);
      
      monthlyUsageTracker.markLimitReached();
      
      expect(monthlyUsageTracker.getFetchCount()).toBe(100);
    });

    it('should work for specific month', () => {
      const { monthlyUsageTracker } = require('../src/utils/monthlyUsageTracker');
      
      monthlyUsageTracker.markLimitReached('2025-01');

      expect(monthlyUsageTracker.isLimitReached('2025-01')).toBe(true);
      expect(monthlyUsageTracker.getFetchCount('2025-01')).toBe(100);
    });

    it('should persist to file', () => {
      const { monthlyUsageTracker } = require('../src/utils/monthlyUsageTracker');
      
      monthlyUsageTracker.markLimitReached();

      expect(fs.existsSync(USAGE_FILE)).toBe(true);
      
      const content = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf-8'));
      const monthKey = monthlyUsageTracker.getCurrentMonthKey();
      
      expect(content.months[monthKey].fetches).toBe(100);
    });
  });

  describe('persistence', () => {
    it('should load existing usage data on creation', () => {
      const usageData = {
        months: {
          '2025-01': {
            fetches: 50,
            firstFetchAt: '2025-01-01T00:00:00.000Z'
          }
        }
      };
      
      fs.writeFileSync(USAGE_FILE, JSON.stringify(usageData, null, 2), 'utf-8');

      const { monthlyUsageTracker } = require('../src/utils/monthlyUsageTracker');

      expect(monthlyUsageTracker.getFetchCount('2025-01')).toBe(50);
    });

    it('should handle multiple months', () => {
      const { monthlyUsageTracker } = require('../src/utils/monthlyUsageTracker');
      
      monthlyUsageTracker.incrementFetch('2025-01');
      monthlyUsageTracker.incrementFetch('2025-02');
      monthlyUsageTracker.incrementFetch('2025-03');

      const content = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf-8'));
      
      expect(Object.keys(content.months)).toHaveLength(3);
      expect(content.months['2025-01'].fetches).toBe(1);
      expect(content.months['2025-02'].fetches).toBe(1);
      expect(content.months['2025-03'].fetches).toBe(1);
    });

    it('should handle malformed usage file gracefully', () => {
      fs.writeFileSync(USAGE_FILE, 'invalid json {', 'utf-8');

      const { monthlyUsageTracker } = require('../src/utils/monthlyUsageTracker');

      expect(monthlyUsageTracker.getFetchCount()).toBe(0);
    });

    it('should handle empty usage file', () => {
      fs.writeFileSync(USAGE_FILE, '', 'utf-8');

      const { monthlyUsageTracker } = require('../src/utils/monthlyUsageTracker');

      expect(monthlyUsageTracker.getFetchCount()).toBe(0);
    });

    it('should maintain data across multiple operations', () => {
      const { monthlyUsageTracker } = require('../src/utils/monthlyUsageTracker');
      
      monthlyUsageTracker.incrementFetch('2025-01');
      monthlyUsageTracker.incrementFetch('2025-01');
      monthlyUsageTracker.incrementFetch('2025-02');
      
      // Simulate restart by creating new instance
      jest.resetModules();
      const { monthlyUsageTracker: newTracker } = require('../src/utils/monthlyUsageTracker');

      expect(newTracker.getFetchCount('2025-01')).toBe(2);
      expect(newTracker.getFetchCount('2025-02')).toBe(1);
    });

    it('should create valid JSON format', () => {
      const { monthlyUsageTracker } = require('../src/utils/monthlyUsageTracker');
      
      monthlyUsageTracker.incrementFetch();

      const content = fs.readFileSync(USAGE_FILE, 'utf-8');
      expect(() => JSON.parse(content)).not.toThrow();
      
      const parsed = JSON.parse(content);
      expect(parsed.months).toBeDefined();
      expect(typeof parsed.months).toBe('object');
    });
  });

  describe('edge cases', () => {
    it('should handle rapid increments', () => {
      const { monthlyUsageTracker } = require('../src/utils/monthlyUsageTracker');
      
      for (let i = 0; i < 1000; i++) {
        monthlyUsageTracker.incrementFetch();
      }

      expect(monthlyUsageTracker.getFetchCount()).toBe(1000);
    });

    it('should handle month boundary correctly', () => {
      const { monthlyUsageTracker } = require('../src/utils/monthlyUsageTracker');
      
      monthlyUsageTracker.incrementFetch('2025-01');
      monthlyUsageTracker.incrementFetch('2025-02');

      expect(monthlyUsageTracker.getFetchCount('2025-01')).toBe(1);
      expect(monthlyUsageTracker.getFetchCount('2025-02')).toBe(1);
    });

    it('should handle year boundary', () => {
      const { monthlyUsageTracker } = require('../src/utils/monthlyUsageTracker');
      
      monthlyUsageTracker.incrementFetch('2024-12');
      monthlyUsageTracker.incrementFetch('2025-01');

      expect(monthlyUsageTracker.getFetchCount('2024-12')).toBe(1);
      expect(monthlyUsageTracker.getFetchCount('2025-01')).toBe(1);
    });

    it('should pad month numbers with zero', () => {
      const { monthlyUsageTracker } = require('../src/utils/monthlyUsageTracker');
      
      monthlyUsageTracker.incrementFetch('2025-01');
      monthlyUsageTracker.incrementFetch('2025-09');

      const content = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf-8'));
      
      expect(content.months['2025-01']).toBeDefined();
      expect(content.months['2025-09']).toBeDefined();
    });
  });
});
