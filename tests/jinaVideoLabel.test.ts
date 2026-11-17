jest.mock('../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../src/utils/rateLimitTracker', () => ({
  rateLimitTracker: { isRateLimited: jest.fn(() => false), setCooldown: jest.fn() },
}));

import { fetchTweetsFromJina } from '../src/twitter/jinaFetch';

describe('Jina video labels', () => {
  afterEach(() => jest.restoreAllMocks());

  it('removes scraped video labels without removing actual tweet text', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response([
      'A post about Video games [Video 5](blob:https://x.com/video)',
      '[![Image](https://example.com/image)](https://x.com/BroTeamPills/status/2034015079503737310/photo/1)',
    ].join('\n')));

    const tweets = await fetchTweetsFromJina('BroTeamPills');

    expect(tweets.map(tweet => tweet.text)).toEqual(['A post about Video games']);
  });
});
