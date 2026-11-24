import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../src/utils/duplicatePrevention', () => ({ recordSuccessfulPost: jest.fn(() => true) }));
jest.mock('../src/utils/contentDeduplication', () => ({
  isContentDuplicateSync: jest.fn(), areContentsDuplicate: jest.fn(),
}));
jest.mock('../src/server/browserPublisher', () => ({ BrowserPublisher: jest.fn() }));
jest.mock('../src/workers/candidateGenerator', () => ({ isAcceptable: jest.fn() }));
jest.mock('../src/utils/rateLimitTracker', () => ({ rateLimitTracker: {} }));

describe('automatic posting recovery', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'broteam-recovery-'));
    jest.spyOn(process, 'cwd').mockReturnValue(tempDir);
    jest.resetModules();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('replays a reservation and confirmed-content tracking exactly once across restarts', () => {
    let store = require('../src/server/candidateStore').candidateStore as typeof import('../src/server/candidateStore').candidateStore;
    store.initialize();
    const id = store.add({
      id: 'tweet', text: 'Original tweet', createdAt: new Date(),
      user: { id: 'u', username: 'u', displayName: 'U' },
    });
    store.setReady(id, [{
      chainIndex: 0, chainLabel: 'Best', languages: [], result: 'Translated text',
      humorScore: 0, heuristicOffset: 0, finalScore: 0, isBestCandidate: true,
    }]);
    expect(store.beginAutoPost(id, 0, 2)).toBe(true);

    jest.resetModules();
    store = require('../src/server/candidateStore').candidateStore;
    store.initialize();
    let tracker = require('../src/utils/postTracker').postTracker as typeof import('../src/utils/postTracker').postTracker;
    let reconcile = require('../src/server/automaticPoster').reconcileAutomaticPosts as typeof import('../src/server/automaticPoster').reconcileAutomaticPosts;
    expect(store.getById(id)?.autoPostState).toBe('uncertain');
    expect(reconcile()).toBe(true);
    expect(tracker.getPostCount24h()).toBe(2);
    expect(store.confirmUncertainPost(id)).toBe(true);

    jest.resetModules();
    store = require('../src/server/candidateStore').candidateStore;
    store.initialize();
    tracker = require('../src/utils/postTracker').postTracker;
    reconcile = require('../src/server/automaticPoster').reconcileAutomaticPosts;
    const record = require('../src/utils/duplicatePrevention').recordSuccessfulPost as jest.Mock;
    expect(reconcile()).toBe(true);
    expect(tracker.getPostCount24h()).toBe(2);
    expect(record).toHaveBeenCalledWith('tweet', 'Translated text', false, true);
    expect(store.getById(id)?.autoPostRecorded).toBe(true);

    jest.resetModules();
    store = require('../src/server/candidateStore').candidateStore;
    store.initialize();
    tracker = require('../src/utils/postTracker').postTracker;
    reconcile = require('../src/server/automaticPoster').reconcileAutomaticPosts;
    const recordAgain = require('../src/utils/duplicatePrevention').recordSuccessfulPost as jest.Mock;
    expect(reconcile()).toBe(true);
    expect(tracker.getPostCount24h()).toBe(2);
    expect(recordAgain).not.toHaveBeenCalled();
  });

  it('durably records recovered content without appending duplicates', () => {
    const workerId = process.env.JEST_WORKER_ID;
    const directory = workerId ? path.join(tempDir, '.test-temp', `worker-${workerId}`) : tempDir;
    fs.mkdirSync(directory, { recursive: true });
    const { logPostedContent } = jest.requireActual<typeof import('../src/utils/contentDeduplication')>(
      '../src/utils/contentDeduplication',
    );
    expect(logPostedContent('tweet', 'Translated text', true)).toBe(true);
    expect(logPostedContent('tweet', 'Translated text', true)).toBe(true);
    const lines = fs.readFileSync(path.join(directory, 'posted-outputs.log'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({ tweetId: 'tweet', content: 'Translated text' });
  });
});
