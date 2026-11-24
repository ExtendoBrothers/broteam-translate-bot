/* global document */
import * as path from 'path';
import puppeteer, { Browser, HTTPResponse, Page, TimeoutError } from 'puppeteer-core';
import { config } from '../config';
import { splitTweet } from '../utils/tweetSplitter';
import { logger } from '../utils/logger';
import { connectToFirefox } from './firefoxConnection';

const PROFILE = path.join(process.cwd(), '.automatic-browser-profile');
const EDITORS = '[data-testid^="tweetTextarea_"]';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function createdPost(response: HTTPResponse): Promise<{ id: string; text: string } | undefined> {
  const url = new URL(response.url());
  if (url.protocol !== 'https:' || !/^(?:www\.)?(?:x|twitter)\.com$/i.test(url.hostname) ||
      !/^\/i\/api\/graphql\/[^/]+\/CreateTweet$/.test(url.pathname) ||
      response.request().method() !== 'POST') return undefined;
  if (!response.ok()) {
    logger.warn(`[BrowserPublisher] X creation request returned HTTP ${response.status()}`);
    return undefined;
  }

  const rawBody = await response.request().fetchPostData();
  if (!rawBody) {
    logger.warn('[BrowserPublisher] X creation request body was unavailable for confirmation');
    return undefined;
  }
  const body: unknown = JSON.parse(rawBody);
  const payload: unknown = await response.json();
  if (!isRecord(body) || !isRecord(body.variables) || typeof body.variables.tweet_text !== 'string' ||
      !isRecord(payload) || (payload.errors !== undefined &&
        (!Array.isArray(payload.errors) || payload.errors.length > 0)) ||
      !isRecord(payload.data) || !isRecord(payload.data.create_tweet) ||
      !isRecord(payload.data.create_tweet.tweet_results) ||
      !isRecord(payload.data.create_tweet.tweet_results.result)) {
    logger.warn('[BrowserPublisher] X creation response did not contain a successful post result');
    return undefined;
  }
  const id = payload.data.create_tweet.tweet_results.result.rest_id;
  if (typeof id !== 'string' || !/^\d+$/.test(id)) {
    logger.warn('[BrowserPublisher] X creation response did not contain a valid post ID');
    return undefined;
  }
  return { id, text: body.variables.tweet_text };
}

function isXPage(page: Page): boolean {
  return /^https:\/\/(?:www\.)?(?:x|twitter)\.com(?::443)?(?:[/?#]|$)/i.test(page.url());
}

export class BrowserPublisher {
  private browser?: Browser;
  private loginPage?: Page;
  private ownsLoginPage = false;
  private attached = false;
  private readonly preparedChunks = new WeakMap<Page, string[]>();

  async isLoggedIn(): Promise<boolean> {
    if (!this.browser?.connected) {
      const endpoint = config.AUTOMATIC_BROWSER_WS_ENDPOINT;
      if (endpoint) {
        const url = new URL(endpoint);
        if (url.protocol !== 'ws:' || url.hostname !== '127.0.0.1' || url.pathname !== '/session') {
          throw new Error('AUTOMATIC_BROWSER_WS_ENDPOINT must be a local ws://127.0.0.1:<port>/session URL');
        }
        this.browser = await connectToFirefox(endpoint);
        this.attached = true;
      } else {
        this.browser = await puppeteer.launch({
          channel: 'chrome',
          userDataDir: PROFILE,
          headless: false,
        });
        this.attached = false;
      }
      this.loginPage = undefined;
      this.ownsLoginPage = false;
    }

    if (!this.loginPage || this.loginPage.isClosed() || !isXPage(this.loginPage)) {
      if (this.loginPage && this.ownsLoginPage && !this.loginPage.isClosed()) {
        await this.loginPage.close();
      }
      this.loginPage = undefined;
      this.ownsLoginPage = false;
      const existingPage = this.attached
        ? (await this.browser.defaultBrowserContext().pages()).find(page => !page.isClosed() && isXPage(page))
        : undefined;
      if (existingPage) {
        this.loginPage = existingPage;
      } else {
        const page = await this.browser.newPage();
        try {
          await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded' });
          this.loginPage = page;
          this.ownsLoginPage = true;
        } catch (error) {
          await page.close();
          throw error;
        }
      }
    }

    try {
      await this.loginPage.waitForSelector('[data-testid="SideNav_AccountSwitcher_Button"]', {
        visible: true, timeout: 3000,
      });
      return true;
    } catch (error) {
      if (error instanceof TimeoutError) return false;
      throw error;
    }
  }

  async prepare(text: string): Promise<Page> {
    if (!this.browser?.connected) throw new Error('Browser is not open');
    const chunks = splitTweet(text);
    if (!chunks.length || chunks.some(chunk => chunk.length > 280)) {
      throw new Error('Translation cannot be safely split into posts of at most 280 characters');
    }

    const page = await this.browser.newPage();
    try {
      await page.goto(`https://twitter.com/intent/tweet?text=${encodeURIComponent(chunks[0])}`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForSelector(EDITORS, { visible: true, timeout: 30_000 });
      let editors = await page.$$(EDITORS);
      if ((await editors[0].evaluate(el => (el as HTMLElement).innerText)).trim() !== chunks[0].trim()) {
        throw new Error('Twitter composer did not preserve the intended text');
      }

      for (let i = 1; i < chunks.length; i++) {
        await page.waitForSelector('[data-testid="addButton"]', { visible: true, timeout: 10_000 });
        await page.click('[data-testid="addButton"]');
        await page.waitForFunction((selector, count) => document.querySelectorAll(selector).length >= count,
          { timeout: 10_000 }, EDITORS, i + 1);
        editors = await page.$$(EDITORS);
        await editors[i].click();
        await page.keyboard.type(chunks[i]);
        if ((await editors[i].evaluate(el => (el as HTMLElement).innerText)).trim() !== chunks[i].trim()) {
          throw new Error(`Twitter composer did not preserve thread part ${i + 1}`);
        }
      }
      this.preparedChunks.set(page, chunks);
      return page;
    } catch (error) {
      await page.close();
      throw error;
    }
  }

  async publish(page: Page): Promise<void> {
    const chunks = this.preparedChunks.get(page);
    if (!chunks) throw new Error('Browser composer was not prepared by this publisher');
    await page.waitForSelector('[data-testid="tweetButton"]', { visible: true, timeout: 10_000 });
    const controller = new AbortController();
    const remaining = [...chunks];
    const postIds = new Set<string>();
    let finished = false;
    let resolveConfirmation: () => void = () => {};
    const confirmation = new Promise<void>(resolve => {
      resolveConfirmation = resolve;
    });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutResult = new Promise<void>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new TimeoutError('Post confirmation timed out after 30000ms')), 30_000);
    });
    const onResponse = (response: HTTPResponse): void => {
      void createdPost(response).then(post => {
        if (finished || !post || postIds.has(post.id)) return;
        const index = remaining.indexOf(post.text);
        if (index < 0) return;
        postIds.add(post.id);
        remaining.splice(index, 1);
        if (remaining.length === 0) {
          logger.info('[BrowserPublisher] Confirmed post from X creation responses');
          resolveConfirmation();
        }
      }).catch(error => {
        if (!finished) logger.warn(`[BrowserPublisher] Could not inspect X creation response: ${error}`);
      });
    };
    page.on('response', onResponse);
    void page.waitForFunction((isThread: boolean) => {
      const toast = document.querySelector('[data-testid="toast"]');
      const text = toast?.textContent || '';
      return isThread
        ? /your posts were (?:sent|posted)/i.test(text)
        : /your posts? (?:was|were) (?:sent|posted)/i.test(text);
    }, { timeout: 30_000, signal: controller.signal }, chunks.length > 1).then(() => {
      if (!finished) resolveConfirmation();
    }).catch(error => {
      if (!finished) logger.warn(`[BrowserPublisher] Could not observe post confirmation message: ${error}`);
    });
    try {
      await Promise.all([Promise.race([confirmation, timeoutResult]), page.click('[data-testid="tweetButton"]')]);
    } finally {
      finished = true;
      clearTimeout(timeout);
      controller.abort();
      page.off('response', onResponse);
      this.preparedChunks.delete(page);
    }
  }

  async close(): Promise<void> {
    const browser = this.browser;
    const page = this.loginPage;
    const ownsPage = this.ownsLoginPage;
    this.browser = undefined;
    this.loginPage = undefined;
    this.ownsLoginPage = false;
    if (!browser?.connected) return;
    if (this.attached) {
      try {
        if (ownsPage && page && !page.isClosed()) await page.close();
      } finally {
        await browser.disconnect();
      }
    } else {
      await browser.close();
    }
  }
}
