import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger';
import { atomicWriteJsonSync } from './safeFileOps';

// Use test-specific directory in test environment for parallel execution
const BASE_DIR = process.env.NODE_ENV === 'test' && process.env.JEST_WORKER_ID
  ? path.join(process.cwd(), '.test-temp', `worker-${process.env.JEST_WORKER_ID}`)
  : process.cwd();

const USER_CACHE_FILE = path.join(BASE_DIR, '.twitter-user-cache.json');

type CacheShape = Record<string, string>; // username(lowercased) -> userId

function loadCache(): CacheShape {
  try {
    if (fs.existsSync(USER_CACHE_FILE)) {
      const raw = fs.readFileSync(USER_CACHE_FILE, 'utf-8');
      return JSON.parse(raw) as CacheShape;
    }
  } catch (e) {
    logger.error(`Failed to load user cache: ${e}`);
  }
  return {};
}

function saveCache(cache: CacheShape) {
  try {
    atomicWriteJsonSync(USER_CACHE_FILE, cache);
  } catch (e) {
    logger.error(`Failed to save user cache: ${e}`);
  }
}

export function getCachedUserId(username: string): string | null {
  const cache = loadCache();
  const key = username.toLowerCase();
  return cache[key] || null;
}

export function setCachedUserId(username: string, userId: string) {
  const cache = loadCache();
  const key = username.toLowerCase();
  cache[key] = userId;
  saveCache(cache);
}
