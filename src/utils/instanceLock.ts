/**
 * Single-instance lock for the bot
 * Prevents multiple concurrent instances from running
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger';

const LOCK_FILE = path.join(process.cwd(), '.bot-lock');

export function acquireLock(): boolean {
  try {
    // Check if lock file exists and is still valid
    if (fs.existsSync(LOCK_FILE)) {
      const lockData = fs.readFileSync(LOCK_FILE, 'utf-8');
      const { pid, timestamp } = JSON.parse(lockData);
            
      // Check if the process is still running
      try {
        process.kill(pid, 0); // Signal 0 checks if process exists
        logger.error(`Bot is already running (PID: ${pid}, started: ${new Date(timestamp).toISOString()})`);
        return false;
      } catch (e) {
        // Process doesn't exist, remove stale lock
        logger.warn(`Removing stale lock file from PID ${pid}`);
        fs.unlinkSync(LOCK_FILE);
      }
    }
        
    // Create new lock file
    const lockData = {
      pid: process.pid,
      timestamp: Date.now()
    };
    fs.writeFileSync(LOCK_FILE, JSON.stringify(lockData, null, 2), 'utf-8');
    logger.info(`Acquired instance lock (PID: ${process.pid})`);
        
    // Clean up lock on exit
    const cleanup = () => {
      try {
        if (fs.existsSync(LOCK_FILE)) {
          const currentLock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf-8'));
          if (currentLock.pid === process.pid) {
            fs.unlinkSync(LOCK_FILE);
            logger.info(`Released instance lock (PID: ${process.pid})`);
          }
        }
      } catch (e) {
        // Ignore cleanup errors
      }
    };
        
    process.on('exit', cleanup);
    process.on('SIGINT', () => {
      cleanup();
      process.exit(0);
    });
    process.on('SIGTERM', () => {
      cleanup();
      process.exit(0);
    });
    process.on('uncaughtException', (err) => {
      logger.error(`Uncaught exception: ${err}`);
      cleanup();
      process.exit(1);
    });
        
    return true;
  } catch (error) {
    logger.error(`Failed to acquire lock: ${error}`);
    return false;
  }
}
