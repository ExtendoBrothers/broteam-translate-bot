jest.mock('../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../src/utils/rateLimitTracker', () => ({
  rateLimitTracker: {
    isRateLimited: jest.fn(() => false),
    setCooldown: jest.fn(),
  },
}));

import { fetchFromNitterInstances } from '../src/twitter/nitterScraper';
import { rateLimitTracker } from '../src/utils/rateLimitTracker';

describe('fetchFromNitterInstances', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('tries the next instance after a failed response and parses its RSS', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
      .mockResolvedValueOnce(new Response(
        '<?xml version="1.0"?><rss><channel><item>' +
        '<link>https://nitter.gq/BroTeamPills/status/2034015079503737310</link>' +
        '<description><![CDATA[An example &amp; a tweet]]></description>' +
        '</item></channel></rss>',
      ));

    const tweets = await fetchFromNitterInstances('BroTeamPills');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('https://xitter.cf/BroTeamPills/with_replies/rss');
    expect(fetchMock.mock.calls[1][0]).toBe('https://nitter.gq/BroTeamPills/with_replies/rss');
    expect(tweets).toHaveLength(1);
    expect(tweets[0]).toMatchObject({
      id: '2034015079503737310',
      text: 'An example & a tweet',
      user: { username: 'BroTeamPills' },
    });
    expect(rateLimitTracker.setCooldown).toHaveBeenCalledWith(
      'nitter-scraper', 600, 'post-fetch cooldown',
    );
  });

  it('restores reply recipients and removes a sole self-reply recipient', async () => {
    const item = (id: string, title: string, text: string) =>
      `<item><title>${title}</title><link>https://xitter.cf/BroTeamPills/status/${id}</link>` +
      `<description><![CDATA[<p>${text}</p>]]></description></item>`;
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response(
      '<?xml version="1.0"?><rss><channel>' +
      item('2034015079503737310', 'R to @Example: Hello', 'Hello there') +
      item('2034015079503737311', 'R to @broteampills: Hello', '@BroTeamPills Hello again') +
      item('2034015079503737312', 'R to @BroTeamPills: Hello', '@Example Hello both') +
      item('2034015079503737313', 'Original tweet', '@BroTeamPills hello everyone') +
      '<item><title>RT by @BroTeamPills: Another user</title>' +
      '<link>https://xitter.cf/SomeoneElse/status/2034015079503737314</link>' +
      '<description><![CDATA[Another user tweet]]></description></item>' +
      '</channel></rss>',
    ));

    const tweets = await fetchFromNitterInstances('BroTeamPills');

    expect(tweets.map(tweet => tweet.text)).toEqual([
      '@Example Hello there', 'Hello again', '@BroTeamPills @Example Hello both',
      '@BroTeamPills hello everyone',
    ]);
  });

  it('falls back to the original RSS feed when replies feeds are unavailable', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('unavailable', { status: 403 }))
      .mockResolvedValueOnce(new Response('unavailable', { status: 403 }))
      .mockResolvedValueOnce(new Response('unavailable', { status: 403 }))
      .mockResolvedValueOnce(new Response('unavailable', { status: 403 }))
      .mockResolvedValueOnce(new Response('unavailable', { status: 403 }))
      .mockResolvedValueOnce(new Response('unavailable', { status: 403 }))
      .mockResolvedValueOnce(new Response('unavailable', { status: 403 }))
      .mockResolvedValueOnce(new Response(
        '<?xml version="1.0"?><rss><channel><item>' +
        '<link>https://xitter.cf/BroTeamPills/status/2034015079503737310</link>' +
        '<description><![CDATA[An original tweet]]></description></item></channel></rss>',
      ));

    const tweets = await fetchFromNitterInstances('BroTeamPills');

    expect(fetchMock.mock.calls[7][0]).toBe('https://xitter.cf/BroTeamPills/rss');
    expect(tweets.map(tweet => tweet.text)).toEqual(['An original tweet']);
  });
});
