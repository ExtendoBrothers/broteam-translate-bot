import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger';

const USER_CACHE_FILE = path.join(process.cwd(), '.twitter-user-cache.json');

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
    fs.writeFileSync(USER_CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8');
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
