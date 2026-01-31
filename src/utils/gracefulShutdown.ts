/**
 * Graceful shutdown handler to cleanup resources properly
 */

import { logger } from './logger';

type CleanupHandler = () => Promise<void> | void;

class ShutdownManager {
  private handlers: CleanupHandler[] = [];
  private isShuttingDown = false;
  private shutdownTimeout = 10000; // 10 seconds

  /**
   * Register a cleanup handler to be called during shutdown
   */
  registerHandler(handler: CleanupHandler): void {
    this.handlers.push(handler);
  }

  /**
   * Initialize shutdown listeners
   */
  initialize(): void {
    // Handle various termination signals
    process.on('SIGTERM', () => this.shutdown('SIGTERM'));
    process.on('SIGINT', () => this.shutdown('SIGINT'));
    process.on('SIGHUP', () => this.shutdown('SIGHUP'));

    // Handle uncaught exceptions (already handled in index.ts, but ensure cleanup)
    process.on('beforeExit', () => {
      if (!this.isShuttingDown) {
        logger.info('Process exiting normally');
      }
    });
  }

  /**
   * Execute shutdown sequence
   */
  private async shutdown(signal: string): Promise<void> {
    if (this.isShuttingDown) {
      logger.warn(`Already shutting down, ignoring ${signal}`);
      return;
    }

    this.isShuttingDown = true;
    logger.info(`Received ${signal}, starting graceful shutdown...`);

    // Set a hard timeout for shutdown
    const timeout = setTimeout(() => {
      logger.error('Shutdown timeout exceeded, forcing exit');
      process.exit(1);
    }, this.shutdownTimeout);

    try {
      // Run all cleanup handlers
      const promises = this.handlers.map(async (handler, index) => {
        try {
          await handler();
          logger.info(`Cleanup handler ${index + 1}/${this.handlers.length} completed`);
        } catch (error) {
          logger.error(`Cleanup handler ${index + 1} failed: ${error}`);
        }
      });

      await Promise.all(promises);
      
      clearTimeout(timeout);
      logger.info('Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      clearTimeout(timeout);
      logger.error(`Shutdown error: ${error}`);
      process.exit(1);
    }
  }

  /**
   * Get shutdown status
   */
  isShutdownInProgress(): boolean {
    return this.isShuttingDown;
  }
}

export const shutdownManager = new ShutdownManager();

/**
 * Register a cleanup handler
 */
export function onShutdown(handler: CleanupHandler): void {
  shutdownManager.registerHandler(handler);
}

/**
 * Initialize graceful shutdown
 */
export function initializeGracefulShutdown(): void {
  shutdownManager.initialize();
  logger.info('Graceful shutdown handlers initialized');
}

/**
 * Check if shutdown is in progress
 */
export function isShuttingDown(): boolean {
  return shutdownManager.isShutdownInProgress();
}
