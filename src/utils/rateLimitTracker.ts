/**
 * Rate limit tracker for Twitter API
 * Prevents requests when rate limit is exceeded until reset time
 * Persists state to file to survive restarts
 */

import { logger } from './logger';
import * as fs from 'fs';
import * as path from 'path';

const RATE_LIMIT_FILE = path.join(process.cwd(), '.rate-limit-state.json');
const MIN_COOLDOWN_AFTER_429_SECONDS = 90 * 60; // 90 minutes minimum cooldown after 429 (guarantees max 17 posts/24h)

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
  private last429Time: Map<string, string> = new Map(); // Track when we last got a 429 for each key

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
          let loadedCount = 0;
          const now = new Date();
          for (const [key, entry] of Object.entries(state.entries)) {
            const dt = new Date(entry.until);
            if (isFinite(dt.getTime()) && now < dt) {
              this.entries.set(key, { until: dt, type: entry.type, reason: entry.reason });
              loadedCount++;
              const label = entry.type === 'api' ? 'API limit' : 'Cooldown';
              logger.info(`Loaded persisted ${label} for '${key}'. Until ${dt.toISOString()}${entry.reason ? ` (${entry.reason})` : ''}`);
            } else if (isFinite(dt.getTime()) && now >= dt) {
              logger.info(`Skipped expired ${entry.type === 'api' ? 'API limit' : 'Cooldown'} for '${key}' (expired at ${dt.toISOString()})`);
            }
          }
          logger.info(`[DEBUG] Loaded ${loadedCount} active rate limit entries from ${RATE_LIMIT_FILE}`);
          // Load last 429 timestamps
          if (state.last429Time) {
            for (const [key, timestamp] of Object.entries(state.last429Time)) {
              this.last429Time.set(key, timestamp);
              logger.info(`Loaded last 429 time for '${key}': ${timestamp}`);
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
      const state: RateLimitStateV3 = { entries: {}, last429Time: {} };
      for (const [key, val] of this.entries.entries()) {
        state.entries[key] = { until: val.until.toISOString(), type: val.type, reason: val.reason };
      }
      for (const [key, val] of this.last429Time.entries()) {
        state.last429Time![key] = val;
      }
      
      // Write directly to file - more reliable on Windows
      fs.writeFileSync(RATE_LIMIT_FILE, JSON.stringify(state, null, 2), 'utf-8');
      logger.info(`[DEBUG] Saved rate limit state with ${Object.keys(state.entries).length} entries`);
    } catch (error) {
      logger.error(`Failed to save rate limit state: ${error}`);
      // Don't throw - we don't want rate limiting to crash the bot
    }
  }

  public isRateLimited(key: string): boolean {
    const now = new Date();
    
    // First check if we had a recent 429 error - enforce minimum cooldown regardless of reset time
    const last429 = this.last429Time.get(key);
    if (last429) {
      const last429Date = new Date(last429);
      const timeSince429 = now.getTime() - last429Date.getTime();
      const minCooldownMs = MIN_COOLDOWN_AFTER_429_SECONDS * 1000;
      logger.info(`[DEBUG] Last 429 for '${key}' at ${last429}, time since: ${timeSince429}ms, min cooldown: ${minCooldownMs}ms`);
      if (timeSince429 < minCooldownMs) {
        const waitSeconds = Math.ceil((minCooldownMs - timeSince429) / 1000);
        logger.warn(`Enforcing minimum cooldown after 429 for '${key}'. Waiting ${waitSeconds}s until ${new Date(last429Date.getTime() + minCooldownMs).toISOString()}`);
        return true;
      }
    }
    
    const entry = this.entries.get(key) || this.entries.get('global');
    logger.info(`[DEBUG] Checking rate limit for '${key}', found entry: ${!!entry}`);
    if (entry) {
      logger.info(`[DEBUG] Entry details: until ${entry.until.toISOString()}, type: ${entry.type}, reason: ${entry.reason || 'none'}`);
    }
    if (!entry) {
      logger.info(`[DEBUG] No rate limit entry found for '${key}'`);
      return false;
    }
    const dt = entry.until;
    logger.info(`[DEBUG] Rate limit check: now=${now.toISOString()}, until=${dt.toISOString()}, isLimited=${now < dt}`);
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
    logger.info(`[DEBUG] Rate limit expired for '${key}', clearing entry`);
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
    const FIXED_COOLDOWN_MS = 90 * 60 * 1000; // 90 minutes fixed cooldown after 429 (guarantees max 17 posts/24h)
    
    let dt: Date;
    let reason: string;
    
    if (resetTimestamp) {
      // Use Twitter's reset time + 2 minutes buffer
      dt = new Date((resetTimestamp + 120) * 1000); // +2 minutes buffer
      reason = 'reset header +2min';
    } else {
      // Fallback to fixed cooldown
      dt = new Date(Date.now() + FIXED_COOLDOWN_MS);
      reason = 'fixed 90min after 429';
    }
    
    logger.error(`API rate limit exceeded for '${key}'. Setting cooldown until ${dt.toISOString()}`);
    
    // Use whichever is later: the calculated cooldown or existing cooldown
    const existing = this.entries.get(key);
    if (existing && existing.until > dt) {
      dt = existing.until;
    }
    
    this.entries.set(key, { until: dt, type: 'api', reason });
    this.last429Time.set(key, new Date().toISOString());
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
