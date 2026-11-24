/**
 * Tests for graceful shutdown handler
 */

import { onShutdown, isShuttingDown } from '../src/utils/gracefulShutdown';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('gracefulShutdown', () => {
  it.each(['SIGTERM', 'PM2'])('runs cleanup before releasing the lock on %s shutdown', signal => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-shutdown-test-'));
    try {
      const lockModule = path.resolve(__dirname, '../src/utils/enhancedInstanceLock.ts');
      const shutdownModule = path.resolve(__dirname, '../src/utils/gracefulShutdown.ts');
      const script = `
        const { acquireLock } = require(${JSON.stringify(lockModule)});
        const { initializeGracefulShutdown, onShutdown } = require(${JSON.stringify(shutdownModule)});
        if (!acquireLock()) throw new Error('Failed to acquire test lock');
        initializeGracefulShutdown();
        onShutdown(async () => {
          await new Promise(resolve => setTimeout(resolve, 25));
          if (!require('fs').existsSync('.bot-instance.lock')) throw new Error('Lock released before cleanup');
          console.log('ASYNC_CLEANUP_COMPLETE');
        });
        ${signal === 'PM2' ? "process.emit('message', 'shutdown');" : "process.emit('SIGTERM');"}
      `;
      const result = spawnSync(process.execPath, [
        '-r', require.resolve('ts-node/register/transpile-only'), '-e', script,
      ], {
        cwd, encoding: 'utf8', timeout: 15_000,
        env: { ...process.env, TS_NODE_PROJECT: path.resolve(__dirname, '../tsconfig.json') },
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('ASYNC_CLEANUP_COMPLETE');
      expect(fs.existsSync(path.join(cwd, '.bot-instance.lock'))).toBe(false);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  describe('onShutdown', () => {
    it('should register cleanup handler without error', () => {
      expect(() => {
        onShutdown(() => {
          // Cleanup code
        });
      }).not.toThrow();
    });

    it('should register async cleanup handler', () => {
      expect(() => {
        onShutdown(async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
        });
      }).not.toThrow();
    });

    it('should allow multiple handlers', () => {
      expect(() => {
        onShutdown(() => {});
        onShutdown(() => {});
        onShutdown(() => {});
      }).not.toThrow();
    });
  });

  describe('isShuttingDown', () => {
    it('should initially return false', () => {
      expect(isShuttingDown()).toBe(false);
    });

    it('should return boolean value', () => {
      const result = isShuttingDown();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('handler registration', () => {
    it('should handle sync handlers', () => {
      let executed = false;

      onShutdown(() => {
        executed = true;
      });

      // Handler is registered but not executed
      expect(executed).toBe(false);
    });

    it('should handle async handlers', () => {
      let executed = false;

      onShutdown(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        executed = true;
      });

      // Handler is registered but not executed
      expect(executed).toBe(false);
    });

    it('should accept handlers with side effects', () => {
      const sideEffects: string[] = [];

      onShutdown(() => {
        sideEffects.push('cleanup 1');
      });

      onShutdown(() => {
        sideEffects.push('cleanup 2');
      });

      // Side effects haven't run yet
      expect(sideEffects).toHaveLength(0);
    });
  });

  describe('error handling', () => {
    it('should accept handler that might throw', () => {
      expect(() => {
        onShutdown(() => {
          if (Math.random() > 0.5) {
            throw new Error('Random error');
          }
        });
      }).not.toThrow();
    });

    it('should accept async handler that might reject', () => {
      expect(() => {
        onShutdown(async () => {
          if (Math.random() > 0.5) {
            throw new Error('Random error');
          }
        });
      }).not.toThrow();
    });
  });

  describe('cleanup handler types', () => {
    it('should accept void return handler', () => {
      onShutdown(() => {
        // No return
      });
    });

    it('should accept Promise return handler', () => {
      onShutdown(async () => {
        await Promise.resolve();
      });
    });

    it('should accept handler with cleanup logic', () => {
      const resources = { connection: true, file: true };

      onShutdown(() => {
        resources.connection = false;
        resources.file = false;
      });

      // Resources still exist (cleanup not run)
      expect(resources.connection).toBe(true);
      expect(resources.file).toBe(true);
    });
  });
});
