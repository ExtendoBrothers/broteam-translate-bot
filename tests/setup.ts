// Jest setup file
// Add any global test setup here

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