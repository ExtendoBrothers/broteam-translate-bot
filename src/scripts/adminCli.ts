#!/usr/bin/env ts-node
/* eslint-disable no-console, @typescript-eslint/no-explicit-any */
import 'dotenv/config';
import * as readline from 'readline';
import * as http from 'http';
import { URL } from 'url';
import { TwitterClient } from '../twitter/client';
import { config } from '../config';
import { logger } from '../utils/logger';
import { setEnvVar } from '../utils/envWriter';
import * as fs from 'fs';
import * as path from 'path';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer.trim());
    });
  });
}

function displayMenu() {
  console.log('\n=== BroTeam Translate Bot - Admin CLI ===\n');
  console.log('1. Reauthorize OAuth2 (interactive browser flow)');
  console.log('2. Manual token entry (paste access/refresh tokens)');
  console.log('3. View current token status');
  console.log('4. Clear stored OAuth2 tokens');
  console.log('5. Test Twitter API connection');
  console.log('6. Exit\n');
}

async function reauthorizeOAuth2() {
  console.log('\n--- OAuth2 Reauthorization Flow ---\n');
  
  if (!config.TWITTER_CLIENT_ID) {
    console.error('❌ TWITTER_CLIENT_ID is not set in .env. Cannot proceed with OAuth2.');
    return;
  }

  const callback = new URL(config.TWITTER_CALLBACK_URL);
  const port = Number(callback.port || 80);
  const pathname = callback.pathname || '/callback';

  console.log('Starting OAuth2 authorization flow...');
  const authUrl = await TwitterClient.generateAuthUrl([
    'tweet.read',
    'tweet.write',
    'users.read',
    'offline.access',
  ]);

  console.log('\n📋 Open this URL in your browser to authorize:\n');
  console.log(authUrl);
  console.log('\n');

  return new Promise<void>((resolve, reject) => {
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

        console.log('✅ Received authorization callback. Processing...');
        const tokens = await TwitterClient.handleOAuth2Callback(code, state);
        
        // Persist to .env
        setEnvVar('TWITTER_OAUTH2_ACCESS_TOKEN', tokens.accessToken);
        if (tokens.refreshToken) {
          setEnvVar('TWITTER_OAUTH2_REFRESH_TOKEN', tokens.refreshToken);
        }

        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html');
        res.end(`
          <html>
            <head><title>Authorization Successful</title></head>
            <body style="font-family: sans-serif; text-align: center; padding: 50px;">
              <h1>✅ Authorization Successful!</h1>
              <p>You can close this window and return to the CLI.</p>
            </body>
          </html>
        `);

        console.log('\n✅ OAuth2 tokens stored successfully!');
        console.log('   - Access token: ✓');
        console.log(`   - Refresh token: ${tokens.refreshToken ? '✓' : '✗'}`);
        console.log('   - Tokens saved to .env and .twitter-oauth2-tokens.json\n');

        server.close(() => resolve());
      } catch (e: any) {
        logger.error(`OAuth2 callback error: ${e?.message || e}`);
        res.statusCode = 500;
        res.end('Error during authorization');
        server.close(() => reject(e));
      }
    });

    server.listen(port, () => {
      console.log(`🔊 Listening for OAuth2 callback on ${config.TWITTER_CALLBACK_URL}`);
      console.log('   Waiting for browser authorization...\n');
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      console.log('\n⏱️  Authorization timed out after 5 minutes.');
      server.close(() => resolve());
    }, 5 * 60 * 1000);
  });
}

async function manualTokenEntry() {
  console.log('\n--- Manual Token Entry ---\n');
  
  const accessToken = await question('Enter OAuth2 Access Token: ');
  if (!accessToken) {
    console.log('❌ Access token is required.');
    return;
  }

  const refreshToken = await question('Enter OAuth2 Refresh Token (optional, press Enter to skip): ');
  
  const expiresInStr = await question('Token expires in seconds (optional, e.g., 7200): ');
  const expiresIn = expiresInStr ? parseInt(expiresInStr, 10) : 7200;

  const tokens = {
    accessToken,
    refreshToken: refreshToken || undefined,
    expiresAt: Date.now() + (expiresIn * 1000) - 5000,
  };

  // Save to .env
  setEnvVar('TWITTER_OAUTH2_ACCESS_TOKEN', tokens.accessToken);
  if (tokens.refreshToken) {
    setEnvVar('TWITTER_OAUTH2_REFRESH_TOKEN', tokens.refreshToken);
  }

  // Save to .twitter-oauth2-tokens.json
  const tokenPath = path.join(process.cwd(), '.twitter-oauth2-tokens.json');
  const tmp = tokenPath + '.tmp.' + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(tokens, null, 2));
  fs.renameSync(tmp, tokenPath);

  console.log('\n✅ Tokens saved successfully!');
  console.log('   - Saved to .env');
  console.log('   - Saved to .twitter-oauth2-tokens.json\n');
}

async function viewTokenStatus() {
  console.log('\n--- Current Token Status ---\n');
  
  const tokenPath = path.join(process.cwd(), '.twitter-oauth2-tokens.json');
  
  if (!fs.existsSync(tokenPath)) {
    console.log('❌ No stored OAuth2 tokens found (.twitter-oauth2-tokens.json does not exist)');
    console.log('\nEnvironment variables:');
    console.log(`   TWITTER_OAUTH2_ACCESS_TOKEN: ${config.TWITTER_OAUTH2_ACCESS_TOKEN ? '✓ Set' : '✗ Not set'}`);
    console.log(`   TWITTER_OAUTH2_REFRESH_TOKEN: ${config.TWITTER_OAUTH2_REFRESH_TOKEN ? '✓ Set' : '✗ Not set'}`);
    return;
  }

  try {
    const raw = fs.readFileSync(tokenPath, 'utf-8');
    const tokens = JSON.parse(raw);
    
    console.log('📄 Stored tokens (.twitter-oauth2-tokens.json):');
    console.log(`   Access token: ${tokens.accessToken ? tokens.accessToken.substring(0, 20) + '...' : '✗ Missing'}`);
    console.log(`   Refresh token: ${tokens.refreshToken ? tokens.refreshToken.substring(0, 20) + '...' : '✗ Missing'}`);
    
    if (tokens.expiresAt) {
      const now = Date.now();
      const expiresAt = new Date(tokens.expiresAt);
      const diff = tokens.expiresAt - now;
      
      if (diff > 0) {
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(minutes / 60);
        console.log(`   Expires: ${expiresAt.toISOString()} (in ${hours}h ${minutes % 60}m)`);
      } else {
        console.log(`   ⚠️  Expired: ${expiresAt.toISOString()} (${Math.abs(Math.floor(diff / 60000))} minutes ago)`);
      }
    } else {
      console.log('   Expires: Unknown (no expiry info stored)');
    }
    
    console.log('\n🌍 Environment variables:');
    console.log(`   TWITTER_OAUTH2_ACCESS_TOKEN: ${config.TWITTER_OAUTH2_ACCESS_TOKEN ? '✓ Set' : '✗ Not set'}`);
    console.log(`   TWITTER_OAUTH2_REFRESH_TOKEN: ${config.TWITTER_OAUTH2_REFRESH_TOKEN ? '✓ Set' : '✗ Not set'}`);
  } catch (e) {
    console.error(`❌ Error reading token file: ${e}`);
  }
  
  console.log('');
}

async function clearTokens() {
  console.log('\n--- Clear Stored OAuth2 Tokens ---\n');
  
  const confirm = await question('Are you sure you want to clear all OAuth2 tokens? (yes/no): ');
  
  if (confirm.toLowerCase() !== 'yes') {
    console.log('❌ Cancelled.');
    return;
  }

  const tokenPath = path.join(process.cwd(), '.twitter-oauth2-tokens.json');
  
  try {
    if (fs.existsSync(tokenPath)) {
      fs.unlinkSync(tokenPath);
      console.log('✅ Deleted .twitter-oauth2-tokens.json');
    } else {
      console.log('ℹ️  .twitter-oauth2-tokens.json does not exist');
    }
    
    console.log('\n⚠️  Note: This does NOT remove tokens from .env file.');
    console.log('   To remove from .env, manually edit the file and remove:');
    console.log('   - TWITTER_OAUTH2_ACCESS_TOKEN');
    console.log('   - TWITTER_OAUTH2_REFRESH_TOKEN\n');
  } catch (e) {
    console.error(`❌ Error clearing tokens: ${e}`);
  }
}

async function testConnection() {
  console.log('\n--- Test Twitter API Connection ---\n');
  
  try {
    const client = new TwitterClient();
    console.log('🔍 Testing connection by fetching user info for @BroTeamPills...');
    
    const user = await client.getUserByUsername('BroTeamPills');
    
    console.log('\n✅ Connection successful!');
    console.log(`   User: @${user.data.username}`);
    console.log(`   Name: ${user.data.name}`);
    console.log(`   ID: ${user.data.id}\n`);
  } catch (e: any) {
    console.error(`\n❌ Connection failed: ${e?.message || e}`);
    console.error('   This might indicate expired/invalid tokens or rate limits.\n');
  }
}

async function main() {
  console.log('\n🤖 Welcome to the BroTeam Translate Bot Admin CLI\n');
  
  let running = true;
  
  while (running) {
    displayMenu();
    const choice = await question('Select an option (1-6): ');
    
    switch (choice) {
    case '1':
      await reauthorizeOAuth2();
      break;
    case '2':
      await manualTokenEntry();
      break;
    case '3':
      await viewTokenStatus();
      break;
    case '4':
      await clearTokens();
      break;
    case '5':
      await testConnection();
      break;
    case '6':
      console.log('\n👋 Goodbye!\n');
      running = false;
      break;
    default:
      console.log('\n❌ Invalid option. Please select 1-6.\n');
    }
  }
  
  rl.close();
}

main().catch((e) => {
  console.error(`\n❌ Fatal error: ${e}`);
  rl.close();
  process.exit(1);
});
