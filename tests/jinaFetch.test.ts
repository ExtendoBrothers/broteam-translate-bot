jest.mock('../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../src/utils/rateLimitTracker', () => ({
  rateLimitTracker: { isRateLimited: jest.fn(() => false), setCooldown: jest.fn() },
}));

import { fetchTweetsFromJina } from '../src/twitter/jinaFetch';
import { protectTokens, restoreTokens } from '../src/translator/tokenizer';
import { withReplyRecipients } from '../src/twitter/replyText';

describe('Jina replies', () => {
  afterEach(() => jest.restoreAllMocks());

  it('handles punctuation following an existing reply mention', () => {
    expect(withReplyRecipients('@Example, hello', 'BroTeamPills', ['Example'])).toBe('@Example, hello');
    expect(withReplyRecipients('@BroTeamPills, hello', 'BroTeamPills', ['BroTeamPills'])).toBe('hello');
    expect(withReplyRecipients('@Example @Other! hello', 'BroTeamPills', ['Example'])).toBe('@Example @Other! hello');
  });

  it('keeps reply recipients for translation and removes a sole self-recipient', async () => {
    const status = (id: string) =>
      `[![Image](https://example.com/image)](https://x.com/BroTeamPills/status/${id}/photo/1)`;
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response([
      'Replying to @Example',
      'Hello there',
      status('2034015079503737310'),
      'Replying to @broteampills',
      'Hello again',
      status('2034015079503737311'),
      'Replying to @BroTeamPills and @Example',
      'Hello both',
      status('2034015079503737312'),
    ].join('\n')));

    const tweets = await fetchTweetsFromJina('BroTeamPills');

    expect(fetchMock.mock.calls[0][0]).toBe('https://r.jina.ai/https://x.com/BroTeamPills/with_replies');
    expect(tweets.map(tweet => tweet.text)).toEqual([
      '@Example Hello there', 'Hello again', '@BroTeamPills @Example Hello both',
    ]);
    const protectedText = protectTokens(tweets[0].text);
    expect(protectedText).not.toContain('@Example');
    expect(restoreTokens(protectedText)).toBe(tweets[0].text);
  });

  it('does not attach a text-only reply recipient to the next source tweet', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response([
      '@BroTeamPills',
      'Replying to @Example',
      'A text-only reply',
      '@BroTeamPills',
      'A separate image post',
      '[![Image](https://example.com/image)](https://x.com/BroTeamPills/status/2034015079503737310/photo/1)',
    ].join('\n')));
    const tweets = await fetchTweetsFromJina('BroTeamPills');
    expect(tweets.map(tweet => tweet.text)).toEqual(['A separate image post']);
  });
});
