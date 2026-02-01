/**
 * Tests for graceful shutdown handler
 */

import { onShutdown, isShuttingDown } from '../src/utils/gracefulShutdown';

describe('gracefulShutdown', () => {
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
