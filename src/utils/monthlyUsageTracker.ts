import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger';
import { config } from '../config';

// Persist monthly fetch usage counts to survive restarts
// Structure: { "2025-11": { fetches: 12, firstFetchAt: "ISO" } }

interface MonthRecord {
  fetches: number;
  firstFetchAt: string;
}

interface UsageState {
  months: Record<string, MonthRecord>;
}

const USAGE_FILE = path.join(process.cwd(), '.monthly-fetch-usage.json');

class MonthlyUsageTracker {
  private months: Map<string, MonthRecord> = new Map();

  constructor() {
    this.load();
  }

  private load() {
    try {
      if (!fs.existsSync(USAGE_FILE)) return;
      const raw = fs.readFileSync(USAGE_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as UsageState;
      if (parsed?.months) {
        for (const [k, v] of Object.entries(parsed.months)) {
          if (typeof v.fetches === 'number' && v.firstFetchAt) {
            this.months.set(k, v);
          }
        }
        logger.info(`Loaded monthly fetch usage for ${this.months.size} month(s)`);
      }
    } catch (err) {
      logger.error(`Failed to load monthly usage tracker: ${err}`);
    }
  }

  private save() {
    try {
      const monthsObj: Record<string, MonthRecord> = {};
      for (const [k, v] of this.months.entries()) monthsObj[k] = v;
      const state: UsageState = { months: monthsObj };
      fs.writeFileSync(USAGE_FILE, JSON.stringify(state, null, 2), 'utf-8');
    } catch (err) {
      logger.error(`Failed to save monthly usage tracker: ${err}`);
    }
  }

  private getMonthKey(d: Date): string {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  public getCurrentMonthKey(): string {
    return this.getMonthKey(new Date());
  }

  public getFetchCount(monthKey = this.getCurrentMonthKey()): number {
    return this.months.get(monthKey)?.fetches || 0;
  }

  public incrementFetch(monthKey = this.getCurrentMonthKey()) {
    const rec = this.months.get(monthKey);
    if (!rec) {
      this.months.set(monthKey, { fetches: 1, firstFetchAt: new Date().toISOString() });
    } else {
      rec.fetches += 1;
      this.months.set(monthKey, rec);
    }
    this.save();
    logger.info(`Monthly usage: ${this.getFetchCount(monthKey)}/${config.MONTHLY_FETCH_LIMIT} fetches for ${monthKey}`);
  }

  public isLimitReached(monthKey = this.getCurrentMonthKey()): boolean {
    return this.getFetchCount(monthKey) >= config.MONTHLY_FETCH_LIMIT;
  }

  public markLimitReached(monthKey = this.getCurrentMonthKey()) {
    const rec = this.months.get(monthKey);
    if (!rec) {
      this.months.set(monthKey, { fetches: config.MONTHLY_FETCH_LIMIT, firstFetchAt: new Date().toISOString() });
    } else {
      rec.fetches = config.MONTHLY_FETCH_LIMIT;
      this.months.set(monthKey, rec);
    }
    this.save();
    logger.warn(`Monthly usage cap reached externally (Twitter API reported UsageCapExceeded). Marked as ${config.MONTHLY_FETCH_LIMIT}/${config.MONTHLY_FETCH_LIMIT} fetches for ${monthKey}`);
  }
}

export const monthlyUsageTracker = new MonthlyUsageTracker();