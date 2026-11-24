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
import { atomicWriteJsonSync } from '../src/utils/safeFileOps';

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

  it('reports corrupt history and failed writes so posting can pause', () => {
    jest.mocked(fs.existsSync).mockReturnValueOnce(true);
    jest.mocked(fs.readFileSync).mockReturnValueOnce('invalid');
    jest.isolateModules(() => {
      const { postTracker: loaded } = require('../src/utils/postTracker') as typeof import('../src/utils/postTracker');
      expect(loaded.getStorageError()).toContain('Failed to load');
    });

    jest.isolateModules(() => {
      const { postTracker: loaded } = require('../src/utils/postTracker') as typeof import('../src/utils/postTracker');
      jest.mocked(atomicWriteJsonSync).mockReturnValueOnce(false);
      loaded.recordPost();
      expect(loaded.getStorageError()).toContain('Failed to persist');
    });
  });

  it('does not overwrite a partially loaded corrupt history during cleanup', () => {
    jest.mocked(fs.existsSync).mockReturnValueOnce(true);
    jest.mocked(fs.readFileSync).mockReturnValueOnce(JSON.stringify({
      postTimestamps: ['2025-01-01T00:00:00.000Z'],
      automaticAttempts: { bad: { timestamp: 'invalid', count: 1 } },
    }));
    jest.mocked(atomicWriteJsonSync).mockClear();
    jest.isolateModules(() => {
      const { postTracker: loaded } = require('../src/utils/postTracker') as typeof import('../src/utils/postTracker');
      expect(loaded.getStorageError()).toContain('Failed to load');
      loaded.getPostCount24h();
      loaded.recordPost();
      expect(atomicWriteJsonSync).not.toHaveBeenCalled();
    });
  });

  it('recovers attempt accounting idempotently after reload', () => {
    const timestamp = new Date().toISOString();
    expect(postTracker.reserveAutomaticAttempt('queue', timestamp, 2)).toBe(true);
    expect(postTracker.reserveAutomaticAttempt('queue', timestamp, 2)).toBe(true);
    expect(postTracker.getPostCount24h()).toBe(2);
    expect(postTracker.getPostCount30m()).toBe(2);
    const calls = jest.mocked(atomicWriteJsonSync).mock.calls;
    const saved = JSON.stringify(calls[calls.length - 1][1]);
    jest.mocked(fs.existsSync).mockReturnValueOnce(true);
    jest.mocked(fs.readFileSync).mockReturnValueOnce(saved);
    jest.isolateModules(() => {
      const { postTracker: loaded } = require('../src/utils/postTracker') as typeof import('../src/utils/postTracker');
      expect(loaded.reserveAutomaticAttempt('queue', timestamp, 2)).toBe(true);
      expect(loaded.getPostCount24h()).toBe(2);
      expect(loaded.getPostCount30m()).toBe(2);
      expect(loaded.reserveAutomaticAttempt('queue', timestamp, 3)).toBe(false);
      expect(loaded.getStorageError()).toContain('Conflicting');
    });
  });
});
