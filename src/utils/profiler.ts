import { logger } from './logger';

interface PerformanceMetric {
    name: string;
    startTime: number;
    endTime?: number;
    duration?: number;
    metadata?: Record<string, unknown>;
}

interface PerformanceStats {
    count: number;
    totalDuration: number;
    averageDuration: number;
    minDuration: number;
    maxDuration: number;
    p50: number;
    p95: number;
    p99: number;
}

class PerformanceProfiler {
  private metrics: Map<string, PerformanceMetric[]> = new Map();

  /**
     * Check if performance profiling is enabled
     */
  private get enabled(): boolean {
    return process.env.ENABLE_PERFORMANCE_METRICS === 'true';
  }

  /**
     * Start timing an operation
     */
  start(name: string, metadata?: Record<string, unknown>): void {
    if (!this.enabled) return;

    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }

        this.metrics.get(name)!.push({
          name,
          startTime: Date.now(),
          metadata,
        });
  }

  /**
     * End timing an operation
     */
  end(name: string): number | null {
    if (!this.enabled) return null;

    const metrics = this.metrics.get(name);
    if (!metrics || metrics.length === 0) {
      logger.warn(`No active timer found for metric: ${name}`);
      return null;
    }

    // Find the most recent incomplete metric
    const metric = [...metrics].reverse().find(m => !m.endTime);
    if (!metric) {
      logger.warn(`No incomplete timer found for metric: ${name}`);
      return null;
    }

    metric.endTime = Date.now();
    metric.duration = metric.endTime - metric.startTime;

    logger.debug(`Performance [${name}]: ${metric.duration}ms`, metric.metadata);
    return metric.duration;
  }

  /**
     * Measure an async function execution
     */
  async measure<T>(name: string, fn: () => Promise<T>, metadata?: Record<string, unknown>): Promise<T> {
    if (!this.enabled) {
      return await fn();
    }

    this.start(name, metadata);
    try {
      const result = await fn();
      this.end(name);
      return result;
    } catch (error) {
      this.end(name);
      throw error;
    }
  }

  /**
     * Measure a synchronous function execution
     */
  measureSync<T>(name: string, fn: () => T, metadata?: Record<string, unknown>): T {
    if (!this.enabled) {
      return fn();
    }

    this.start(name, metadata);
    try {
      const result = fn();
      this.end(name);
      return result;
    } catch (error) {
      this.end(name);
      throw error;
    }
  }

  /**
     * Get statistics for a specific metric
     */
  getStats(name: string): PerformanceStats | null {
    const metrics = this.metrics.get(name);
    if (!metrics || metrics.length === 0) {
      return null;
    }

    const durations = metrics
      .filter(m => m.duration !== undefined)
      .map(m => m.duration!)
      .sort((a, b) => a - b);

    if (durations.length === 0) {
      return null;
    }

    const totalDuration = durations.reduce((sum, d) => sum + d, 0);
    const count = durations.length;

    return {
      count,
      totalDuration,
      averageDuration: totalDuration / count,
      minDuration: durations[0],
      maxDuration: durations[durations.length - 1],
      p50: this.percentile(durations, 50),
      p95: this.percentile(durations, 95),
      p99: this.percentile(durations, 99),
    };
  }

  /**
     * Get all metrics
     */
  getAllStats(): Map<string, PerformanceStats> {
    const allStats = new Map<string, PerformanceStats>();
        
    for (const [name] of this.metrics) {
      const stats = this.getStats(name);
      if (stats) {
        allStats.set(name, stats);
      }
    }

    return allStats;
  }

  /**
     * Log summary of all metrics
     */
  logSummary(): void {
    if (!this.enabled) {
      logger.info('Performance profiling is disabled');
      return;
    }

    const allStats = this.getAllStats();
        
    if (allStats.size === 0) {
      logger.info('No performance metrics collected');
      return;
    }

    logger.info('=== Performance Metrics Summary ===');
        
    for (const [name, stats] of allStats) {
      logger.info(`\n${name}:`);
      logger.info(`  Count: ${stats.count}`);
      logger.info(`  Average: ${stats.averageDuration.toFixed(2)}ms`);
      logger.info(`  Min: ${stats.minDuration.toFixed(2)}ms`);
      logger.info(`  Max: ${stats.maxDuration.toFixed(2)}ms`);
      logger.info(`  P50: ${stats.p50.toFixed(2)}ms`);
      logger.info(`  P95: ${stats.p95.toFixed(2)}ms`);
      logger.info(`  P99: ${stats.p99.toFixed(2)}ms`);
    }
  }

  /**
     * Reset all metrics
     */
  reset(): void {
    this.metrics.clear();
  }

  /**
     * Calculate percentile
     */
  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    if (sorted.length === 1) return sorted[0];
        
    const index = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index % 1;
        
    if (lower === upper) {
      return sorted[lower];
    }
        
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }

  /**
     * Export metrics to JSON
     */
  exportMetrics(): string {
    const allStats = this.getAllStats();
    const data: Record<string, PerformanceStats> = {};
        
    for (const [name, stats] of allStats) {
      data[name] = stats;
    }
        
    return JSON.stringify(data, null, 2);
  }
}

// Singleton instance
export const profiler = new PerformanceProfiler();

// Convenience decorator for methods
export function Profile(target: any, propertyKey: string, descriptor: PropertyDescriptor): PropertyDescriptor {
  const originalMethod = descriptor.value;
  const metricName = `${target.constructor.name}.${propertyKey}`;

  descriptor.value = async function (...args: any[]) {
    return await profiler.measure(metricName, () => originalMethod.apply(this, args));
  };

  return descriptor;
}
