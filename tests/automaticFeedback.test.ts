import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';

jest.mock('http', () => {
  const actual = jest.requireActual<typeof import('http')>('http');
  return { ...actual, createServer: jest.fn(actual.createServer) };
});
jest.mock('child_process', () => ({ execFile: jest.fn() }));
jest.mock('../src/server/candidateStore', () => ({
  candidateStore: { list: jest.fn(), getById: jest.fn(), selectPreference: jest.fn() },
}));
jest.mock('../src/server/generationQueue', () => ({ generationQueue: { depth: 0 } }));
jest.mock('../src/server/automaticPoster', () => ({ getAutomaticPostingStatus: jest.fn() }));
jest.mock('../src/twitter/fetchTweets', () => ({ fetchTweets: jest.fn() }));
jest.mock('../src/utils/tweetTracker', () => ({ tweetTracker: {} }));
jest.mock('../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../src/utils/spamFilter', () => ({ isSpammyFeedbackEntry: jest.fn(() => false) }));
jest.mock('../src/utils/duplicatePrevention', () => ({ recordSuccessfulPost: jest.fn() }));
jest.mock('../src/utils/languageWeights', () => ({ recordPositives: jest.fn() }));
jest.mock('../src/utils/heuristicEvaluator', () => ({ updateWeightsFromFeedback: jest.fn() }));
jest.mock('../src/utils/translationLogEmitter', () => ({
  translationLogEmitter: new (require('events').EventEmitter)(),
}));

import { candidateStore, QueueItem } from '../src/server/candidateStore';
import { recordSuccessfulPost } from '../src/utils/duplicatePrevention';
import { recordPositives } from '../src/utils/languageWeights';
import { updateWeightsFromFeedback } from '../src/utils/heuristicEvaluator';

describe('automatic posting feedback', () => {
  let baseUrl: string;
  let stopServer: () => Promise<void>;
  let tempDir: string;
  let item: QueueItem;
  const oldPort = process.env.DASHBOARD_PORT;
  const oldPassword = process.env.DASHBOARD_PASSWORD;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'broteam-feedback-test-'));
    jest.spyOn(process, 'cwd').mockReturnValue(tempDir);
    process.env.DASHBOARD_PORT = '0';
    process.env.DASHBOARD_PASSWORD = '';
    const dashboard = require('../src/server/dashboardServer') as typeof import('../src/server/dashboardServer');
    stopServer = dashboard.stopDashboardServer;
    dashboard.startDashboardServer();
    const server = jest.mocked(http.createServer).mock.results[0].value as http.Server;
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Dashboard did not bind');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise(resolve => setTimeout(resolve, 200));
    await stopServer();
    jest.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (oldPort === undefined) delete process.env.DASHBOARD_PORT;
    else process.env.DASHBOARD_PORT = oldPort;
    if (oldPassword === undefined) delete process.env.DASHBOARD_PASSWORD;
    else process.env.DASHBOARD_PASSWORD = oldPassword;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    item = {
      id: 'queue', tweet: { id: 'tweet', text: 'Original', createdAt: '2026-01-01', user: { id: 'u', username: 'u', displayName: 'U' } },
      fetchedAt: '2026-01-01', status: 'posted', autoPostState: 'posted', postedCandidateIndex: 0,
      candidates: [
        { chainIndex: 0, chainLabel: 'Bot', languages: ['ja'], result: 'Posted', humorScore: 0.8, heuristicOffset: 0, finalScore: 0.8, isBestCandidate: true },
        { chainIndex: 1, chainLabel: 'Human', languages: ['fr'], result: 'Preferred', humorScore: 0.5, heuristicOffset: 0, finalScore: 0.5, isBestCandidate: false },
      ],
    };
    jest.mocked(candidateStore.getById).mockReturnValue(item);
    jest.mocked(candidateStore.list).mockReturnValue([item]);
    jest.mocked(candidateStore.selectPreference).mockImplementation((_id, index) => {
      item.preferredCandidateIndex = index;
      item.preferredAt = new Date().toISOString();
      return true;
    });
  });

  it('keeps the posted item visible and records a different preference without recording another post', async () => {
    const queue = await (await fetch(`${baseUrl}/api/queue`)).json() as { items: QueueItem[] };
    expect(queue.items).toHaveLength(1);
    const response = await fetch(`${baseUrl}/api/queue/queue/preference/1`, { method: 'POST' });
    expect(response.status).toBe(200);
    const feedback = JSON.parse(fs.readFileSync(path.join(tempDir, 'feedback-data.jsonl'), 'utf8').trim());
    expect(feedback).toMatchObject({ botSelected: 'Bot', postedResult: 'Posted', userSelected: 'Human', selectedResult: 'Preferred' });
    expect(recordPositives).toHaveBeenCalledWith(['fr']);
    expect(updateWeightsFromFeedback).toHaveBeenCalled();
    expect(recordSuccessfulPost).not.toHaveBeenCalled();
    const repeat = await fetch(`${baseUrl}/api/queue/queue/preference/1`, { method: 'POST' });
    expect(repeat.status).toBe(409);
    const after = await (await fetch(`${baseUrl}/api/queue`)).json() as { items: QueueItem[] };
    expect(after.items).toHaveLength(0);
  });

  it('retries a saved feedback entry without duplicating it or changing the preference', async () => {
    item.id = 'retry';
    jest.mocked(candidateStore.selectPreference).mockReturnValueOnce(false);
    const first = await fetch(`${baseUrl}/api/queue/retry/preference/1`, { method: 'POST' });
    expect(first.status).toBe(500);
    const different = await fetch(`${baseUrl}/api/queue/retry/preference/0`, { method: 'POST' });
    expect(different.status).toBe(500);
    const retry = await fetch(`${baseUrl}/api/queue/retry/preference/1`, { method: 'POST' });
    expect(retry.status).toBe(200);
    const entries = fs.readFileSync(path.join(tempDir, 'feedback-data.jsonl'), 'utf8')
      .trim().split('\n').map(line => JSON.parse(line) as { queueItemId: string });
    expect(entries.filter(entry => entry.queueItemId === 'retry')).toHaveLength(1);
    expect(item.preferredCandidateIndex).toBe(1);
  });
});
