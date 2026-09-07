import { cleanFetchedTweetText } from '../src/twitter/nitterFeed';

describe('cleanFetchedTweetText', () => {
  it('removes expanded link-card metadata appended after a URL', () => {
    expect(cleanFetchedTweetText(
      'twitch.tv/broteam Link BroTeam - Twitchでライブ中 ----- ゲーミング | 星の戦争をゼロに 79 人の視聴者にストリーミングします. twitch.tv'
    )).toBe('twitch.tv/broteam');
  });

  it('preserves normal tweet text containing a URL and the word Link', () => {
    expect(cleanFetchedTweetText('Visit https://example.com and Link your account')).toBe(
      'Visit https://example.com and Link your account'
    );
  });
});