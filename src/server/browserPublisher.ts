/* global document */
import * as path from 'path';
import puppeteer, { Browser, Page, TimeoutError } from 'puppeteer-core';
import { config } from '../config';
import { splitTweet } from '../utils/tweetSplitter';
import { connectToFirefox } from './firefoxConnection';

const PROFILE = path.join(process.cwd(), '.automatic-browser-profile');
const EDITORS = '[data-testid^="tweetTextarea_"]';

function isXPage(page: Page): boolean {
  return /^https:\/\/(?:www\.)?(?:x|twitter)\.com(?::443)?(?:[/?#]|$)/i.test(page.url());
}

export class BrowserPublisher {
  private browser?: Browser;
  private loginPage?: Page;
  private ownsLoginPage = false;
  private attached = false;

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
      return page;
    } catch (error) {
      await page.close();
      throw error;
    }
  }

  async publish(page: Page): Promise<void> {
    await page.waitForSelector('[data-testid="tweetButton"]', { visible: true, timeout: 10_000 });
    await Promise.all([
      page.waitForFunction(() => {
        const toast = document.querySelector('[data-testid="toast"]');
        return !!toast && /your posts? (?:was|were) (?:sent|posted)/i.test(toast.textContent || '');
      }, { timeout: 30_000 }),
      page.click('[data-testid="tweetButton"]'),
    ]);
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
