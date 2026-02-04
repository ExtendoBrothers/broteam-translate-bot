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
const LOCK_TIMEOUT = 5 * 60 * 1000; // 5 minutes - consider lock stale if no heartbeat

/**
 * Check if a process is alive (cross-platform)
 */
function isProcessAlive(pid: number): boolean {
  // Validate PID is a finite positive integer
  if (!Number.isFinite(pid) || pid <= 0 || !Number.isInteger(pid)) {
    return false;
  }

  try {
    if (process.platform === 'win32') {
      // Windows: use tasklist with execFileSync (no shell) to check if process exists
      const result = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], { 
        encoding: 'utf8', 
        stdio: ['pipe', 'pipe', 'ignore'] 
      });
      // Match PID in the output using word boundary to avoid false matches
      // tasklist output format: "Image Name    PID    Session Name    Session#    Mem Usage"
      const pidPattern = new RegExp(`\\b${pid}\\b`);
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
    this.checkExistingLock();
    this.startHeartbeat();
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
process.on('uncaughtException', (error) => {
  logger.error(`Uncaught exception, releasing lock: ${error}`);
  instanceLock.release();
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled rejection, releasing lock: ${reason}`);
  instanceLock.release();
  process.exit(1);
});

export { instanceLock };
export function acquireLock(): boolean {
  return instanceLock.acquire();
}

export function releaseLock() {
  instanceLock.release();
}