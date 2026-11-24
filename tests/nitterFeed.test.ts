import { cleanFetchedTweetText, fetchTweetsFromNitter } from '../src/twitter/nitterFeed';

describe('cleanFetchedTweetText', () => {
  it('removes expanded link-card metadata appended after a URL', () => {
    expect(cleanFetchedTweetText(
      'twitch.tv/broteam Link BroTeam - Twitchでライブ中 ----- ゲーミング | 星の戦争をゼロに 79 人の視聴者にストリーミングします. twitch.tv'
    )).toBe('twitch.tv/broteam');
  });

  describe('syndication replies', () => {
    afterEach(() => jest.restoreAllMocks());

    it('requests replies and restores recipients without altering original mentions', async () => {
      const tweets = [
        { id_str: '2034015079503737310', full_text: 'Hello there', in_reply_to_screen_name: 'Example' },
        { id_str: '2034015079503737311', full_text: '@broteampills Hello again', in_reply_to_screen_name: 'BroTeamPills' },
        { id_str: '2034015079503737312', full_text: '@Example Hello both', in_reply_to_screen_name: 'BroTeamPills' },
        { id_str: '2034015079503737313', full_text: '@BroTeamPills original mention' },
      ];
      const data = { props: { pageProps: { timeline: { entries: tweets.map(tweet => ({
        type: 'tweet', content: { tweet },
      })) } } } };
      const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response(
        `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>`,
      ));

      const result = await fetchTweetsFromNitter('BroTeamPills');

      expect(String(fetchMock.mock.calls[0][0])).toContain('showReplies=true');
      expect(result.map(tweet => tweet.text)).toEqual([
        '@Example Hello there', 'Hello again', '@BroTeamPills @Example Hello both',
        '@BroTeamPills original mention',
      ]);
    });
  });

  it('preserves normal tweet text containing a URL and the word Link', () => {
    expect(cleanFetchedTweetText('Visit https://example.com and Link your account')).toBe(
      'Visit https://example.com and Link your account'
    );
  });

  it('preserves a bare domain followed by normal text starting with Link', () => {
    expect(cleanFetchedTweetText('example.com Link your account')).toBe('example.com Link your account');
  });
});