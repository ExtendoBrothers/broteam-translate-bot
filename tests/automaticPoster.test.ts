jest.mock('../src/server/candidateStore', () => ({
  MAX_AUTO_POST_RETRIES: 10,
  isAutoPostEligible: jest.fn((item: { status: string; autoPostState?: string }) =>
    item.status === 'ready' && !item.autoPostState),
  candidateStore: {
    list: jest.fn(), beginAutoPost: jest.fn(), finishAutoPost: jest.fn(),
  },
}));
jest.mock('../src/server/browserPublisher', () => ({ BrowserPublisher: jest.fn() }));
jest.mock('../src/utils/contentDeduplication', () => ({ isContentDuplicateSync: jest.fn() }));
jest.mock('../src/utils/duplicatePrevention', () => ({ recordSuccessfulPost: jest.fn() }));
jest.mock('../src/utils/postTracker', () => ({
  postTracker: { getPostCount24h: jest.fn(), getPostCount30m: jest.fn(), recordPost: jest.fn() },
}));
jest.mock('../src/utils/rateLimitTracker', () => ({
  rateLimitTracker: { isRateLimited: jest.fn(), setCooldown: jest.fn() },
}));
jest.mock('../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { AutomaticPoster } from '../src/server/automaticPoster';
import { BrowserPublisher } from '../src/server/browserPublisher';
import { candidateStore, isAutoPostEligible } from '../src/server/candidateStore';
import { recordSuccessfulPost } from '../src/utils/duplicatePrevention';
import { postTracker } from '../src/utils/postTracker';
import { rateLimitTracker } from '../src/utils/rateLimitTracker';
import { TimeoutError } from 'puppeteer-core';

describe('automatic poster', () => {
  const page = { isClosed: jest.fn(() => false), close: jest.fn() };
  const publisher = {
    isLoggedIn: jest.fn(), prepare: jest.fn(), publish: jest.fn(), close: jest.fn(),
  };
  const item = {
    id: 'queue', tweet: { id: 'tweet', text: 'Original tweet' }, status: 'ready', candidates: [
      { result: 'first', isBestCandidate: false },
      { result: 'best', isBestCandidate: true },
    ],
  };
  let poster: AutomaticPoster;
  const oldDryRun = process.env.DRY_RUN;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    delete process.env.DRY_RUN;
    jest.mocked(postTracker.getPostCount24h).mockReturnValue(0);
    jest.mocked(postTracker.getPostCount30m).mockReturnValue(0);
    jest.mocked(rateLimitTracker.isRateLimited).mockReturnValue(false);
    jest.mocked(candidateStore.list).mockReturnValue([item as ReturnType<typeof candidateStore.list>[number]]);
    jest.mocked(candidateStore.beginAutoPost).mockReturnValue(true);
    jest.mocked(candidateStore.finishAutoPost).mockReturnValue(true);
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
    expect(candidateStore.beginAutoPost).toHaveBeenCalledWith('queue', 1);
    expect(publisher.publish).toHaveBeenCalledWith(page);
    expect(candidateStore.finishAutoPost).toHaveBeenCalledWith('queue', 'posted');
    expect(recordSuccessfulPost).toHaveBeenCalledWith('tweet', 'best');
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

  it('marks a failed click or unconfirmed post uncertain instead of retrying', async () => {
    publisher.publish.mockRejectedValueOnce(new Error('confirmation timed out'));
    poster.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(candidateStore.finishAutoPost).toHaveBeenCalledWith(
      'queue', 'uncertain', expect.stringContaining('Check Twitter'), undefined,
    );
    expect(recordSuccessfulPost).not.toHaveBeenCalled();
    expect(rateLimitTracker.setCooldown).toHaveBeenCalledWith(
      'post', 30, 'uncertain automatic browser post',
    );
  });

  it('schedules a bounded retry for a confirmation timeout', async () => {
    publisher.publish.mockRejectedValueOnce(new TimeoutError('Waiting failed: 30000ms exceeded'));
    poster.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(candidateStore.finishAutoPost).toHaveBeenCalledWith(
      'queue', 'uncertain', expect.stringContaining('Automatic retry 1/10'),
      new Date(Date.now() + 30_000).toISOString(),
    );
    expect(recordSuccessfulPost).not.toHaveBeenCalled();
  });

  it('stops retrying after ten retries', async () => {
    jest.mocked(candidateStore.list).mockReturnValue([{
      ...item, autoPostRetryCount: 10,
    } as ReturnType<typeof candidateStore.list>[number]]);
    publisher.publish.mockRejectedValueOnce(new TimeoutError('Waiting failed: 30000ms exceeded'));
    poster.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(candidateStore.finishAutoPost).toHaveBeenCalledWith(
      'queue', 'uncertain', expect.stringContaining('Check Twitter'), undefined,
    );
  });

  it('retries a timed-out post on the next eligible polling interval', async () => {
    const retryItem = { ...item, autoPostState: undefined as string | undefined, autoPostRetryCount: 0, postedCandidateIndex: 1 };
    jest.mocked(candidateStore.list).mockReturnValue([retryItem as ReturnType<typeof candidateStore.list>[number]]);
    jest.mocked(isAutoPostEligible).mockReturnValueOnce(true).mockReturnValueOnce(true);
    const reserve = () => {
      if (retryItem.autoPostState === 'uncertain') retryItem.autoPostRetryCount++;
      retryItem.autoPostState = 'posting';
      return true;
    };
    jest.mocked(candidateStore.beginAutoPost).mockImplementationOnce(reserve).mockImplementationOnce(reserve);
    jest.mocked(candidateStore.finishAutoPost).mockImplementationOnce(() => {
      retryItem.autoPostState = 'uncertain';
      return true;
    }).mockImplementationOnce((_id, state) => {
      retryItem.autoPostState = state;
      return true;
    });

    publisher.publish.mockRejectedValueOnce(new TimeoutError('Waiting failed: 30000ms exceeded'));
    poster.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(publisher.publish).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(30_000);
    expect(publisher.publish).toHaveBeenCalledTimes(2);
    expect(candidateStore.finishAutoPost).toHaveBeenLastCalledWith('queue', 'posted');
    expect(retryItem.autoPostRetryCount).toBe(1);
  });

  it('retries the previously attempted candidate even if the best candidate changes', async () => {
    jest.mocked(candidateStore.list).mockReturnValue([{
      ...item, autoPostState: 'uncertain', postedCandidateIndex: 0,
    } as ReturnType<typeof candidateStore.list>[number]]);
    jest.mocked(isAutoPostEligible).mockReturnValueOnce(true);
    poster.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(publisher.prepare).toHaveBeenCalledWith('first');
    expect(candidateStore.beginAutoPost).toHaveBeenCalledWith('queue', 0);
  });

  it('posts a new item before an eligible uncertain retry', async () => {
    jest.mocked(candidateStore.list).mockReturnValue([
      { ...item, id: 'retry', autoPostState: 'uncertain', postedCandidateIndex: 1 },
      { ...item, id: 'new' },
    ] as ReturnType<typeof candidateStore.list>);
    jest.mocked(isAutoPostEligible).mockReturnValueOnce(true).mockReturnValueOnce(true);
    poster.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(candidateStore.beginAutoPost).toHaveBeenCalledWith('new', 1);
  });

  it('reserves the last 30-minute slot for a new item instead of consuming it on a retry', async () => {
    const retry = { ...item, id: 'retry', autoPostState: 'uncertain', postedCandidateIndex: 1 };
    jest.mocked(candidateStore.list).mockReturnValue([retry] as ReturnType<typeof candidateStore.list>);
    jest.mocked(isAutoPostEligible).mockReturnValueOnce(true);
    jest.mocked(postTracker.getPostCount30m).mockReturnValue(9);
    poster.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(publisher.prepare).not.toHaveBeenCalled();
    jest.mocked(candidateStore.list).mockReturnValue([
      retry, { ...item, id: 'new' },
    ] as ReturnType<typeof candidateStore.list>);
    jest.mocked(isAutoPostEligible).mockReturnValueOnce(true).mockReturnValueOnce(true);
    await jest.advanceTimersByTimeAsync(30_000);
    expect(candidateStore.beginAutoPost).toHaveBeenCalledWith('new', 1);
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

  it('blocks older queued candidates containing suspicious language before opening the browser', async () => {
    jest.mocked(candidateStore.list).mockReturnValue([{
      ...item, candidates: [{ result: 'Area and personalzuar E-mail.com', isBestCandidate: true }],
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
      ...item, candidates: [{ result: 'word '.repeat(100), isBestCandidate: true }],
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
      ...item, candidates: [{ result: 'word '.repeat(100), isBestCandidate: true }],
    } as ReturnType<typeof candidateStore.list>[number]]);
    jest.mocked(postTracker.getPostCount30m).mockReturnValue(9);
    poster.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(publisher.prepare).not.toHaveBeenCalled();
  });

  it('records each part of a successful thread', async () => {
    jest.mocked(candidateStore.list).mockReturnValue([{
      ...item, candidates: [{ result: 'word '.repeat(100), isBestCandidate: true }],
    } as ReturnType<typeof candidateStore.list>[number]]);
    poster.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(recordSuccessfulPost).toHaveBeenCalledTimes(1);
    expect(postTracker.recordPost).toHaveBeenCalledTimes(1);
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
});
