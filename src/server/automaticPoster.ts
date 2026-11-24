import { candidateStore, isAutoPostEligible } from './candidateStore';
import { BrowserPublisher, UnsafeComposerError } from './browserPublisher';
import { areContentsDuplicate, isContentDuplicateSync } from '../utils/contentDeduplication';
import { recordSuccessfulPost } from '../utils/duplicatePrevention';
import { postTracker } from '../utils/postTracker';
import { rateLimitTracker } from '../utils/rateLimitTracker';
import { logger } from '../utils/logger';
import { splitTweet } from '../utils/tweetSplitter';
import { getLanguageQualityIssue } from '../translator/languageQuality';
import { isAcceptable } from '../workers/candidateGenerator';
import { isSpammyResult } from '../utils/spamFilter';

const POLL_INTERVAL_MS = 30_000;
const BROWSER_POST_INTERVAL_SECONDS = 30;
const BROWSER_POST_LIMIT_24H = 50;
const BROWSER_POST_LIMIT_30M = 10;
let status = 'Automatic posting is disabled';

export function getAutomaticPostingStatus(): string {
  return status;
}

export function reconcileAutomaticPosts(): boolean {
  for (const item of candidateStore.list()) {
    const attempt = item.autoPostAttempt;
    if (!attempt) continue;
    if (!postTracker.reserveAutomaticAttempt(item.id, attempt.timestamp, attempt.partCount) ||
        (!item.autoPostAccounted && !candidateStore.markAutoPostAccounted(item.id))) {
      logger.error(`[AutomaticPoster] Could not reconcile post accounting for ${item.id}`);
      return false;
    }
    if (item.autoPostState === 'posted' && !item.autoPostRecorded) {
      if (!recordSuccessfulPost(item.tweet.id, attempt.content, false, true) ||
          !candidateStore.markAutoPostRecorded(item.id)) {
        logger.error(`[AutomaticPoster] Could not reconcile posted content for ${item.id}`);
        return false;
      }
    }
  }
  return true;
}

export class AutomaticPoster {
  private timer?: ReturnType<typeof setInterval>;
  private active?: Promise<void>;
  private stopping = false;
  private readonly publisher: BrowserPublisher;

  constructor(publisher = new BrowserPublisher()) {
    this.publisher = publisher;
  }

  start(): void {
    status = 'Automatic posting is waiting for eligible items';
    this.run();
    this.timer = setInterval(() => this.run(), POLL_INTERVAL_MS);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.publisher.close();
    await this.active;
    await this.publisher.close();
  }

  private run(): void {
    if (this.stopping || this.active) return;
    this.active = this.processNext()
      .catch(err => {
        status = `Automatic posting error: ${err}`;
        logger.error(`[AutomaticPoster] Processing failed: ${err}`);
      })
      .finally(() => { this.active = undefined; });
  }

  private async processNext(): Promise<void> {
    if (process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true') {
      status = 'Dry run: automatic posting is disabled';
      return;
    }
    if (!reconcileAutomaticPosts()) {
      status = 'Automatic posting paused: unable to reconcile previous attempts';
      return;
    }
    const dailyCount = postTracker.getPostCount24h();
    const recentCount = postTracker.getPostCount30m();
    if (postTracker.getStorageError()) {
      status = `Automatic posting paused: ${postTracker.getStorageError()}`;
      logger.error(`[AutomaticPoster] ${status}`);
      return;
    }
    if (dailyCount >= BROWSER_POST_LIMIT_24H ||
        recentCount >= BROWSER_POST_LIMIT_30M ||
        rateLimitTracker.isRateLimited('post')) return;

    const item = candidateStore.list('ready').find(entry => isAutoPostEligible(entry));
    if (!item) return;
    const index = item.candidates.findIndex(candidate => candidate.isBestCandidate);
    const candidate = item.candidates[index];
    if (!candidate || candidate.error || !candidate.result.trim() || candidate.acceptabilityWarnings?.length ||
        (candidate.acceptabilityWarnings === undefined &&
          (!isAcceptable(candidate.result, item.tweet.text).acceptable || isSpammyResult(candidate.result)))) {
      const message = 'Best candidate failed the quality gate; manual review required.';
      if (!candidateStore.finishAutoPost(item.id, 'blocked', message)) {
        logger.error(`[AutomaticPoster] Could not persist blocked state for ${item.id}`);
      }
      logger.warn(`[AutomaticPoster] ${item.id}: ${message}`);
      return;
    }

    const languageIssue = getLanguageQualityIssue(candidate.result, item.tweet.text);
    if (languageIssue) {
      const message = `${languageIssue}; manual review required.`;
      if (!candidateStore.finishAutoPost(item.id, 'blocked', message)) {
        logger.error(`[AutomaticPoster] Could not persist blocked state for ${item.id}`);
      }
      logger.warn(`[AutomaticPoster] ${item.id}: ${message}`);
      return;
    }

    const isDuplicate = () => isContentDuplicateSync(candidate.result) ||
      candidateStore.list('ready').some(entry =>
        entry.id !== item.id && (entry.autoPostState === 'posting' || entry.autoPostState === 'uncertain') &&
        entry.postedCandidateIndex !== undefined &&
        !!entry.candidates[entry.postedCandidateIndex] &&
        areContentsDuplicate(candidate.result, entry.candidates[entry.postedCandidateIndex].result));

    if (isDuplicate()) {
      const message = 'Best candidate duplicates previously posted content; manual review required.';
      if (!candidateStore.finishAutoPost(item.id, 'blocked', message)) {
        logger.error(`[AutomaticPoster] Could not persist blocked state for ${item.id}`);
      }
      logger.warn(`[AutomaticPoster] ${item.id}: ${message}`);
      return;
    }

    const partCount = splitTweet(candidate.result).length;
    if (partCount > BROWSER_POST_LIMIT_30M) {
      const message = 'Thread exceeds the 30-minute posting limit; manual review required.';
      if (!candidateStore.finishAutoPost(item.id, 'blocked', message)) {
        logger.error(`[AutomaticPoster] Could not persist blocked state for ${item.id}`);
      }
      logger.warn(`[AutomaticPoster] ${item.id}: ${message}`);
      return;
    }
    if (partCount + postTracker.getPostCount24h() > BROWSER_POST_LIMIT_24H ||
        partCount + postTracker.getPostCount30m() > BROWSER_POST_LIMIT_30M) {
      status = 'Waiting for enough posting slots for the thread';
      return;
    }
    if (!await this.publisher.isLoggedIn()) {
      status = 'Sign in to X in the browser tab to enable automatic posting';
      logger.warn(`[AutomaticPoster] ${status}`);
      return;
    }
    status = 'Automatic posting is active';

    let page;
    try {
      page = await this.publisher.prepare(candidate.result);
    } catch (err) {
      if (this.stopping) return;
      const message = `Could not prepare browser composer: ${err}`;
      if (err instanceof UnsafeComposerError) {
        if (!candidateStore.finishAutoPost(item.id, 'blocked', message)) {
          logger.error(`[AutomaticPoster] Could not persist blocked state for ${item.id}`);
        }
      } else {
        status = `${message}; will retry later`;
      }
      logger.error(`[AutomaticPoster] ${item.id}: ${message}`);
      return;
    }

    let confirmed = false;
    try {
      if (this.stopping ||
          partCount + postTracker.getPostCount24h() > BROWSER_POST_LIMIT_24H ||
          partCount + postTracker.getPostCount30m() > BROWSER_POST_LIMIT_30M ||
          postTracker.getStorageError() || rateLimitTracker.isRateLimited('post') || isDuplicate() ||
          !candidateStore.beginAutoPost(item.id, index, partCount)) {
        logger.warn(`[AutomaticPoster] ${item.id} changed or could not be reserved; not posting`);
        return;
      }
      const attempt = item.autoPostAttempt;
      if (!attempt || !postTracker.reserveAutomaticAttempt(item.id, attempt.timestamp, attempt.partCount) ||
          !candidateStore.markAutoPostAccounted(item.id)) {
        throw new Error('Could not persist automatic post accounting');
      }
      await this.publisher.publish(page);
      confirmed = true;
    } catch (err) {
      const message = `Posting outcome uncertain: ${err}. Check X before confirming or dismissing this item; it will not be retried automatically.`;
      if (!candidateStore.finishAutoPost(item.id, 'uncertain', message)) {
        logger.error(`[AutomaticPoster] Could not persist uncertain state for ${item.id}`);
      }
      rateLimitTracker.setCooldown('post', BROWSER_POST_INTERVAL_SECONDS, 'uncertain automatic browser post');
      logger.error(`[AutomaticPoster] ${item.id}: ${message}`);
    } finally {
      if (!page.isClosed()) {
        await page.close().catch(err => logger.warn(`[AutomaticPoster] Could not close composer: ${err}`));
      }
    }

    if (confirmed) {
      if (!candidateStore.finishAutoPost(item.id, 'posted')) {
        logger.error(`[AutomaticPoster] Posted ${item.id}, but could not persist confirmation; check Twitter after restart`);
      }
      if (!recordSuccessfulPost(item.tweet.id, candidate.result, false, true) ||
          !candidateStore.markAutoPostRecorded(item.id)) {
        logger.error(`[AutomaticPoster] Could not persist posted content for ${item.id}; will reconcile`);
      }
      rateLimitTracker.setCooldown('post', BROWSER_POST_INTERVAL_SECONDS, 'automatic browser post spacing');
      logger.info(`[AutomaticPoster] Posted ${item.id}; awaiting dashboard preference`);
    }
  }
}
