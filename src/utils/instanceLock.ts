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
    
    const sleep = (ms: number) => {
      // Synchronous sleep without busy-waiting using Atomics.wait
      // This blocks the current thread but does not spin the CPU
      const sab = new SharedArrayBuffer(4);
      const arr = new Int32Array(sab);
      Atomics.wait(arr, 0, 0, ms);
    };
    
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      // Try to create lock file atomically using exclusive create (wx flag)
      // This is atomic on all platforms - will fail with EEXIST if file already exists
      const lockData = {
        pid: process.pid,
        timestamp: Date.now()
      };
      
      try {
        // Exclusive create - atomic on all platforms (fails if file exists)
        fs.writeFileSync(LOCK_FILE, JSON.stringify(lockData, null, 2), { encoding: 'utf-8', flag: 'wx' });
        logger.info(`Acquired instance lock (PID: ${process.pid})`);
        break; // Success!
        
      } catch (error: unknown) {
        const err = error as Error & { code?: string };
        
        // EEXIST means lock file already exists - check if it's stale
        if (err.code === 'EEXIST') {
          try {
            const existingLock = fs.readFileSync(LOCK_FILE, 'utf-8');
            const { pid, timestamp } = JSON.parse(existingLock);
            
            // Check if the process is still running
            try {
              process.kill(pid, 0); // Signal 0 checks if process exists
              
              // If it's a very recent lock (< 2 seconds), retry to handle race conditions
              const age = Date.now() - timestamp;
              if (age < 2000 && attempt < MAX_RETRIES) {
                logger.warn(`Found recent lock from PID ${pid} (age: ${age}ms). Retrying in ${RETRY_DELAY}ms... (attempt ${attempt}/${MAX_RETRIES})`);
                sleep(RETRY_DELAY);
                continue; // Retry
              }
              
              logger.error(`Bot is already running (PID: ${pid}, started: ${new Date(timestamp).toISOString()})`);
              return false;
              
            } catch {
              // Process doesn't exist, remove stale lock and retry
              logger.warn(`Removing stale lock file from PID ${pid}`);
              fs.unlinkSync(LOCK_FILE);
              
              if (attempt < MAX_RETRIES) {
                logger.info(`Retrying lock acquisition... (attempt ${attempt + 1}/${MAX_RETRIES})`);
                sleep(RETRY_DELAY);
                continue; // Retry
              }
            }
            
          } catch (readError) {
            // Failed to read lock file - may be corrupted or deleted, retry
            logger.warn(`Failed to read lock file: ${readError}`);
            if (attempt < MAX_RETRIES) {
              sleep(RETRY_DELAY);
              continue;
            }
          }
        }
        
        // Other error (not EEXIST) or final attempt - fail
        throw error;
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
