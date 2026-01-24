import { createLogger, format, transports } from 'winston';
import * as fs from 'fs';
import * as path from 'path';

export const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp(),
    format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level}]: ${message}`;
    })
  ),
  transports: [
    new transports.Console(),
    // Rotate error log by size, keep last 10 files of 5MB each
    new transports.File({ filename: 'error.log', level: 'error', maxsize: 5 * 1024 * 1024, maxFiles: 10, tailable: true }),
    // Rotate combined log by size, keep last 10 files of 10MB each
    new transports.File({ filename: 'combined.log', maxsize: 10 * 1024 * 1024, maxFiles: 10, tailable: true })
  ],
});

export const logInfo = (message: string) => {
  logger.info(message);
};

export const logError = (message: string) => {
  logger.error(message);
};

/**
 * Rotate a log file if it exceeds maxSize bytes, keeping all rotated files (no deletion)
 */
export function rotateLogFile(logPath: string, maxSize: number) {
  try {
    if (!fs.existsSync(logPath)) return;

    const stat = fs.statSync(logPath);
    if (stat.size < maxSize) return;

    // Find the highest numbered rotated file
    let highest = 0;
    for (let i = 1; ; i++) {
      if (fs.existsSync(`${logPath}.${i}`)) {
        highest = i;
      } else {
        break;
      }
    }

    // Rotate existing files from highest down to 1
    for (let i = highest; i >= 1; i--) {
      const oldFile = `${logPath}.${i}`;
      const newFile = `${logPath}.${i + 1}`;
      fs.renameSync(oldFile, newFile);
    }

    // Rename current to .1
    fs.renameSync(logPath, `${logPath}.1`);
  } catch (error) {
    logger.error(`Failed to rotate log file ${logPath}: ${error}`);
  }
}