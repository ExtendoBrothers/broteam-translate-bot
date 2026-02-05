/**
 * Safe file operations with proper error handling and async support
 * Prevents blocking operations and provides fallback mechanisms
 */

import * as fs from 'fs';
import { promises as fsPromises } from 'fs';
import { logger } from './logger';

/**
 * Safely read a JSON file with error handling
 */
export function safeReadJsonSync<T>(filePath: string, defaultValue: T): T {
  try {
    if (!fs.existsSync(filePath)) {
      return defaultValue;
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (error) {
    logger.warn(`Failed to read JSON from ${filePath}: ${error}`);
    return defaultValue;
  }
}

/**
 * Safely write JSON file with error handling
 */
export function safeWriteJsonSync<T>(filePath: string, data: T): boolean {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (error) {
    logger.error(`Failed to write JSON to ${filePath}: ${error}`);
    return false;
  }
}

/**
 * Atomically write JSON file to prevent corruption
 * Uses temp file + rename strategy for atomic operation
 * Windows-safe: deletes target file before rename if needed, with retry logic for race conditions
 * Note: Retries are immediate (no backoff delay). For proper exponential backoff, use atomicWriteJson()
 */
export function atomicWriteJsonSync<T>(filePath: string, data: T): boolean {
  const tempFile = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  const maxRetries = 3;
  let lastError: any;
  
  try {
    // Write to temp file first
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf-8');
    
    // Retry logic to handle race conditions on Windows
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // On Windows, rename fails if target exists - delete it first
        if (process.platform === 'win32' && fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        
        // Atomic rename (replaces existing file on Unix, now safe on Windows)
        fs.renameSync(tempFile, filePath);
        return true;
      } catch (renameError) {
        const err = renameError as { code?: string };
        // On Windows, retry if another process created the file between unlink and rename
        if (process.platform === 'win32' && err.code === 'EEXIST' && attempt < maxRetries - 1) {
          lastError = renameError;
          // Immediate retry (no delay in sync version to avoid CPU-wasting busy-wait)
          // For proper exponential backoff, use the async version: atomicWriteJson()
          continue;
        }
        throw renameError;
      }
    }
    
    // If we exhausted retries, throw the last error
    throw lastError || new Error('Failed to rename after retries');
  } catch (error) {
    logger.error(`Failed to atomically write JSON to ${filePath}: ${error}`);
    // Clean up temp file if it exists
    try {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    } catch {
      // Ignore cleanup errors
    }
    return false;
  }
}

/**
 * Atomically write text file to prevent corruption
 * Uses temp file + rename strategy for atomic operation
 * Windows-safe: deletes target file before rename if needed, with retry logic for race conditions
 * Note: Retries are immediate (no backoff delay). For proper exponential backoff, use atomicWriteText()
 * Ideal for JSONL, logs, and other text content where atomic writes prevent corruption
 */
export function atomicWriteTextSync(filePath: string, content: string): boolean {
  const tempFile = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  const maxRetries = 3;
  let lastError: any;
  
  try {
    // Write to temp file first
    fs.writeFileSync(tempFile, content, 'utf-8');
    
    // Retry logic to handle race conditions on Windows
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // On Windows, rename fails if target exists - delete it first
        if (process.platform === 'win32' && fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        
        // Atomic rename (replaces existing file on Unix, now safe on Windows)
        fs.renameSync(tempFile, filePath);
        return true;
      } catch (renameError) {
        const err = renameError as { code?: string };
        // On Windows, retry if another process created the file between unlink and rename
        if (process.platform === 'win32' && err.code === 'EEXIST' && attempt < maxRetries - 1) {
          lastError = renameError;
          // Immediate retry (no delay in sync version to avoid CPU-wasting busy-wait)
          // For proper exponential backoff, use the async version: atomicWriteText()
          continue;
        }
        throw renameError;
      }
    }
    
    // If we exhausted retries, throw the last error
    throw lastError || new Error('Failed to rename after retries');
  } catch (error) {
    logger.error(`Failed to atomically write text to ${filePath}: ${error}`);
    // Clean up temp file if it exists
    try {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    } catch {
      // Ignore cleanup errors
    }
    return false;
  }
}

/**
 * Async version of safe JSON read
 */
export async function safeReadJson<T>(filePath: string, defaultValue: T): Promise<T> {
  try {
    const raw = await fsPromises.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (error) {
    const err = error as { code?: string };
    if (err.code !== 'ENOENT') {
      logger.warn(`Failed to read JSON from ${filePath}: ${error}`);
    }
    return defaultValue;
  }
}

/**
 * Async version of safe JSON write
 */
export async function safeWriteJson<T>(filePath: string, data: T): Promise<boolean> {
  try {
    await fsPromises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (error) {
    logger.error(`Failed to write JSON to ${filePath}: ${error}`);
    return false;
  }
}

/**
 * Async atomic write for JSON files
 * Uses temp file + rename strategy for atomic operation
 * Windows-safe: deletes target file before rename if needed, with retry logic for race conditions
 */
export async function atomicWriteJson<T>(filePath: string, data: T): Promise<boolean> {
  const tempFile = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  const maxRetries = 3;
  let lastError: any;
  
  try {
    // Write to temp file first
    await fsPromises.writeFile(tempFile, JSON.stringify(data, null, 2), 'utf-8');
    
    // Retry logic to handle race conditions on Windows
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // On Windows, rename fails if target exists - delete it first
        if (process.platform === 'win32') {
          try {
            await fsPromises.unlink(filePath);
          } catch (unlinkError) {
            const err = unlinkError as { code?: string };
            // ENOENT is OK (file doesn't exist yet), other errors should fail
            if (err.code !== 'ENOENT') {
              throw unlinkError;
            }
          }
        }
        
        // Atomic rename (replaces existing file on Unix, now safe on Windows)
        await fsPromises.rename(tempFile, filePath);
        return true;
      } catch (renameError) {
        const err = renameError as { code?: string };
        // On Windows, retry if another process created the file between unlink and rename
        if (process.platform === 'win32' && err.code === 'EEXIST' && attempt < maxRetries - 1) {
          lastError = renameError;
          // Brief exponential backoff: 10ms, 20ms, 40ms
          await new Promise(resolve => setTimeout(resolve, 10 * Math.pow(2, attempt)));
          continue;
        }
        throw renameError;
      }
    }
    
    // If we exhausted retries, throw the last error
    throw lastError || new Error('Failed to rename after retries');
  } catch (error) {
    logger.error(`Failed to atomically write JSON to ${filePath}: ${error}`);
    // Clean up temp file if it exists
    try {
      await fsPromises.unlink(tempFile);
    } catch (cleanupError) {
      const err = cleanupError as { code?: string };
      // Only ignore ENOENT errors (file already gone)
      if (err.code !== 'ENOENT') {
        logger.warn(`Failed to clean up temp file ${tempFile}: ${cleanupError}`);
      }
    }
    return false;
  }
}

/**
 * Async atomic write for text files
 * Uses temp file + rename strategy for atomic operation
 * Windows-safe: deletes target file before rename if needed, with retry logic for race conditions
 * Ideal for JSONL, logs, and other text content where atomic writes prevent corruption
 */
export async function atomicWriteText(filePath: string, content: string): Promise<boolean> {
  const tempFile = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  const maxRetries = 3;
  let lastError: any;
  
  try {
    // Write to temp file first
    await fsPromises.writeFile(tempFile, content, 'utf-8');
    
    // Retry logic to handle race conditions on Windows
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // On Windows, rename fails if target exists - delete it first
        if (process.platform === 'win32') {
          try {
            await fsPromises.unlink(filePath);
          } catch (unlinkError) {
            const err = unlinkError as { code?: string };
            // ENOENT is OK (file doesn't exist yet), other errors should fail
            if (err.code !== 'ENOENT') {
              throw unlinkError;
            }
          }
        }
        
        // Atomic rename (replaces existing file on Unix, now safe on Windows)
        await fsPromises.rename(tempFile, filePath);
        return true;
      } catch (renameError) {
        const err = renameError as { code?: string };
        // On Windows, retry if another process created the file between unlink and rename
        if (process.platform === 'win32' && err.code === 'EEXIST' && attempt < maxRetries - 1) {
          lastError = renameError;
          // Brief exponential backoff: 10ms, 20ms, 40ms
          await new Promise(resolve => setTimeout(resolve, 10 * Math.pow(2, attempt)));
          continue;
        }
        throw renameError;
      }
    }
    
    // If we exhausted retries, throw the last error
    throw lastError || new Error('Failed to rename after retries');
  } catch (error) {
    logger.error(`Failed to atomically write text to ${filePath}: ${error}`);
    // Clean up temp file if it exists
    try {
      await fsPromises.unlink(tempFile);
    } catch (cleanupError) {
      const err = cleanupError as { code?: string };
      // Only ignore ENOENT errors (file already gone)
      if (err.code !== 'ENOENT') {
        logger.warn(`Failed to clean up temp file ${tempFile}: ${cleanupError}`);
      }
    }
    return false;
  }
}

/**
 * Safely append to a file with error handling
 */
export function safeAppendFileSync(filePath: string, content: string): boolean {
  try {
    fs.appendFileSync(filePath, content, 'utf-8');
    return true;
  } catch (error) {
    logger.error(`Failed to append to ${filePath}: ${error}`);
    return false;
  }
}

/**
 * Async version of safe append
 */
export async function safeAppendFile(filePath: string, content: string): Promise<boolean> {
  try {
    await fsPromises.appendFile(filePath, content, 'utf-8');
    return true;
  } catch (error) {
    logger.error(`Failed to append to ${filePath}: ${error}`);
    return false;
  }
}

/**
 * Read last N lines from a file efficiently without loading entire file
 * Reads backwards in chunks until enough lines are found
 * Returns empty array if file doesn't exist (common case for new/rotated logs)
 */
export async function readLastLines(filePath: string, lineCount: number): Promise<string[]> {
  try {
    const stat = await fsPromises.stat(filePath);
    const fileSize = stat.size;
    
    if (fileSize === 0) {
      return [];
    }
    
    const fd = await fsPromises.open(filePath, 'r');
    try {
      const chunkSize = 4096; // Read 4KB chunks
      let bytesToRead = Math.min(chunkSize, fileSize);
      let position = fileSize - bytesToRead;
      let allContent = '';
      let lines: string[] = [];
      
      // Read backwards in chunks until we have enough lines or reach start of file
      while (lines.length < lineCount && position >= 0) {
        const buffer = Buffer.alloc(bytesToRead);
        const { bytesRead } = await fd.read(buffer, 0, bytesToRead, position);
        
        // Prepend new content to what we've read so far
        allContent = buffer.toString('utf-8', 0, bytesRead) + allContent;
        lines = allContent.split('\n').filter(line => line.trim());
        
        // If we've reached the start of the file, we're done
        if (position === 0) {
          break;
        }
        
        // Move backwards for next chunk
        bytesToRead = Math.min(chunkSize, position);
        position -= bytesToRead;
      }
      
      await fd.close();
      
      // Return the last N lines
      return lines.slice(-lineCount);
    } catch (error) {
      await fd.close();
      throw error;
    }
  } catch (error) {
    const err = error as { code?: string };
    // Don't log errors for missing files - this is normal for new/rotated logs
    if (err.code !== 'ENOENT') {
      logger.error(`Failed to read last lines from ${filePath}: ${error}`);
    }
    return [];
  }
}

/**
 * Count lines in a file without loading it entirely
 */
export async function countLines(filePath: string): Promise<number> {
  try {
    // Check if file exists first
    if (!fs.existsSync(filePath)) {
      return 0;
    }

    const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    let count = 0;
    let partial = '';
    
    return new Promise((resolve) => {
      stream.on('data', (chunk: string) => {
        partial += chunk;
        const lines = partial.split('\n');
        partial = lines.pop() || '';
        count += lines.length;
      });
      
      stream.on('end', () => {
        if (partial) count++;
        resolve(count);
      });
      
      stream.on('error', (error) => {
        logger.error(`Failed to count lines in ${filePath}: ${error}`);
        resolve(0); // Return 0 on error
      });
    });
  } catch (error) {
    logger.error(`Failed to count lines in ${filePath}: ${error}`);
    return 0;
  }
}
