/**
 * Enhanced instance lock system
 * Prevents multiple bot instances and provides better lock file management
 */

/// <reference types="node" />

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { logger } from './logger';

const LOCK_FILE = path.join(process.cwd(), '.bot-instance.lock');
const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const LOCK_TIMEOUT = 5 * 60 * 1000; // 5 minutes - maximum time without heartbeat before considering the lock stale / process dead
const ACQUISITION_RETRIES = 3; // Number of times to retry acquiring lock
const RETRY_DELAY = 2000; // 2 seconds between retries

/**
 * Check if a process is alive (cross-platform)
 */
function isProcessAlive(pid: number): boolean {
  // Validate PID is a finite positive integer
  if (!Number.isFinite(pid) || pid <= 0 || !Number.isInteger(pid)) {
    return false;
  }

  // Convert to string and ensure it is strictly numeric to defensively guard interpolation
  const pidStr = String(pid);
  if (!/^\d+$/.test(pidStr)) {
    return false;
  }

  try {
    if (process.platform === 'win32') {
      // Windows: use tasklist with execFileSync (no shell) to check if process exists
      const result = execFileSync('tasklist', ['/FI', 'PID eq ' + pidStr, '/NH'], { 
        encoding: 'utf8', 
        stdio: ['pipe', 'pipe', 'ignore'] 
      });
      // Match PID in the output using word boundary to avoid false matches
      // tasklist output format: "Image Name    PID    Session Name    Session#    Mem Usage"
      const pidPattern = new RegExp('\\b' + pidStr + '\\b');
      return pidPattern.test(result);
    } else {
      // Unix: use kill with signal 0
      process.kill(pid, 0);
      return true;
    }
  } catch {
    return false;
  }
}

interface LockData {
  pid: number;
  hostname: string;
  startTime: string;
  lastHeartbeat: string;
  version: string;
}

/**
 * Enhanced instance lock with heartbeat monitoring
 */
class InstanceLock {
  private lockData: LockData | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private isLocked = false;

  constructor() {
    this.checkExistingLockWithRetry();
    this.startHeartbeat();
  }

  /**
   * Synchronous sleep for startup blocking
   * Uses Atomics.wait on a SharedArrayBuffer to avoid CPU-spinning busy-wait.
   */
  private sleep(ms: number): void {
    if (ms <= 0) {
      return;
    }
    // Use a 4-byte SharedArrayBuffer and Atomics.wait to block efficiently.
    // This keeps the method synchronous without pegging a CPU core.
    const sharedBuffer = new SharedArrayBuffer(4);
    const int32 = new Int32Array(sharedBuffer);
    // Atomics.wait will block the current thread until the timeout elapses.
    // We ignore the result since we only care about the delay.
    Atomics.wait(int32, 0, 0, ms);
  }

  /**
   * Check existing lock with retry logic for race conditions
   */
  private checkExistingLockWithRetry() {
    for (let attempt = 1; attempt <= ACQUISITION_RETRIES; attempt++) {
      try {
        this.checkExistingLock();
        return; // Success
      } catch (error) {
        if (error instanceof Error && error.message === 'RETRY_LOCK_ACQUISITION' && attempt < ACQUISITION_RETRIES) {
          logger.info(`Lock acquisition retry ${attempt}/${ACQUISITION_RETRIES}. Waiting ${RETRY_DELAY}ms...`);
          this.sleep(RETRY_DELAY);
        } else {
          throw error; // Re-throw if not retryable or exhausted retries
        }
      }
    }
  }

  /**
   * Check for existing lock file and validate it
   */
  private checkExistingLock() {
    try {
      if (!fs.existsSync(LOCK_FILE)) {
        return;
      }

      const data = fs.readFileSync(LOCK_FILE, 'utf8');
      const existingLock: LockData = JSON.parse(data);

      // Check if lock is stale
      const lastHeartbeat = new Date(existingLock.lastHeartbeat);
      const now = new Date();
      const timeSinceHeartbeat = now.getTime() - lastHeartbeat.getTime();

      if (timeSinceHeartbeat > LOCK_TIMEOUT) {
        logger.warn(`Found stale lock file (last heartbeat ${Math.round(timeSinceHeartbeat / 1000)}s ago). Removing.`);
        this.forceUnlock();
        return;
      }

      // Check if process is still running
      if (!isProcessAlive(existingLock.pid)) {
        logger.warn(`Lock file exists but process ${existingLock.pid} is not running. Removing stale lock.`);
        this.forceUnlock();
        return;
      }

      // Process is alive - another instance is running
      // Check if it's been running for less than 5 seconds (likely a restart race condition)
      const startTime = new Date(existingLock.startTime);
      const timeSinceStart = now.getTime() - startTime.getTime();
      
      if (timeSinceStart < 5000) {
        logger.warn(`Found recently started instance (PID: ${existingLock.pid}, started ${Math.round(timeSinceStart / 1000)}s ago). Will retry lock acquisition.`);
        throw new Error('RETRY_LOCK_ACQUISITION');
      }
      
      // Process has been running for a while - genuine conflict
      logger.error(`Another instance is already running (PID: ${existingLock.pid}, started: ${existingLock.startTime})`);
      logger.error('If this is incorrect, delete the .bot-instance.lock file manually');
      process.exit(1);

    } catch (error) {
      logger.error(`Error checking existing lock: ${error}`);
      // If we can't read the lock file, assume it's corrupted and remove it
      this.forceUnlock();
    }
  }

  /**
   * Acquire the instance lock
   */
  public acquire(): boolean {
    if (this.isLocked) {
      return true; // Already locked by this instance
    }

    try {
      this.lockData = {
        pid: process.pid,
        hostname: os.hostname(),
        startTime: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString(),
        version: process.env.npm_package_version || 'unknown'
      };

      // Write lock file atomically
      const tempFile = LOCK_FILE + '.tmp.' + Date.now();
      fs.writeFileSync(tempFile, JSON.stringify(this.lockData, null, 2), 'utf8');
      fs.renameSync(tempFile, LOCK_FILE);

      this.isLocked = true;
      logger.info(`Instance lock acquired (PID: ${this.lockData.pid})`);
      return true;

    } catch (error) {
      logger.error(`Failed to acquire instance lock: ${error}`);
      return false;
    }
  }

  /**
   * Release the instance lock
   */
  public release() {
    if (!this.isLocked) {
      return;
    }

    this.stopHeartbeat();
    this.forceUnlock();
    this.isLocked = false;
    logger.info('Instance lock released');
  }

  /**
   * Force remove lock file (for cleanup)
   */
  private forceUnlock() {
    try {
      if (fs.existsSync(LOCK_FILE)) {
        fs.unlinkSync(LOCK_FILE);
      }
    } catch (error) {
      logger.error(`Failed to remove lock file: ${error}`);
    }
  }

  /**
   * Start heartbeat to keep lock alive
   */
  private startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (this.isLocked && this.lockData) {
        this.lockData.lastHeartbeat = new Date().toISOString();
        try {
          fs.writeFileSync(LOCK_FILE, JSON.stringify(this.lockData, null, 2), 'utf8');
        } catch (error) {
          logger.error(`Failed to update heartbeat: ${error}`);
        }
      }
    }, HEARTBEAT_INTERVAL);
  }

  /**
   * Stop heartbeat
   */
  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Check if this instance holds the lock
   */
  public isLockedByThisInstance(): boolean {
    return this.isLocked;
  }

  /**
   * Get lock status information
   */
  public getLockStatus(): { locked: boolean; data?: LockData } {
    return {
      locked: this.isLocked,
      data: this.lockData || undefined
    };
  }
}

// Singleton instance
const instanceLock = new InstanceLock();

// Graceful shutdown handling
process.on('SIGINT', () => {
  logger.info('Received SIGINT, releasing instance lock...');
  instanceLock.release();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, releasing instance lock...');
  instanceLock.release();
  process.exit(0);
});

// PM2 shutdown message
process.on('message', (msg: any) => {
  if (msg === 'shutdown') {
    logger.info('Received PM2 shutdown message, releasing instance lock...');
    instanceLock.release();
    process.exit(0);
  }
});

process.on('exit', () => {
  instanceLock.release();
});

// Handle uncaught exceptions - clean up lock before crash
// Only register if no other handlers exist to avoid conflicts
if (process.listenerCount('uncaughtException') === 0) {
  process.on('uncaughtException', (error) => {
    logger.error(`Uncaught exception, releasing lock: ${error}`);
    instanceLock.release();
    process.exit(1);
  });
}

if (process.listenerCount('unhandledRejection') === 0) {
  process.on('unhandledRejection', (reason) => {
    logger.error(`Unhandled rejection, releasing lock: ${reason}`);
    instanceLock.release();
    process.exit(1);
  });
}

export { instanceLock };
export function acquireLock(): boolean {
  return instanceLock.acquire();
}

export function releaseLock() {
  instanceLock.release();
}