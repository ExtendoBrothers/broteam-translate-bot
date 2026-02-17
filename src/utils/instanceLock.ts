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
    // Retry logic to handle race conditions during PM2 restarts
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 500; // ms
    
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      // Check if lock file exists and is still valid
      if (fs.existsSync(LOCK_FILE)) {
        const lockData = fs.readFileSync(LOCK_FILE, 'utf-8');
        const { pid, timestamp } = JSON.parse(lockData);
              
        // Check if the process is still running
        try {
          process.kill(pid, 0); // Signal 0 checks if process exists
          
          // If it's a very recent lock (< 2 seconds), retry to handle race conditions
          const age = Date.now() - timestamp;
          if (age < 2000 && attempt < MAX_RETRIES) {
            logger.warn(`Found recent lock from PID ${pid} (age: ${age}ms). Retrying in ${RETRY_DELAY}ms... (attempt ${attempt}/${MAX_RETRIES})`);
            // Sleep synchronously to block startup
            const start = Date.now();
            while (Date.now() - start < RETRY_DELAY) { /* busy wait */ }
            continue; // Retry
          }
          
          logger.error(`Bot is already running (PID: ${pid}, started: ${new Date(timestamp).toISOString()})`);
          return false;
        } catch {
          // Process doesn't exist, remove stale lock
          logger.warn(`Removing stale lock file from PID ${pid}`);
          fs.unlinkSync(LOCK_FILE);
        }
      }
          
      // Create new lock file atomically using temp file + rename
      const lockData = {
        pid: process.pid,
        timestamp: Date.now()
      };
      const tempFile = LOCK_FILE + '.tmp.' + process.pid + '.' + Date.now();
      try {
        fs.writeFileSync(tempFile, JSON.stringify(lockData, null, 2), 'utf-8');
        
        // On Windows, rename will fail if target exists, providing atomicity
        try {
          fs.renameSync(tempFile, LOCK_FILE);
        } catch (renameError: unknown) {
          // Rename failed - another process may have won the race
          const errMsg = (renameError as Error)?.message || String(renameError);
          if (attempt < MAX_RETRIES) {
            logger.warn(`Lock acquisition race detected: ${errMsg}. Retrying... (attempt ${attempt}/${MAX_RETRIES})`);
            try { fs.unlinkSync(tempFile); } catch { /* ignore */ }
            const start = Date.now();
            while (Date.now() - start < RETRY_DELAY) { /* busy wait */ }
            continue; // Retry
          }
          throw renameError;
        }
        
        logger.info(`Acquired instance lock (PID: ${process.pid})`);
        
        // Clean up temp file if it still exists
        try { fs.unlinkSync(tempFile); } catch { /* ignore */ }
        break; // Success!
        
      } catch (writeError) {
        // Clean up temp file
        try { fs.unlinkSync(tempFile); } catch { /* ignore */ }
        throw writeError;
      }
    }
        
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
      } catch {
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
