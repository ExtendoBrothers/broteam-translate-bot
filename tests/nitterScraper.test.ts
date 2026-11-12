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
    expect(fetchMock.mock.calls[0][0]).toBe('https://xitter.cf/BroTeamPills/rss');
    expect(fetchMock.mock.calls[1][0]).toBe('https://nitter.gq/BroTeamPills/rss');
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
});
