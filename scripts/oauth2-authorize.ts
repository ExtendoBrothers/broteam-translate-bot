// scripts/oauth2-authorize.ts
// Script to start the OAuth2 PKCE flow for Twitter

import { TwitterClient } from '../src/twitter/client';

(async () => {
  const url = await TwitterClient.generateAuthUrl();
  console.log('Open this URL in your browser to authorize the bot:');
  console.log(url);
})();
