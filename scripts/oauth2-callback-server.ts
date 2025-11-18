// scripts/oauth2-callback-server.ts
// Minimal local server to handle Twitter OAuth2 PKCE callback

import http from 'http';
import url from 'url';
import { TwitterClient } from '../src/twitter/client';

const PORT = 6789;


const server = http.createServer(async (req, res) => {
  console.log(`[callback-server] Received request: ${req.method} ${req.url}`);
  try {
    const reqUrl = url.parse(req.url || '', true);
    if (reqUrl.pathname === '/callback' && reqUrl.query.code && reqUrl.query.state) {
      console.log('[callback-server] Callback received with code and state.');
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Authorization received! You can close this tab.\nCheck your terminal for next steps.');
      try {
        const tokens = await TwitterClient.handleOAuth2Callback(reqUrl.query.code as string, reqUrl.query.state as string);
        console.log('[callback-server] OAuth2 tokens saved! Bot is now authorized.');
        server.close();
        process.exit(0);
      } catch (err) {
        console.error('[callback-server] Failed to exchange code for tokens:', err);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Failed to exchange code for tokens. Check terminal for details.');
        server.close();
        process.exit(1);
      }
    } else {
      console.log(`[callback-server] Non-callback or incomplete request: ${req.url}`);
      res.writeHead(404);
      res.end('Not found');
    }
  } catch (err) {
    console.error('[callback-server] Unexpected error:', err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal server error.');
    server.close();
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log('OAuth2 callback server listening at http://127.0.0.1:6789/callback');
});
