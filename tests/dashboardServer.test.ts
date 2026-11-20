import * as http from 'http';

jest.mock('http', () => {
  const actual = jest.requireActual<typeof import('http')>('http');
  return { ...actual, createServer: jest.fn(actual.createServer) };
});

jest.mock('../src/server/candidateStore', () => ({
  candidateStore: { list: jest.fn(), add: jest.fn(() => 'new-item') },
}));
jest.mock('../src/server/generationQueue', () => ({
  generationQueue: { enqueue: jest.fn(), depth: 0 },
}));
jest.mock('../src/twitter/fetchTweets', () => ({ fetchTweets: jest.fn() }));
jest.mock('../src/utils/tweetTracker', () => ({
  tweetTracker: { shouldProcess: jest.fn(() => true), markProcessed: jest.fn() },
}));
jest.mock('../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../src/utils/spamFilter', () => ({ isSpammyFeedbackEntry: jest.fn() }));
jest.mock('../src/utils/duplicatePrevention', () => ({ recordSuccessfulPost: jest.fn() }));
jest.mock('../src/utils/languageWeights', () => ({ recordPositives: jest.fn() }));
jest.mock('../src/utils/heuristicEvaluator', () => ({ updateWeightsFromFeedback: jest.fn() }));
jest.mock('../src/utils/translationLogEmitter', () => ({
  translationLogEmitter: new (require('events').EventEmitter)(),
}));

import { candidateStore, QueueStatus } from '../src/server/candidateStore';
import { generationQueue } from '../src/server/generationQueue';
import { tweetTracker } from '../src/utils/tweetTracker';

describe('manual queue submission', () => {
  let baseUrl: string;
  let stopServer: () => Promise<void>;
  const originalPort = process.env.DASHBOARD_PORT;
  const originalPassword = process.env.DASHBOARD_PASSWORD;

  beforeAll(async () => {
    process.env.DASHBOARD_PORT = '0';
    process.env.DASHBOARD_PASSWORD = '';
    const dashboard = require('../src/server/dashboardServer') as typeof import('../src/server/dashboardServer');
    stopServer = dashboard.stopDashboardServer;
    dashboard.startDashboardServer();
    const server = jest.mocked(http.createServer).mock.results[0].value as http.Server;
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Dashboard did not bind a TCP port');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await stopServer();
    if (originalPort === undefined) delete process.env.DASHBOARD_PORT;
    else process.env.DASHBOARD_PORT = originalPort;
    if (originalPassword === undefined) delete process.env.DASHBOARD_PASSWORD;
    else process.env.DASHBOARD_PASSWORD = originalPassword;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each<QueueStatus>(['posted', 'skipped'])('allows matching text from a %s item', async status => {
    const item = { id: 'old-item', status, tweet: { text: 'Example text' } };
    jest.mocked(candidateStore.list).mockImplementation(filter => {
      const statuses = Array.isArray(filter) ? filter : [filter];
      return statuses.includes(item.status) ? [item as ReturnType<typeof candidateStore.list>[number]] : [];
    });

    const response = await fetch(`${baseUrl}/api/queue/submit`, {
      method: 'POST',
      body: JSON.stringify({ text: ' example   text ' }),
    });

    expect(response.status).toBe(201);
    expect(generationQueue.enqueue).toHaveBeenCalledTimes(1);
  });

  it.each<QueueStatus>(['generating', 'ready'])('rejects matching text in a %s item', async status => {
    const item = { id: 'active-item', status, tweet: { text: 'Example text' } };
    jest.mocked(candidateStore.list).mockImplementation(filter => {
      const statuses = Array.isArray(filter) ? filter : [filter];
      return statuses.includes(item.status) ? [item as ReturnType<typeof candidateStore.list>[number]] : [];
    });

    const response = await fetch(`${baseUrl}/api/queue/submit`, {
      method: 'POST',
      body: JSON.stringify({ text: ' example   text ' }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: 'Duplicate text already in queue', existingId: 'active-item',
    });
    expect(generationQueue.enqueue).not.toHaveBeenCalled();
  });

  it('still rejects an already-processed tweet ID', async () => {
    jest.mocked(tweetTracker.shouldProcess).mockReturnValueOnce(false);
    const response = await fetch(`${baseUrl}/api/queue/submit`, {
      method: 'POST',
      body: JSON.stringify({ text: 'Example text', id: '123' }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'Tweet already processed', id: '123' });
  });
});
