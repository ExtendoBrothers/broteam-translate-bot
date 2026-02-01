/**
 * Health check monitoring system
 * Tracks system health and provides diagnostic information
 */

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger';

interface HealthMetrics {
  timestamp: string;
  uptime: number;
  memory: {
    used: number;
    free: number;
    total: number;
    heapUsed: number;
    heapTotal: number;
    external: number;
    percentage: number;
  };
  cpu: {
    cores: number;
    loadAverage: number[];
  };
  disk: {
    logDirSize: number;
  };
  status: 'healthy' | 'degraded' | 'unhealthy';
  issues: string[];
}

class HealthMonitor {
  private startTime: number;
  private lastHealthCheck: HealthMetrics | null = null;
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.startTime = Date.now();
  }

  /**
   * Get current health metrics
   */
  async getHealthMetrics(): Promise<HealthMetrics> {
    const memUsage = process.memoryUsage();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    
    const metrics: HealthMetrics = {
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      memory: {
        used: usedMem,
        free: freeMem,
        total: totalMem,
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        external: memUsage.external,
        percentage: (usedMem / totalMem) * 100
      },
      cpu: {
        cores: os.cpus().length,
        loadAverage: os.loadavg()
      },
      disk: {
        logDirSize: await this.getLogDirSize()
      },
      status: 'healthy',
      issues: []
    };

    // Check for issues
    if (metrics.memory.percentage > 90) {
      metrics.status = 'unhealthy';
      metrics.issues.push(`High memory usage: ${metrics.memory.percentage.toFixed(1)}%`);
    } else if (metrics.memory.percentage > 75) {
      metrics.status = 'degraded';
      metrics.issues.push(`Elevated memory usage: ${metrics.memory.percentage.toFixed(1)}%`);
    }

    if (metrics.memory.heapUsed > 500 * 1024 * 1024) {
      metrics.status = 'degraded';
      metrics.issues.push(`High heap usage: ${(metrics.memory.heapUsed / 1024 / 1024).toFixed(1)}MB`);
    }

    const loadAvg = metrics.cpu.loadAverage[0];
    const loadPerCore = loadAvg / metrics.cpu.cores;
    if (loadPerCore > 1.5) {
      metrics.status = metrics.status === 'unhealthy' ? 'unhealthy' : 'degraded';
      metrics.issues.push(`High CPU load: ${loadPerCore.toFixed(2)} per core`);
    }

    if (metrics.disk.logDirSize > 100 * 1024 * 1024) {
      metrics.issues.push(`Large log directory: ${(metrics.disk.logDirSize / 1024 / 1024).toFixed(1)}MB`);
    }

    this.lastHealthCheck = metrics;
    return metrics;
  }

  /**
   * Get size of log directory
   */
  private async getLogDirSize(): Promise<number> {
    try {
      const logDir = path.join(process.cwd(), 'translation-logs');
      if (!fs.existsSync(logDir)) {
        return 0;
      }

      let totalSize = 0;
      const files = fs.readdirSync(logDir);
      
      for (const file of files) {
        const filePath = path.join(logDir, file);
        const stat = fs.statSync(filePath);
        if (stat.isFile()) {
          totalSize += stat.size;
        }
      }

      return totalSize;
    } catch (error) {
      logger.warn(`Failed to calculate log directory size: ${error}`);
      return 0;
    }
  }

  /**
   * Start periodic health checks
   */
  startMonitoring(intervalMs: number = 5 * 60 * 1000): void {
    if (this.healthCheckInterval) {
      return; // Already monitoring
    }

    logger.info(`Starting health monitoring (interval: ${intervalMs / 1000}s)`);

    this.healthCheckInterval = setInterval(async () => {
      try {
        const metrics = await this.getHealthMetrics();
        
        if (metrics.status !== 'healthy') {
          logger.warn(`Health check: ${metrics.status.toUpperCase()} - ${metrics.issues.join(', ')}`);
        } else {
          logger.info(`Health check: OK (mem: ${metrics.memory.percentage.toFixed(1)}%, heap: ${(metrics.memory.heapUsed / 1024 / 1024).toFixed(1)}MB)`);
        }

        // Trigger garbage collection if available and memory is high
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const globalAny = globalThis as any;
        if (globalAny.gc && metrics.memory.percentage > 70) {
          logger.info('Triggering garbage collection due to high memory usage');
          globalAny.gc();
        }
      } catch (error) {
        logger.error(`Health check failed: ${error}`);
      }
    }, intervalMs);
  }

  /**
   * Stop periodic health checks
   */
  stopMonitoring(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
      logger.info('Health monitoring stopped');
    }
  }

  /**
   * Get last health check result
   */
  getLastHealthCheck(): HealthMetrics | null {
    return this.lastHealthCheck;
  }

  /**
   * Log detailed health report
   */
  async logHealthReport(): Promise<void> {
    const metrics = await this.getHealthMetrics();
    
    logger.info('=== Health Report ===');
    logger.info(`Status: ${metrics.status.toUpperCase()}`);
    logger.info(`Uptime: ${Math.floor(metrics.uptime / 3600)}h ${Math.floor((metrics.uptime % 3600) / 60)}m`);
    logger.info(`Memory: ${(metrics.memory.used / 1024 / 1024 / 1024).toFixed(2)}GB / ${(metrics.memory.total / 1024 / 1024 / 1024).toFixed(2)}GB (${metrics.memory.percentage.toFixed(1)}%)`);
    logger.info(`Heap: ${(metrics.memory.heapUsed / 1024 / 1024).toFixed(1)}MB / ${(metrics.memory.heapTotal / 1024 / 1024).toFixed(1)}MB`);
    logger.info(`CPU: ${metrics.cpu.cores} cores, load: ${metrics.cpu.loadAverage.map(l => l.toFixed(2)).join(', ')}`);
    logger.info(`Log Dir Size: ${(metrics.disk.logDirSize / 1024 / 1024).toFixed(1)}MB`);
    
    if (metrics.issues.length > 0) {
      logger.warn(`Issues: ${metrics.issues.join(', ')}`);
    }
    logger.info('===================');
  }
}

export const healthMonitor = new HealthMonitor();

/**
 * Start health monitoring
 */
export function startHealthMonitoring(intervalMs?: number): void {
  healthMonitor.startMonitoring(intervalMs);
}

/**
 * Stop health monitoring
 */
export function stopHealthMonitoring(): void {
  healthMonitor.stopMonitoring();
}

/**
 * Get current health metrics
 */
export async function getHealthMetrics(): Promise<HealthMetrics> {
  return healthMonitor.getHealthMetrics();
}

/**
 * Log health report
 */
export async function logHealthReport(): Promise<void> {
  return healthMonitor.logHealthReport();
}
