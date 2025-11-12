import 'dotenv/config';
import * as http from 'http';
import { URL } from 'url';
import { TwitterClient } from '../twitter/client';
import { config } from '../config';
import { logger } from '../utils/logger';
import { setEnvVar } from '../utils/envWriter';

async function main() {
  const callback = new URL(config.TWITTER_CALLBACK_URL);
  const port = Number(callback.port || 80);
  const pathname = callback.pathname || '/callback';

  const authUrl = await TwitterClient.generateAuthUrl([
    'tweet.read',
    'tweet.write',
    'users.read',
    'offline.access',
  ]);

  logger.info('Open this URL in your browser to authorize the app:');
  logger.info(authUrl);

  const server = http.createServer(async (req, res) => {
    try {
      if (!req.url) return;
      const reqUrl = new URL(req.url, `${callback.protocol}//${callback.host}`);
      if (reqUrl.pathname !== pathname) {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }
      const code = reqUrl.searchParams.get('code');
      const state = reqUrl.searchParams.get('state');
      if (!code || !state) {
        res.statusCode = 400;
        res.end('Missing code/state');
        return;
      }

      const tokens = await TwitterClient.handleOAuth2Callback(code, state);
      // Persist in .env for convenience
      setEnvVar('TWITTER_OAUTH2_ACCESS_TOKEN', tokens.accessToken);
      if (tokens.refreshToken) setEnvVar('TWITTER_OAUTH2_REFRESH_TOKEN', tokens.refreshToken);

      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain');
      res.end('Authorization successful. You can close this window.');

      logger.info('OAuth2 authorization completed');
      server.close(() => process.exit(0));
    } catch (e: any) {
      logger.error(`OAuth2 callback error: ${e?.message || e}`);
      res.statusCode = 500;
      res.end('Error during authorization');
      server.close(() => process.exit(1));
    }
  });

  server.listen(port, () => {
    logger.info(`Listening for OAuth2 callback on ${config.TWITTER_CALLBACK_URL}`);
  });
}

main().catch((e) => {
  logger.error(`OAuth2 authorization failed: ${e}`);
  process.exit(1);
});
