import { candidateStore, isAutoPostEligible } from './candidateStore';
import { BrowserPublisher } from './browserPublisher';
import { isContentDuplicateSync } from '../utils/contentDeduplication';
import { recordSuccessfulPost } from '../utils/duplicatePrevention';
import { postTracker } from '../utils/postTracker';
import { rateLimitTracker } from '../utils/rateLimitTracker';
import { logger } from '../utils/logger';
import { splitTweet } from '../utils/tweetSplitter';
import { getLanguageQualityIssue } from '../translator/languageQuality';

const POLL_INTERVAL_MS = 30_000;
const BROWSER_POST_INTERVAL_SECONDS = 30;
const BROWSER_POST_LIMIT_24H = 50;
const BROWSER_POST_LIMIT_30M = 10;
let status = 'Automatic posting is disabled';

export function getAutomaticPostingStatus(): string {
  return status;
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
    if (postTracker.getPostCount24h() >= BROWSER_POST_LIMIT_24H ||
        postTracker.getPostCount30m() >= BROWSER_POST_LIMIT_30M ||
        rateLimitTracker.isRateLimited('post')) return;

    const item = candidateStore.list('ready').find(entry => isAutoPostEligible(entry));
    if (!item) return;
    const index = item.candidates.findIndex(candidate => candidate.isBestCandidate);
    const candidate = item.candidates[index];
    if (!candidate || candidate.error || !candidate.result.trim() || candidate.acceptabilityWarnings?.length) {
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

    if (isContentDuplicateSync(candidate.result)) {
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
      if (!candidateStore.finishAutoPost(item.id, 'blocked', message)) {
        logger.error(`[AutomaticPoster] Could not persist blocked state for ${item.id}`);
      }
      logger.error(`[AutomaticPoster] ${item.id}: ${message}`);
      return;
    }

    let confirmed = false;
    try {
      if (this.stopping ||
          partCount + postTracker.getPostCount24h() > BROWSER_POST_LIMIT_24H ||
          partCount + postTracker.getPostCount30m() > BROWSER_POST_LIMIT_30M ||
          rateLimitTracker.isRateLimited('post') || isContentDuplicateSync(candidate.result) ||
          !candidateStore.beginAutoPost(item.id, index)) {
        logger.warn(`[AutomaticPoster] ${item.id} changed or could not be reserved; not posting`);
        return;
      }
      await this.publisher.publish(page);
      confirmed = true;
    } catch (err) {
      const message = `Posting outcome uncertain: ${err}. Check X before confirming or dismissing this item; it will not be retried automatically.`;
      if (!candidateStore.finishAutoPost(item.id, 'uncertain', message)) {
        logger.error(`[AutomaticPoster] Could not persist uncertain state for ${item.id}`);
      }
      for (let i = 0; i < partCount; i++) postTracker.recordPost();
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
      recordSuccessfulPost(item.tweet.id, candidate.result);
      for (let i = 1; i < partCount; i++) postTracker.recordPost();
      rateLimitTracker.setCooldown('post', BROWSER_POST_INTERVAL_SECONDS, 'automatic browser post spacing');
      logger.info(`[AutomaticPoster] Posted ${item.id}; awaiting dashboard preference`);
    }
  }
}
