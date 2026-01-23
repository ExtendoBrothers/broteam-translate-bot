/**
 * Rate limit tracker for Twitter API
 * Prevents requests when rate limit is exceeded until reset time
 * Persists state to file to survive restarts
 */

import { logger } from './logger';
import * as fs from 'fs';
import * as path from 'path';

const RATE_LIMIT_FILE = path.join(process.cwd(), '.rate-limit-state.json');
const MIN_COOLDOWN_AFTER_429_SECONDS = 20 * 60; // 20 minutes minimum cooldown after 429

type RateLimitStateV1 = { resetTime: string | null };
interface RateLimitStateV2 {
    resets: Record<string, string>; // key -> ISO reset time
}
type RateLimitType = 'api' | 'cooldown';
interface RateLimitEntry {
    until: string; // ISO string
    type: RateLimitType;
    reason?: string;
}
interface RateLimitStateV3 {
    entries: Record<string, RateLimitEntry>;
    last429Time?: Record<string, string>; // Track when we last got a 429 for each key
}

class RateLimitTracker {
  private entries: Map<string, { until: Date; type: RateLimitType; reason?: string }> = new Map();
  private last429Time: Map<string, Date> = new Map(); // Track when we last got a 429 for each key

  constructor() {
    // Load persisted state on initialization
    this.loadState();
  }

  /**
     * Load rate limit state from file
     */
  private loadState() {
    try {
      if (fs.existsSync(RATE_LIMIT_FILE)) {
        const data = fs.readFileSync(RATE_LIMIT_FILE, 'utf-8');
        const parsed = JSON.parse(data);
        if (parsed && parsed.entries) {
          const state = parsed as RateLimitStateV3;
          for (const [key, entry] of Object.entries(state.entries)) {
            const dt = new Date(entry.until);
            if (isFinite(dt.getTime()) && new Date() < dt) {
              this.entries.set(key, { until: dt, type: entry.type, reason: entry.reason });
              const label = entry.type === 'api' ? 'API limit' : 'Cooldown';
              logger.info(`Loaded persisted ${label} for '${key}'. Until ${dt.toISOString()}${entry.reason ? ` (${entry.reason})` : ''}`);
            }
          }
          // Load last 429 timestamps
          if (state.last429Time) {
            for (const [key, timestamp] of Object.entries(state.last429Time)) {
              const dt = new Date(timestamp);
              if (isFinite(dt.getTime())) {
                this.last429Time.set(key, dt);
                logger.info(`Loaded last 429 time for '${key}': ${dt.toISOString()}`);
              }
            }
          }
        } else if (parsed && parsed.resetTime) {
          // Backward compatibility: migrate V1 global reset to both read buckets
          const state = parsed as RateLimitStateV1;
          if (state.resetTime) {
            const dt = new Date(state.resetTime);
            if (new Date() < dt) {
              this.entries.set('global', { until: dt, type: 'api' });
              logger.info(`Loaded legacy persisted rate limit. Reset at ${dt.toISOString()}`);
            }
          }
        } else if (parsed && parsed.resets) {
          // Backward compatibility: V2 -> assume API type
          const state = parsed as RateLimitStateV2;
          for (const [key, val] of Object.entries(state.resets)) {
            const dt = new Date(val);
            if (isFinite(dt.getTime()) && new Date() < dt) {
              this.entries.set(key, { until: dt, type: 'api' });
              logger.info(`Loaded persisted API rate limit for '${key}'. Until ${dt.toISOString()}`);
            }
          }
        }
      }
    } catch (error) {
      logger.error(`Failed to load rate limit state: ${error}`);
    }
  }

  /**
     * Save rate limit state to file
     */
  private saveState() {
    try {
      const entriesObj: Record<string, RateLimitEntry> = {};
      for (const [key, val] of this.entries.entries()) {
        entriesObj[key] = { until: val.until.toISOString(), type: val.type, reason: val.reason };
      }
      const last429TimeObj: Record<string, string> = {};
      for (const [key, val] of this.last429Time.entries()) {
        last429TimeObj[key] = val.toISOString();
      }
      const state: RateLimitStateV3 = { entries: entriesObj, last429Time: last429TimeObj };
      fs.writeFileSync(RATE_LIMIT_FILE, JSON.stringify(state, null, 2), 'utf-8');
    } catch (error) {
      logger.error(`Failed to save rate limit state: ${error}`);
    }
  }

  /**
     * Check if we're currently rate limited
     * Always reloads state from file first to ensure fresh data across worker runs
     */
  public isRateLimited(key: string): boolean {
    // CRITICAL: Reload state from file to pick up rate limits set by other processes/runs
    this.loadState();
    
    const entry = this.entries.get(key) || this.entries.get('global');
    if (!entry) return false;
    const dt = entry.until;
    const now = new Date();
    if (now < dt) {
      const waitSeconds = Math.ceil((dt.getTime() - now.getTime()) / 1000);
      if (entry.type === 'api') {
        logger.warn(`API rate limit active for '${key}'. Waiting ${waitSeconds}s until ${dt.toISOString()}${entry.reason ? ` (${entry.reason})` : ''}`);
      } else {
        logger.info(`Cooldown active for '${key}'. Waiting ${waitSeconds}s until ${dt.toISOString()}${entry.reason ? ` (${entry.reason})` : ''}`);
      }
      return true;
    }
    // Reset time has passed, clear that key
    this.entries.delete(key);
    this.saveState();
    return false;
  }



  /**
     * Set rate limit based on Twitter API response (429 error)
     * Uses Twitter's reset time + 2 minutes buffer
     * If an existing cooldown is later, keeps that instead (use whichever is later)
     */
  public setRateLimit(key: string, resetTimestamp?: number) {
    const BUFFER_MS = 2 * 60 * 1000; // 2 minute buffer for Twitter rate limits
    let dt: Date;
    if (resetTimestamp) {
      dt = new Date(resetTimestamp * 1000 + BUFFER_MS);
      logger.error(`API rate limit exceeded for '${key}'. Twitter reset: ${new Date(resetTimestamp * 1000).toISOString()}, with 2min buffer: ${dt.toISOString()}`);
    } else {
      // Fallback: 15 minutes + 2 minute buffer if no reset time available
      dt = new Date(Date.now() + 17 * 60 * 1000);
      logger.error(`API rate limit exceeded for '${key}'. No reset time available, using 17-minute fallback until ${dt.toISOString()}`);
    }
    
    // Use whichever is later: the new rate limit or existing cooldown
    const minCooldownUntil = new Date(Date.now() + MIN_COOLDOWN_AFTER_429_SECONDS * 1000);
    if (minCooldownUntil > dt) {
      logger.warn(`Extending rate limit cooldown to 20 minutes minimum. Until ${minCooldownUntil.toISOString()}`);
      dt = minCooldownUntil;
    }
    
    this.entries.set(key, { until: dt, type: 'api', reason: resetTimestamp ? 'reset header +2min' : 'fallback 15m +2min' });
    this.saveState();
  }

  /**
     * Set a cooldown window proactively (e.g., after a successful call) to avoid re-hitting limits.
     * The cooldown is persisted and respected across restarts.
     * Only sets the cooldown if the new time is LONGER than existing limit.
     */
  public setCooldown(key: string, seconds: number, reason?: string) {
    // Reload state first to get current limits
    this.loadState();
    
    const dt = new Date(Date.now() + seconds * 1000);
    const why = reason ? ` (${reason})` : '';
    
    // Check if there's already a longer limit in place
    const existing = this.entries.get(key);
    if (existing && existing.until > dt) {
      logger.info(`Cooldown for '${key}' not set - existing limit until ${existing.until.toISOString()} is longer than proposed ${dt.toISOString()}`);
      return;
    }
    
    logger.info(`Setting cooldown for '${key}' for ${seconds}s${why}. Until ${dt.toISOString()}`);
    this.entries.set(key, { until: dt, type: 'cooldown', reason });
    this.saveState();
  }

  /**
     * Clear rate limit (for testing or manual override)
     */
  public clearRateLimit(key?: string) {
    if (key) {
      this.entries.delete(key);
      logger.info(`Rate limit cleared for '${key}'`);
    } else {
      this.entries.clear();
      logger.info('Rate limits cleared (all keys)');
    }
    this.saveState();
  }

  /**
     * Get time remaining until rate limit resets (in seconds)
     */
  public getSecondsUntilReset(key: string): number {
    const entry = this.entries.get(key) || this.entries.get('global');
    if (!entry) return 0;
    const diff = entry.until.getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / 1000));
  }
}

// Singleton instance
export const rateLimitTracker = new RateLimitTracker();
