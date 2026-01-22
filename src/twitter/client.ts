import { TwitterApi } from 'twitter-api-v2';
import { config } from '../config';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';
import { setEnvVar } from '../utils/envWriter';

// Token storage file for OAuth2 user context
const OAUTH2_TOKEN_FILE = path.join(process.cwd(), '.twitter-oauth2-tokens.json');

interface StoredOAuth2Tokens {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number; // epoch ms
    scope?: string[];
}

export class TwitterClient {
  private client: TwitterApi;

  private oauth2Tokens: StoredOAuth2Tokens | null = null;
  private usingOAuth1 = false;

  constructor() {
    // Check if OAuth1 credentials are available for autonomous operation
    const hasOAuth1 = config.TWITTER_API_KEY && config.TWITTER_API_SECRET && 
                      config.TWITTER_ACCESS_TOKEN && config.TWITTER_ACCESS_SECRET;
    
    // Prefer OAuth2 user context if tokens available; fallback to legacy OAuth1
    let tokens = this.loadOAuth2Tokens();
    if (!tokens && config.TWITTER_OAUTH2_ACCESS_TOKEN) {
      tokens = {
        accessToken: config.TWITTER_OAUTH2_ACCESS_TOKEN,
        refreshToken: config.TWITTER_OAUTH2_REFRESH_TOKEN || undefined,
      };
    }
    
    // If OAuth2 tokens exist, use them. Otherwise use OAuth1 if available
    if (tokens?.accessToken) {
      this.oauth2Tokens = tokens;
      this.client = new TwitterApi(tokens.accessToken);
      logger.info('Initialized with OAuth2 credentials' + (hasOAuth1 ? ' (OAuth1 available as fallback)' : ''));
    } else if (hasOAuth1) {
      this.usingOAuth1 = true;
      this.client = new TwitterApi({
        appKey: config.TWITTER_API_KEY,
        appSecret: config.TWITTER_API_SECRET,
        accessToken: config.TWITTER_ACCESS_TOKEN,
        accessSecret: config.TWITTER_ACCESS_SECRET,
      });
      logger.info('Initialized with OAuth1 credentials (autonomous mode)');
    } else {
      throw new Error('No Twitter credentials available - need either OAuth2 tokens or OAuth1 credentials');
    }
  }

  private loadOAuth2Tokens(): StoredOAuth2Tokens | null {
    try {
      if (fs.existsSync(OAUTH2_TOKEN_FILE)) {
        const raw = fs.readFileSync(OAUTH2_TOKEN_FILE, 'utf-8');
        const parsed: StoredOAuth2Tokens = JSON.parse(raw);
        return parsed;
      }
    } catch (e) {
      logger.error(`Failed to load OAuth2 tokens: ${e}`);
    }
    return null;
  }

  private persistOAuth2Tokens(tokens: StoredOAuth2Tokens) {
    try {
      const tmp = OAUTH2_TOKEN_FILE + '.tmp.' + Date.now();
      fs.writeFileSync(tmp, JSON.stringify(tokens, null, 2), 'utf-8');
      fs.renameSync(tmp, OAUTH2_TOKEN_FILE);
      logger.info('Persisted OAuth2 tokens');
    } catch (e) {
      logger.error(`Failed to persist OAuth2 tokens: ${e}`);
    }
  }

  private async refreshOAuth2Token(oldTokens: StoredOAuth2Tokens): Promise<StoredOAuth2Tokens | null> {
    try {
      if (!config.TWITTER_CLIENT_ID) {
        logger.error('TWITTER_CLIENT_ID missing; cannot refresh OAuth2 token');
        return oldTokens; // fallback
      }
      const tempClient = new TwitterApi({ clientId: config.TWITTER_CLIENT_ID, clientSecret: config.TWITTER_CLIENT_SECRET || undefined });
      if (!oldTokens.refreshToken) return oldTokens;
      // Retry with exponential backoff for transient errors (5xx/network), but don't retry on 400.
      const maxRetries = config.OAUTH2_REFRESH_MAX_RETRIES || 3;
      const baseBackoffMs = config.OAUTH2_REFRESH_BACKOFF_MS || 1000;
      let attempt = 0;
      let refreshed: any;
      while (attempt <= maxRetries) {
        try {
          refreshed = await tempClient.refreshOAuth2Token(oldTokens.refreshToken as string);
          break; // success
        } catch (err: unknown) {
          const status = (err as any)?.response?.status || (err as any)?.status || (err as any)?.code;
          // If status 400 or 401 this is likely invalid grant — do NOT retry
          if (status === 400 || status === 401) {
            throw err;
          }
          attempt += 1;
          if (attempt > maxRetries) {
            throw err;
          }
          const jitter = Math.floor(Math.random() * 300);
          const backoff = Math.pow(2, attempt - 1) * baseBackoffMs + jitter;
          logger.info(`OAuth2 refresh failed on attempt ${attempt}/${maxRetries}. Backing off ${backoff}ms before retry.`);
          await new Promise(r => setTimeout(r, backoff));
        }
      }
      const stored: StoredOAuth2Tokens = {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        scope: refreshed.scope,
        expiresAt: Date.now() + (refreshed.expiresIn * 1000) - 5000, // subtract 5s safety
      };
      // If Twitter rotated the refresh token (new refreshToken supplied), persist it to .env
      if (refreshed.refreshToken && refreshed.refreshToken !== oldTokens.refreshToken) {
        try {
          setEnvVar('TWITTER_OAUTH2_REFRESH_TOKEN', refreshed.refreshToken);
          logger.info('Updated TWITTER_OAUTH2_REFRESH_TOKEN in .env due to rotated refresh token');
        } catch (e) {
          logger.error(`Failed to update .env with rotated refresh token: ${e}`);
        }
      }
      this.persistOAuth2Tokens(stored);
      logger.info('OAuth2 token refreshed');
      // Re-initialize client with new access token
      this.oauth2Tokens = stored;
      this.client = new TwitterApi(stored.accessToken);
      return stored;
    } catch (e: unknown) {
      const err = e as any;
      logger.error(`Failed to refresh OAuth2 token: ${err?.message || err}`);
      // If the refresh returned a HTTP 400, the refresh token may be invalid or revoked.
      // In that case, clear stored tokens and fall back to OAuth1 (if configured).
      const status = err?.status || err?.code || err?.response?.status;
      if (status === 400) {
        logger.error('OAuth2 refresh failed with HTTP 400 — refresh token may be invalid or revoked. Clearing stored OAuth2 tokens.');
        try {
          fs.unlinkSync(OAUTH2_TOKEN_FILE);
        } catch { /* ignore */ }
        this.oauth2Tokens = null;
        
        // Fall back to OAuth1 if available for autonomous operation
        if (config.TWITTER_API_KEY && config.TWITTER_API_SECRET && config.TWITTER_ACCESS_TOKEN && config.TWITTER_ACCESS_SECRET) {
          logger.warn('OAuth2 failed - switching to OAuth1 for autonomous operation');
          this.usingOAuth1 = true;
          this.client = new TwitterApi({
            appKey: config.TWITTER_API_KEY,
            appSecret: config.TWITTER_API_SECRET,
            accessToken: config.TWITTER_ACCESS_TOKEN,
            accessSecret: config.TWITTER_ACCESS_SECRET,
          });
          
          // Clear OAuth2 tokens from .env to prevent retry on next restart
          try {
            setEnvVar('TWITTER_OAUTH2_ACCESS_TOKEN', '');
            setEnvVar('TWITTER_OAUTH2_REFRESH_TOKEN', '');
            logger.info('Cleared OAuth2 tokens from .env - will use OAuth1 until manually re-authorized');
          } catch (e) {
            logger.error(`Failed to clear OAuth2 tokens from .env: ${e}`);
          }
          
          return null;
        }
        logger.error('OAuth2 failed and no OAuth1 credentials available - manual re-authorization required');
        return null;
      }
      return oldTokens;
    }
  }

  private async ensureFreshToken() {
    // Skip token refresh if using OAuth1
    if (this.usingOAuth1) return;
    
    if (!this.oauth2Tokens?.refreshToken) return;
    const expiresAt = this.oauth2Tokens.expiresAt;
    if (!expiresAt) return;
    const SAFETY_WINDOW_MS = 60 * 1000; // proactively refresh if <60s left
    if (Date.now() + SAFETY_WINDOW_MS >= expiresAt) {
      logger.info('Access token nearing expiry; refreshing proactively.');
      await this.refreshOAuth2Token(this.oauth2Tokens);
    }
  }

  private async withRefreshOn401<T>(request: () => Promise<T>): Promise<T> {
    try {
      await this.ensureFreshToken();
      return await request();
    } catch (err: unknown) {
      const code = (err as { code?: number })?.code;
      const status = (err as { status?: number })?.status;
      
      // Only attempt OAuth2 refresh if we're using OAuth2 and have a refresh token
      if ((code === 401 || status === 401) && !this.usingOAuth1 && this.oauth2Tokens?.refreshToken) {
        logger.warn('401 received from Twitter API. Attempting OAuth2 token refresh...');
        const refreshed = await this.refreshOAuth2Token(this.oauth2Tokens);
        // If refresh succeeded and we have a new access token, retry the request once.
        if (refreshed) {
          return await request();
        }
        // If we fell back to OAuth1 during refresh, retry the request
        if (this.usingOAuth1) {
          logger.info('Retrying request with OAuth1 credentials...');
          return await request();
        }
      }
      
      // If already using OAuth1 and still got 401, it's a real auth error
      if ((code === 401 || status === 401) && this.usingOAuth1) {
        logger.error('401 error with OAuth1 credentials - check TWITTER_ACCESS_TOKEN and TWITTER_ACCESS_SECRET');
      }
      
      throw err;
    }
  }

  // Helper to initiate new OAuth2 user context flow (PKCE). Called by separate script typically.
  public static async generateAuthUrl(scope: string[] = ['tweet.read','tweet.write','users.read','offline.access']) {
    if (!config.TWITTER_CLIENT_ID) throw new Error('TWITTER_CLIENT_ID is required for OAuth2 PKCE');
    const client = new TwitterApi({ clientId: config.TWITTER_CLIENT_ID, clientSecret: config.TWITTER_CLIENT_SECRET || undefined });
    const { url, codeVerifier, state } = client.generateOAuth2AuthLink(config.TWITTER_CALLBACK_URL, { scope });
    // Persist ephemeral verifier/state for callback handling
    const meta = { codeVerifier, state, createdAt: Date.now() };
    fs.writeFileSync(path.join(process.cwd(), '.oauth2-meta.json'), JSON.stringify(meta, null, 2));
    return url;
  }

  public static async handleOAuth2Callback(code: string, state: string, opts: { force?: boolean } = {}) {
    if (!config.TWITTER_CLIENT_ID) throw new Error('TWITTER_CLIENT_ID is required');
    const metaPath = path.join(process.cwd(), '.oauth2-meta.json');
    if (!fs.existsSync(metaPath)) throw new Error('Missing .oauth2-meta.json with PKCE verifier/state');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    if (meta.state !== state) {
      if (!opts.force) {
        throw new Error('State mismatch in OAuth2 callback');
      } else {
        logger.warn('State mismatch ignored due to force option. Proceeding with token exchange.');
      }
    }
    const client = new TwitterApi({ clientId: config.TWITTER_CLIENT_ID, clientSecret: config.TWITTER_CLIENT_SECRET || undefined });
    const { accessToken, refreshToken, scope, expiresIn } = await client.loginWithOAuth2({
      code,
      codeVerifier: meta.codeVerifier,
      redirectUri: config.TWITTER_CALLBACK_URL,
    });
    const stored: StoredOAuth2Tokens = {
      accessToken,
      refreshToken,
      scope,
      expiresAt: Date.now() + (expiresIn * 1000) - 5000,
    };
    const tokenPath = path.join(process.cwd(), '.twitter-oauth2-tokens.json');
    const tmp = tokenPath + '.tmp.' + Date.now();
    fs.writeFileSync(tmp, JSON.stringify(stored, null, 2));
    fs.renameSync(tmp, tokenPath);
    logger.info('Stored new OAuth2 user context tokens');
    // Cleanup PKCE metadata
    try { fs.unlinkSync(metaPath); } catch { /* noop */ }
    return stored;
  }

  public async getUserByUsername(username: string) {
    return await this.withRefreshOn401(() => this.client.v2.userByUsername(username));
  }

  public async getUserTimeline(userId: string, options: Record<string, unknown> = {}) {
    return await this.withRefreshOn401(() => this.client.v2.userTimeline(userId, options));
  }

  public async postTweet(content: string, replyToTweetId?: string) {
    const tweetOptions: Record<string, unknown> = { text: content };
        
    // If this is a reply (part of a thread), add reply settings
    if (replyToTweetId) {
      tweetOptions.reply = { in_reply_to_tweet_id: replyToTweetId };
    }
    const tweet = await this.withRefreshOn401(() => this.client.v2.tweet(tweetOptions));
    return tweet.data;
  }
}