jest.mock('fs', () => ({
  existsSync: jest.fn(() => false),
  readFileSync: jest.fn(),
}));
jest.mock('../src/utils/safeFileOps', () => ({ atomicWriteJsonSync: jest.fn(() => true) }));
jest.mock('../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { postTracker } from '../src/utils/postTracker';
import * as fs from 'fs';

describe('post tracker rolling windows', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    postTracker.clear();
  });

  afterEach(() => {
    postTracker.clear();
    jest.useRealTimers();
  });

  it('expires posts exactly at the 30-minute and 24-hour boundaries', () => {
    postTracker.recordPost();
    jest.advanceTimersByTime(29 * 60_000 + 59_999);
    expect(postTracker.getPostCount30m()).toBe(1);
    jest.advanceTimersByTime(1);
    expect(postTracker.getPostCount30m()).toBe(0);
    expect(postTracker.getPostCount24h()).toBe(1);
    jest.advanceTimersByTime(23.5 * 60 * 60 * 1000);
    expect(postTracker.getPostCount24h()).toBe(0);
  });

  it('counts persisted posts in both windows after loading', () => {
    const now = Date.now();
    jest.mocked(fs.existsSync).mockReturnValueOnce(true);
    jest.mocked(fs.readFileSync).mockReturnValueOnce(JSON.stringify({
      postTimestamps: [
        new Date(now - 29 * 60_000).toISOString(),
        new Date(now - 30 * 60_000).toISOString(),
        new Date(now - 24 * 60 * 60_000).toISOString(),
      ],
    }));
    jest.isolateModules(() => {
      const { postTracker: loaded } = require('../src/utils/postTracker') as typeof import('../src/utils/postTracker');
      expect(loaded.getPostCount30m()).toBe(1);
      expect(loaded.getPostCount24h()).toBe(2);
    });
  });
});
