jest.mock('../src/server/candidateStore', () => ({
  isAutoPostEligible: jest.fn((item: { status: string; autoPostState?: string }) =>
    item.status === 'ready' && !item.autoPostState),
  candidateStore: {
    list: jest.fn(), beginAutoPost: jest.fn(), finishAutoPost: jest.fn(),
    markAutoPostAccounted: jest.fn(), markAutoPostRecorded: jest.fn(),
  },
}));
jest.mock('../src/server/browserPublisher', () => ({
  BrowserPublisher: jest.fn(),
  UnsafeComposerError: class UnsafeComposerError extends Error {},
}));
jest.mock('../src/utils/contentDeduplication', () => ({
  isContentDuplicateSync: jest.fn(),
  areContentsDuplicate: jest.fn((first: string, second: string) => first === second),
}));
jest.mock('../src/utils/duplicatePrevention', () => ({ recordSuccessfulPost: jest.fn() }));
jest.mock('../src/utils/postTracker', () => ({
  postTracker: { getPostCount24h: jest.fn(), getPostCount30m: jest.fn(), getStorageError: jest.fn(),
    reserveAutomaticAttempt: jest.fn(), recordPost: jest.fn() },
}));
jest.mock('../src/utils/rateLimitTracker', () => ({
  rateLimitTracker: { isRateLimited: jest.fn(), setCooldown: jest.fn() },
}));
jest.mock('../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { AutomaticPoster, reconcileAutomaticPosts } from '../src/server/automaticPoster';
import { BrowserPublisher } from '../src/server/browserPublisher';
import { candidateStore, QueueItem } from '../src/server/candidateStore';
import { recordSuccessfulPost } from '../src/utils/duplicatePrevention';
import { postTracker } from '../src/utils/postTracker';
import { rateLimitTracker } from '../src/utils/rateLimitTracker';
import { TimeoutError } from 'puppeteer-core';

describe('automatic poster', () => {
  const page = { isClosed: jest.fn(() => false), close: jest.fn() };
  const publisher = {
    isLoggedIn: jest.fn(), prepare: jest.fn(), publish: jest.fn(), close: jest.fn(),
  };
  const item: QueueItem = {
    id: 'queue', fetchedAt: '2026-01-01', status: 'ready',
    tweet: { id: 'tweet', text: 'Original tweet', createdAt: '2026-01-01', user: { id: 'u', username: 'u', displayName: 'U' } },
    candidates: [
      { chainIndex: 0, chainLabel: 'First', languages: [], humorScore: 0, heuristicOffset: 0, finalScore: 0,
        result: 'first', isBestCandidate: false, acceptabilityWarnings: [] },
      { chainIndex: 1, chainLabel: 'Best', languages: [], humorScore: 0, heuristicOffset: 0, finalScore: 0,
        result: 'best', isBestCandidate: true, acceptabilityWarnings: [] },
    ],
  };
  let poster: AutomaticPoster;
  const oldDryRun = process.env.DRY_RUN;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    delete process.env.DRY_RUN;
    delete item.autoPostAttempt;
    delete item.autoPostAccounted;
    delete item.autoPostRecorded;
    jest.mocked(postTracker.getPostCount24h).mockReturnValue(0);
    jest.mocked(postTracker.getPostCount30m).mockReturnValue(0);
    jest.mocked(rateLimitTracker.isRateLimited).mockReturnValue(false);
    jest.mocked(candidateStore.list).mockReturnValue([item as ReturnType<typeof candidateStore.list>[number]]);
    jest.mocked(candidateStore.beginAutoPost).mockImplementation((id, index, count) => {
      const target = candidateStore.list().find(entry => entry.id === id);
      if (!target) return false;
      target.autoPostAttempt = { timestamp: new Date().toISOString(), partCount: count, content: target.candidates[index].result };
      return true;
    });
    jest.mocked(candidateStore.finishAutoPost).mockReturnValue(true);
    jest.mocked(candidateStore.markAutoPostAccounted).mockImplementation(id => {
      const target = candidateStore.list().find(entry => entry.id === id);
      if (target) target.autoPostAccounted = true;
      return !!target;
    });
    jest.mocked(candidateStore.markAutoPostRecorded).mockImplementation(id => {
      const target = candidateStore.list().find(entry => entry.id === id);
      if (target) target.autoPostRecorded = true;
      return !!target;
    });
    jest.mocked(postTracker.reserveAutomaticAttempt).mockReturnValue(true);
    jest.mocked(recordSuccessfulPost).mockReturnValue(true);
    publisher.isLoggedIn.mockResolvedValue(true);
    publisher.prepare.mockResolvedValue(page);
    publisher.publish.mockResolvedValue(undefined);
    publisher.close.mockResolvedValue(undefined);
    page.close.mockResolvedValue(undefined);
    poster = new AutomaticPoster(publisher as unknown as BrowserPublisher);
  });

  afterEach(async () => {
    await poster.stop();
    jest.useRealTimers();
    if (oldDryRun === undefined) delete process.env.DRY_RUN;
    else process.env.DRY_RUN = oldDryRun;
  });

  it('reserves and posts the best candidate, recording only the actual post', async () => {
    poster.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(publisher.prepare).toHaveBeenCalledWith('best');
    expect(candidateStore.beginAutoPost).toHaveBeenCalledWith('queue', 1, 1);
    expect(publisher.publish).toHaveBeenCalledWith(page);
    expect(jest.mocked(postTracker.reserveAutomaticAttempt).mock.invocationCallOrder[0])
      .toBeLessThan(publisher.publish.mock.invocationCallOrder[0]);
    expect(candidateStore.finishAutoPost).toHaveBeenCalledWith('queue', 'posted');
    expect(recordSuccessfulPost).toHaveBeenCalledWith('tweet', 'best', false, true);
    expect(rateLimitTracker.setCooldown).toHaveBeenCalledWith(
      'post', 30, 'automatic browser post spacing',
    );
  });

  it('never clicks when reservation fails or the user is not logged in', async () => {
    publisher.isLoggedIn.mockResolvedValueOnce(false);
    poster.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(publisher.prepare).not.toHaveBeenCalled();
    jest.mocked(candidateStore.beginAutoPost).mockReturnValue(false);
    await jest.advanceTimersByTimeAsync(30_000);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('pauses before posting if quota history is unavailable', async () => {
    jest.mocked(postTracker.getStorageError).mockReturnValueOnce('history unreadable');
    poster.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(publisher.prepare).not.toHaveBeenCalled();
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('retries a transient composer failure without reserving or counting a post', async () => {
    publisher.prepare.mockRejectedValueOnce(new Error('browser unavailable'));
    poster.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(candidateStore.beginAutoPost).not.toHaveBeenCalled();
    expect(candidateStore.finishAutoPost).not.toHaveBeenCalled();
    expect(postTracker.recordPost).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(30_000);
    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });

  it('marks a failed click or unconfirmed post uncertain instead of retrying', async () => {
    publisher.publish.mockRejectedValueOnce(new Error('confirmation timed out'));
    poster.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(candidateStore.finishAutoPost).toHaveBeenCalledWith(
      'queue', 'uncertain', expect.stringContaining('Check X'),
    );
    expect(recordSuccessfulPost).not.toHaveBeenCalled();
    expect(rateLimitTracker.setCooldown).toHaveBeenCalledWith(
      'post', 30, 'uncertain automatic browser post',
    );
  });

  it('does not retry a confirmation timeout on later polling intervals', async () => {
    const uncertainItem = { ...item, autoPostState: undefined as QueueItem['autoPostState'] };
    jest.mocked(candidateStore.list).mockReturnValue([uncertainItem as ReturnType<typeof candidateStore.list>[number]]);
    jest.mocked(candidateStore.finishAutoPost).mockImplementationOnce((_id, state) => {
      uncertainItem.autoPostState = state;
      return true;
    });
    publisher.publish.mockRejectedValueOnce(new TimeoutError('Waiting failed: 30000ms exceeded'));
    poster.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(candidateStore.finishAutoPost).toHaveBeenCalledWith(
      'queue', 'uncertain', expect.stringContaining('will not be retried automatically'),
    );
    await jest.advanceTimersByTimeAsync(120_000);
    expect(publisher.publish).toHaveBeenCalledTimes(1);
    expect(recordSuccessfulPost).not.toHaveBeenCalled();
  });
  it('posts new items while an uncertain item awaits review', async () => {
    jest.mocked(candidateStore.list).mockReturnValue([
      { ...item, id: 'retry', autoPostState: 'uncertain', postedCandidateIndex: 0 },
      { ...item, id: 'new' },
    ] as ReturnType<typeof candidateStore.list>);
    poster.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(candidateStore.beginAutoPost).toHaveBeenCalledWith('new', 1, 1);
  });

  it('blocks content reserved by an uncertain attempt', async () => {
    jest.mocked(candidateStore.list).mockReturnValue([
      { ...item, id: 'uncertain', autoPostState: 'uncertain', postedCandidateIndex: 1 },
      { ...item, id: 'new' },
    ] as ReturnType<typeof candidateStore.list>);
    poster.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(candidateStore.finishAutoPost).toHaveBeenCalledWith(
      'new', 'blocked', expect.stringContaining('duplicates'),
    );
    expect(publisher.prepare).not.toHaveBeenCalled();
  });

  it('leaves unsafe best candidates for manual review', async () => {
    jest.mocked(candidateStore.list).mockReturnValue([{
      ...item, candidates: [{ result: 'bad', isBestCandidate: true, acceptabilityWarnings: ['failed'] }],
    } as ReturnType<typeof candidateStore.list>[number]]);
    poster.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(candidateStore.finishAutoPost).toHaveBeenCalledWith('queue', 'blocked', expect.stringContaining('quality'));
    expect(publisher.isLoggedIn).not.toHaveBeenCalled();
  });

  it('rechecks legacy candidates without quality results before posting', async () => {
    jest.mocked(candidateStore.list).mockReturnValue([{
      ...item, candidates: [{ result: 'https://azerbaijan.com', isBestCandidate: true }],
    } as ReturnType<typeof candidateStore.list>[number]]);
    poster.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(candidateStore.finishAutoPost).toHaveBeenCalledWith('queue', 'blocked', expect.stringContaining('quality'));
    expect(publisher.prepare).not.toHaveBeenCalled();
  });

  it('blocks older queued candidates containing suspicious language before opening the browser', async () => {
    jest.mocked(candidateStore.list).mockReturnValue([{
      ...item, candidates: [{ ...item.candidates[1], result: 'Area and personalzuar E-mail.com' }],
    } as ReturnType<typeof candidateStore.list>[number]]);
    poster.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(candidateStore.finishAutoPost).toHaveBeenCalledWith(
      'queue', 'blocked', expect.stringContaining('personalzuar'),
    );
    expect(publisher.isLoggedIn).not.toHaveBeenCalled();
  });

  it('waits for enough daily slots before posting a thread', async () => {
    jest.mocked(candidateStore.list).mockReturnValue([{
      ...item, candidates: [{ ...item.candidates[1], result: 'word '.repeat(100) }],
    } as ReturnType<typeof candidateStore.list>[number]]);
    jest.mocked(postTracker.getPostCount24h).mockReturnValue(49);
    poster.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(publisher.prepare).not.toHaveBeenCalled();
    expect(candidateStore.beginAutoPost).not.toHaveBeenCalled();
  });

  it.each([
    [50, 0],
    [0, 10],
  ])('waits when the browser posting limit is reached (%i daily, %i per 30 minutes)', async (daily, recent) => {
    jest.mocked(postTracker.getPostCount24h).mockReturnValue(daily);
    jest.mocked(postTracker.getPostCount30m).mockReturnValue(recent);
    poster.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(publisher.prepare).not.toHaveBeenCalled();
    jest.mocked(postTracker.getPostCount24h).mockReturnValue(0);
    jest.mocked(postTracker.getPostCount30m).mockReturnValue(0);
    await jest.advanceTimersByTimeAsync(30_000);
    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });

  it('allows one post when one slot remains in each window', async () => {
    jest.mocked(postTracker.getPostCount24h).mockReturnValue(49);
    jest.mocked(postTracker.getPostCount30m).mockReturnValue(9);
    poster.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });

  it('waits for enough 30-minute slots for every thread part', async () => {
    jest.mocked(candidateStore.list).mockReturnValue([{
      ...item, candidates: [{ ...item.candidates[1], result: 'word '.repeat(100) }],
    } as ReturnType<typeof candidateStore.list>[number]]);
    jest.mocked(postTracker.getPostCount30m).mockReturnValue(9);
    poster.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(publisher.prepare).not.toHaveBeenCalled();
  });

  it('records each part of a successful thread', async () => {
    jest.mocked(candidateStore.list).mockReturnValue([{
      ...item, candidates: [{ ...item.candidates[1], result: 'word '.repeat(100) }],
    } as ReturnType<typeof candidateStore.list>[number]]);
    poster.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(recordSuccessfulPost).toHaveBeenCalledTimes(1);
    expect(postTracker.reserveAutomaticAttempt).toHaveBeenCalledWith('queue', expect.any(String), 2);
  });

  it('rechecks the 30-minute limit before publishing', async () => {
    publisher.prepare.mockImplementation(async () => {
      jest.mocked(postTracker.getPostCount30m).mockReturnValue(10);
      return page;
    });
    poster.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(publisher.publish).not.toHaveBeenCalled();
    expect(page.close).toHaveBeenCalled();
  });

  it('does not click if attempt accounting cannot be persisted', async () => {
    jest.mocked(postTracker.reserveAutomaticAttempt).mockReturnValueOnce(false);
    poster.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(publisher.publish).not.toHaveBeenCalled();
    expect(candidateStore.finishAutoPost).toHaveBeenCalledWith(
      'queue', 'uncertain', expect.stringContaining('accounting'),
    );
  });

  it('reconciles an interrupted confirmed post without double-counting or reposting', () => {
    const recovered: QueueItem = {
      ...item, status: 'posted', autoPostState: 'posted', postedCandidateIndex: 1,
      autoPostAttempt: { timestamp: new Date().toISOString(), partCount: 2, content: 'best' },
    };
    jest.mocked(candidateStore.list).mockReturnValue([recovered]);
    expect(reconcileAutomaticPosts()).toBe(true);
    expect(postTracker.reserveAutomaticAttempt).toHaveBeenCalledWith('queue', recovered.autoPostAttempt!.timestamp, 2);
    expect(recordSuccessfulPost).toHaveBeenCalledWith('tweet', 'best', false, true);
    expect(recovered.autoPostAccounted).toBe(true);
    expect(recovered.autoPostRecorded).toBe(true);
    expect(reconcileAutomaticPosts()).toBe(true);
    expect(recordSuccessfulPost).toHaveBeenCalledTimes(1);
    expect(publisher.publish).not.toHaveBeenCalled();
  });
});
