/**
 * Memory-efficient log file reader using streams
 * Prevents loading large files entirely into memory
 */

import * as fs from 'fs';
import * as readline from 'readline';
import { logger } from './logger';

/**
 * Read log file line by line with a callback
 */
export async function processLogFileLines(
  filePath: string,
  // eslint-disable-next-line no-unused-vars
  processor: (line: string) => boolean | Promise<boolean>
): Promise<number> {
  if (!fs.existsSync(filePath)) {
    return 0;
  }

  let processedCount = 0;

  try {
    const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    for await (const line of rl) {
      if (line.trim()) {
        const shouldContinue = await processor(line);
        processedCount++;
        
        if (!shouldContinue) {
          rl.close();
          fileStream.destroy();
          break;
        }
      }
    }

    return processedCount;
  } catch (error) {
    logger.error(`Failed to process log file ${filePath}: ${error}`);
    return processedCount;
  }
}

/**
 * Get unique items from a log file without loading everything into memory
 */
export async function getUniqueLogEntries(
  filePath: string,
  maxEntries: number = 1000
): Promise<Set<string>> {
  const uniqueEntries = new Set<string>();

  await processLogFileLines(filePath, (line) => {
    uniqueEntries.add(line);
    return uniqueEntries.size < maxEntries;
  });

  return uniqueEntries;
}

/**
 * Search for a pattern in a log file without loading it entirely
 */
export async function searchLogFile(
  filePath: string,
  pattern: RegExp | string,
  maxMatches: number = 100
): Promise<string[]> {
  const matches: string[] = [];
  const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;

  await processLogFileLines(filePath, (line) => {
    if (regex.test(line)) {
      matches.push(line);
    }
    return matches.length < maxMatches;
  });

  return matches;
}

/**
 * Prune log file by keeping only the last N lines
 * More memory efficient than loading entire file
 */
export async function pruneLogFileLines(
  filePath: string,
  keepLastN: number
): Promise<boolean> {
  try {
    if (!fs.existsSync(filePath)) {
      return true;
    }

    const tempFile = `${filePath}.tmp`;
    const lines: string[] = [];
    
    // Read file and collect last N lines
    await processLogFileLines(filePath, (line) => {
      lines.push(line);
      if (lines.length > keepLastN) {
        lines.shift(); // Remove oldest line
      }
      return true;
    });

    // Write pruned content to temp file
    const writeStream = fs.createWriteStream(tempFile, { encoding: 'utf-8' });
    for (const line of lines) {
      writeStream.write(line + '\n');
    }
    writeStream.end();

    await new Promise<void>((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    // Replace original file with pruned version
    fs.renameSync(tempFile, filePath);
    
    logger.info(`Pruned ${filePath} to ${lines.length} lines`);
    return true;
  } catch (error) {
    logger.error(`Failed to prune log file ${filePath}: ${error}`);
    return false;
  }
}
