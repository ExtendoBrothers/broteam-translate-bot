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
