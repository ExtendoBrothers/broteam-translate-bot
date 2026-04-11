// Jest setup file
// Add any global test setup here

/// <reference types="jest" />

import * as path from 'path';
import * as fs from 'fs';

// Set global Jest timeout
jest.setTimeout(30000);

// Mock environment variables for tests
process.env.NODE_ENV = 'test';

// Mock console methods to reduce noise during tests
global.console = {
  ...console,
  // Keep log and warn for debugging, but suppress info/debug in tests
  info: jest.fn(),
  debug: jest.fn(),
};

// Worker isolation for parallel test execution
// Generate unique temp directory per Jest worker
const workerId = process.env.JEST_WORKER_ID || '1';
export const TEST_TEMP_DIR = path.join(process.cwd(), '.test-temp', `worker-${workerId}`);

// Helper to get worker-specific file paths
export function getTestFilePath(filename: string): string {
  return path.join(TEST_TEMP_DIR, filename);
}

// Create temp directory before tests start
beforeAll(() => {
  if (!fs.existsSync(TEST_TEMP_DIR)) {
    fs.mkdirSync(TEST_TEMP_DIR, { recursive: true });
  }
});

// Clean up temp directory after all tests complete
afterAll(() => {
  try {
    if (fs.existsSync(TEST_TEMP_DIR)) {
      fs.rmSync(TEST_TEMP_DIR, { recursive: true, force: true });
    }
  } catch (e) {
    // Ignore cleanup errors (Windows file locking, etc.)
  }
});
