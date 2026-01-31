/**
 * Tests for health monitoring system
 */

import { healthMonitor, getHealthMetrics, startHealthMonitoring, stopHealthMonitoring } from '../src/utils/healthCheck';

describe('healthCheck', () => {
  afterEach(() => {
    // Stop monitoring after each test
    stopHealthMonitoring();
  });

  describe('getHealthMetrics', () => {
    it('should return health metrics', async () => {
      const metrics = await getHealthMetrics();

      expect(metrics).toHaveProperty('timestamp');
      expect(metrics).toHaveProperty('uptime');
      expect(metrics).toHaveProperty('memory');
      expect(metrics).toHaveProperty('cpu');
      expect(metrics).toHaveProperty('disk');
      expect(metrics).toHaveProperty('status');
      expect(metrics).toHaveProperty('issues');
    });

    it('should have valid memory metrics', async () => {
      const metrics = await getHealthMetrics();

      expect(metrics.memory.used).toBeGreaterThan(0);
      expect(metrics.memory.total).toBeGreaterThan(0);
      expect(metrics.memory.free).toBeGreaterThanOrEqual(0);
      expect(metrics.memory.heapUsed).toBeGreaterThan(0);
      expect(metrics.memory.heapTotal).toBeGreaterThan(0);
      expect(metrics.memory.percentage).toBeGreaterThanOrEqual(0);
      expect(metrics.memory.percentage).toBeLessThanOrEqual(100);
    });

    it('should have valid CPU metrics', async () => {
      const metrics = await getHealthMetrics();

      expect(metrics.cpu.cores).toBeGreaterThan(0);
      expect(Array.isArray(metrics.cpu.loadAverage)).toBe(true);
      expect(metrics.cpu.loadAverage.length).toBe(3);
    });

    it('should have valid disk metrics', async () => {
      const metrics = await getHealthMetrics();

      expect(metrics.disk.logDirSize).toBeGreaterThanOrEqual(0);
    });

    it('should have valid status', async () => {
      const metrics = await getHealthMetrics();

      expect(['healthy', 'degraded', 'unhealthy']).toContain(metrics.status);
    });

    it('should track uptime', async () => {
      const metrics1 = await getHealthMetrics();
      
      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const metrics2 = await getHealthMetrics();

      expect(metrics2.uptime).toBeGreaterThanOrEqual(metrics1.uptime);
    });
  });

  describe('health status determination', () => {
    it('should report issues for high memory usage', async () => {
      const metrics = await getHealthMetrics();

      // This test checks the logic, actual values depend on system state
      if (metrics.memory.percentage > 90) {
        expect(metrics.status).toBe('unhealthy');
        expect(metrics.issues.some(i => i.includes('memory'))).toBe(true);
      } else if (metrics.memory.percentage > 75) {
        expect(metrics.status).toBe('degraded');
      }
    });

    it('should include timestamp in ISO format', async () => {
      const metrics = await getHealthMetrics();
      const timestamp = new Date(metrics.timestamp);

      expect(isNaN(timestamp.getTime())).toBe(false);
      expect(metrics.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('startHealthMonitoring', () => {
    it('should start monitoring without errors', () => {
      expect(() => {
        startHealthMonitoring(100); // 100ms for testing
      }).not.toThrow();

      stopHealthMonitoring();
    });

    it('should not throw when started multiple times', () => {
      startHealthMonitoring(100);
      expect(() => {
        startHealthMonitoring(100);
      }).not.toThrow();

      stopHealthMonitoring();
    });
  });

  describe('stopHealthMonitoring', () => {
    it('should stop monitoring without errors', () => {
      startHealthMonitoring(100);

      expect(() => {
        stopHealthMonitoring();
      }).not.toThrow();
    });

    it('should not throw when stopped without starting', () => {
      expect(() => {
        stopHealthMonitoring();
      }).not.toThrow();
    });
  });

  describe('getLastHealthCheck', () => {
    it('should return health check result', () => {
      const last = healthMonitor.getLastHealthCheck();
      // May or may not be null depending on test execution order
      expect(last === null || typeof last === 'object').toBe(true);
    });

    it('should return last metrics after check', async () => {
      await getHealthMetrics();
      const last = healthMonitor.getLastHealthCheck();

      expect(last).not.toBeNull();
      expect(last).toHaveProperty('timestamp');
      expect(last).toHaveProperty('status');
    });
  });

  describe('logHealthReport', () => {
    it('should not throw when logging health report', async () => {
      await expect(healthMonitor.logHealthReport()).resolves.not.toThrow();
    });
  });

  describe('memory calculations', () => {
    it('should calculate memory percentage correctly', async () => {
      const metrics = await getHealthMetrics();
      const calculatedPercentage = (metrics.memory.used / metrics.memory.total) * 100;

      expect(metrics.memory.percentage).toBeCloseTo(calculatedPercentage, 1);
    });

    it('should have consistent memory values', async () => {
      const metrics = await getHealthMetrics();

      expect(metrics.memory.used + metrics.memory.free).toBeCloseTo(metrics.memory.total, -6); // Within ~1MB
      expect(metrics.memory.heapUsed).toBeLessThanOrEqual(metrics.memory.heapTotal);
    });
  });

  describe('issue detection', () => {
    it('should have issues array', async () => {
      const metrics = await getHealthMetrics();

      expect(Array.isArray(metrics.issues)).toBe(true);
    });

    it('should report status degraded or unhealthy when issues exist', async () => {
      const metrics = await getHealthMetrics();

      if (metrics.issues.length > 0) {
        expect(['degraded', 'unhealthy']).toContain(metrics.status);
      }
    });

    it('should report healthy when no issues', async () => {
      const metrics = await getHealthMetrics();

      if (metrics.issues.length === 0) {
        expect(metrics.status).toBe('healthy');
      }
    });
  });
});
