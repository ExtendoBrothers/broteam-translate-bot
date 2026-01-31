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
 */
export async function readLastLines(filePath: string, lineCount: number): Promise<string[]> {
  try {
    const stat = await fsPromises.stat(filePath);
    const fileSize = stat.size;
    
    // Estimate bytes to read (assume average 100 chars per line)
    const estimatedBytes = Math.min(lineCount * 100, fileSize);
    const buffer = Buffer.alloc(estimatedBytes);
    
    const fd = await fsPromises.open(filePath, 'r');
    try {
      const { bytesRead } = await fd.read(buffer, 0, estimatedBytes, fileSize - estimatedBytes);
      await fd.close();
      
      const content = buffer.toString('utf-8', 0, bytesRead);
      const lines = content.split('\n').filter(line => line.trim());
      
      return lines.slice(-lineCount);
    } catch (error) {
      await fd.close();
      throw error;
    }
  } catch (error) {
    logger.error(`Failed to read last lines from ${filePath}: ${error}`);
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
