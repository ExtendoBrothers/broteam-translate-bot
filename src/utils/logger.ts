import { createLogger, format, transports } from 'winston';

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