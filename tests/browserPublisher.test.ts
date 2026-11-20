jest.mock('puppeteer-core', () => ({
  __esModule: true,
  default: { connect: jest.fn(), launch: jest.fn() },
  TimeoutError: class TimeoutError extends Error {},
}));
jest.mock('../src/server/firefoxConnection', () => ({ connectToFirefox: jest.fn() }));

import * as path from 'path';
import puppeteer, { Browser, TimeoutError } from 'puppeteer-core';
import { config } from '../src/config';
import { BrowserPublisher } from '../src/server/browserPublisher';
import { connectToFirefox } from '../src/server/firefoxConnection';
import { splitTweet } from '../src/utils/tweetSplitter';

describe('browser publisher', () => {
  const originalEndpoint = config.AUTOMATIC_BROWSER_WS_ENDPOINT;
  const endpoint = 'ws://127.0.0.1:9222/session';
  let publisher: BrowserPublisher;
  let chunks: string[];
  let page: {
    goto: jest.Mock; waitForSelector: jest.Mock; waitForFunction: jest.Mock;
    $$: jest.Mock; click: jest.Mock; keyboard: { type: jest.Mock };
    close: jest.Mock; isClosed: jest.Mock; url: jest.Mock;
  };
  let browser: {
    connected: boolean; defaultBrowserContext: jest.Mock; newPage: jest.Mock; close: jest.Mock; disconnect: jest.Mock;
  };
  let pages: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    config.AUTOMATIC_BROWSER_WS_ENDPOINT = endpoint;
    chunks = [];
    let activeEditor = 0;
    page = {
      goto: jest.fn(async (url: string) => {
        if (url.includes('/intent/tweet')) chunks[0] = new URL(url).searchParams.get('text') || '';
      }),
      waitForSelector: jest.fn(),
      waitForFunction: jest.fn(),
      $$: jest.fn(async () => Array.from({ length: Math.max(1, chunks.length + 1) }, (_, i) => ({
        evaluate: jest.fn(async () => chunks[i]),
        click: jest.fn(async () => { activeEditor = i; }),
      }))),
      click: jest.fn(),
      keyboard: { type: jest.fn(async (text: string) => { chunks[activeEditor] = text; }) },
      close: jest.fn(),
      isClosed: jest.fn(() => false),
      url: jest.fn(() => 'https://x.com/home'),
    };
    pages = jest.fn(async () => []);
    browser = {
      connected: true, defaultBrowserContext: jest.fn(() => ({ pages })), newPage: jest.fn(async () => page),
      close: jest.fn(), disconnect: jest.fn(),
    };
    jest.mocked(connectToFirefox).mockResolvedValue(browser as unknown as Browser);
    jest.mocked(puppeteer.launch).mockResolvedValue(browser as unknown as Browser);
    publisher = new BrowserPublisher();
  });

  afterEach(() => { config.AUTOMATIC_BROWSER_WS_ENDPOINT = originalEndpoint; });

  it('attaches to Firefox, composes a thread and disconnects without closing the browser', async () => {
    expect(await publisher.isLoggedIn()).toBe(true);
    expect(connectToFirefox).toHaveBeenCalledWith(endpoint);
    const text = 'A long translation with several words. '.repeat(12);
    const expected = splitTweet(text);
    expect(expected.length).toBeGreaterThan(1);
    const composer = await publisher.prepare(text);
    expect(chunks).toEqual(expected);
    expect(page.click).toHaveBeenCalledTimes(expected.length - 1);
    await publisher.publish(composer);
    expect(page.click).toHaveBeenCalledWith('[data-testid="tweetButton"]');
    expect(page.waitForFunction).toHaveBeenCalled();
    const waits = page.waitForFunction.mock.invocationCallOrder;
    const clicks = page.click.mock.invocationCallOrder;
    expect(waits[waits.length - 1]).toBeLessThan(clicks[clicks.length - 1]);
    await publisher.close();
    expect(browser.disconnect).toHaveBeenCalledTimes(1);
    expect(browser.close).not.toHaveBeenCalled();
  });

  it('launches and closes the dedicated Chrome browser when no endpoint is configured', async () => {
    config.AUTOMATIC_BROWSER_WS_ENDPOINT = '';
    await publisher.isLoggedIn();
    expect(puppeteer.launch).toHaveBeenCalledWith({
      channel: 'chrome', userDataDir: path.join(process.cwd(), '.automatic-browser-profile'), headless: false,
    });
    await publisher.close();
    expect(browser.close).toHaveBeenCalledTimes(1);
    expect(browser.disconnect).not.toHaveBeenCalled();
  });

  it('reuses an existing X tab for repeated login checks without navigating or closing it', async () => {
    pages.mockResolvedValue([page]);
    expect(await publisher.isLoggedIn()).toBe(true);
    expect(await publisher.isLoggedIn()).toBe(true);
    expect(browser.newPage).not.toHaveBeenCalled();
    expect(page.goto).not.toHaveBeenCalled();
    await publisher.close();
    expect(page.close).not.toHaveBeenCalled();
    expect(browser.disconnect).toHaveBeenCalledTimes(1);
  });

  it('does not use a lookalike or closed tab as an X login tab', async () => {
    pages.mockResolvedValue([
      { url: () => 'https://x.com.example.org/', isClosed: () => false },
      { url: () => 'https://x.com/home', isClosed: () => true },
    ]);
    await publisher.isLoggedIn();
    expect(browser.newPage).toHaveBeenCalledTimes(1);
    expect(page.goto).toHaveBeenCalledWith('https://x.com/home', { waitUntil: 'domcontentloaded' });
    await publisher.close();
    expect(page.close).toHaveBeenCalledTimes(1);
  });

  it('rejects remote browser endpoints', async () => {
    config.AUTOMATIC_BROWSER_WS_ENDPOINT = 'ws://example.com:9222/session';
    await expect(publisher.isLoggedIn()).rejects.toThrow('must be a local');
    expect(connectToFirefox).not.toHaveBeenCalled();
  });

  it('reports a missing login and rejects unsplittable text', async () => {
    page.waitForSelector.mockRejectedValueOnce(new TimeoutError('not visible'));
    expect(await publisher.isLoggedIn()).toBe(false);
    await expect(publisher.prepare('x'.repeat(500))).rejects.toThrow('cannot be safely split');
    expect(browser.newPage).toHaveBeenCalledTimes(1);
    await publisher.close();
  });
});
