# BroTeam Translate Bot

This project retrieves tweets from @BroTeamPills, translates them into 13 languages using LibreTranslate (self-hosted), and posts translations to @BroTeamForeign.

## Features

   - Note: the client now supports rotated OAuth2 refresh tokens and will persist new refresh tokens to `.env` when Twitter returns a rotated refresh token during refresh. It also retries transient refresh failures with exponential backoff (configurable via `OAUTH2_REFRESH_MAX_RETRIES` and `OAUTH2_REFRESH_BACKOFF_MS`), and avoids retries on HTTP 400 responses which indicate invalid grant or revoked refresh tokens.

## Project Structure

```
broteam-translate-bot
├── src
│   ├── index.ts                # Entry point
│   ├── config/index.ts         # Environment configuration
│   ├── twitter/
│   │   ├── client.ts           # Twitter API client
│   │   ├── fetchTweets.ts      # Fetch tweets from @BroTeamPills
│   │   └── postTweets.ts       # Post translations to @BroTeamForeign
│   ├── translator/
│   │   ├── googleTranslate.ts  # LibreTranslate integration
│   │   └── languages.ts        # Supported languages
│   ├── scheduler/jobs.ts       # Scheduled tasks
│   ├── workers/translateAndPostWorker.ts # Main processing worker
│   └── utils/logger.ts         # Winston logging
├── .env                        # Environment variables (DO NOT COMMIT)
├── .env.example                # Example environment file
├── docker-compose.yml          # LibreTranslate container config
├── RATE_LIMITS.md              # Rate limit documentation
└── package.json
```

## Setup Instructions

### 1. Clone & Install
```powershell
git clone https://github.com/yourusername/broteam-translate-bot.git
cd broteam-translate-bot
npm install
```

### 2. Start LibreTranslate (self-hosted)
```powershell
docker-compose up -d
```

### 3. Configure Environment
Copy `.env.example` to `.env` and add your Twitter credentials.

For easy setup, use the **Admin CLI**:
```powershell
npm run admin
```
See [ADMIN_CLI.md](ADMIN_CLI.md) for detailed admin CLI usage and options.

#### Option A: OAuth 2.0 (Recommended - User Context)
OAuth 2.0 allows posting tweets and supports automatic token refresh:

```env
# Twitter OAuth 2.0 credentials
TWITTER_CLIENT_ID=your_client_id
TWITTER_CLIENT_SECRET=your_client_secret  # optional for PKCE
TWITTER_CALLBACK_URL=http://127.0.0.1:6789/callback

# Source account
SOURCE_USERNAME=BroTeamPills
SOURCE_USER_ID=1572243080191016961

# Fetch method: 'nitter' (syndication API, no auth, unlimited) or 'twitter' (X API, has monthly cap)
FETCH_METHOD=nitter

# LibreTranslate
LIBRETRANSLATE_URL=http://127.0.0.1:5000/translate

# Safety
DRY_RUN=1  # Set to 0 to enable real posting
RATE_LIMIT_BUFFER_SECONDS=10
```

**Setup OAuth 2.0:**
1. Go to [developer.x.com](https://developer.x.com) → Your App → User authentication settings
2. Set **Type of App** to: `Native App` (Public client)
3. Add **Callback URL**: `http://127.0.0.1:6789/callback`
4. Enable scopes: `tweet.read`, `tweet.write`, `users.read`, `offline.access`
5. Run the admin CLI for easy interactive setup:
   ```powershell
   npm run admin
   ```
   Select option **1** to authorize via browser and automatically persist tokens to `.env` and `.twitter-oauth2-tokens.json`.

**Alternative: Manual OAuth2 flow**
If you prefer manual control:
```powershell
npm run oauth2:auth
```
Open the printed URL in your browser and approve the app. Tokens will be saved automatically.

**Manual token exchange (if callback fails):**
If the callback doesn't connect, copy the full redirect URL from your browser and run:
```powershell
npm run oauth2:handle -- --force "http://127.0.0.1:6789/callback?code=...&state=..."
```

#### Option B: OAuth 1.0a (Legacy)
⚠️ OAuth 1.0a does **not** support posting on Free tier. Use OAuth 2.0 for posting.

```env
TWITTER_API_KEY=your_key
TWITTER_API_SECRET=your_secret
TWITTER_ACCESS_TOKEN=your_token
TWITTER_ACCESS_SECRET=your_token_secret

LIBRETRANSLATE_URL=http://127.0.0.1:5000/translate
DRY_RUN=1
```

### 4. Run the Bot
```powershell
# Development mode (auto-reload)
npm run dev

# Production mode
npm run build
npm start

# One-shot translation test
npm run translate:one -- "hello world"
```

## Rate Limits & Safety

⚠️ **Free tier–friendly behavior (implemented)**
- Fetches up to 40 tweets per run (timeline batch size)
- Enforces a strict 17 posts per rolling 24 hours (excess translations are queued)
- Persists API cooldowns across restarts and differentiates API vs. cooldown blocks in logs
- Scheduler runs every 30 minutes from the last completion; on startup, first run is delayed until cooldown expiry + ~20s
- Automatic rate-limit detection; see [RATE_LIMITS.md](RATE_LIMITS.md) for details

## Fetching Tweets & Monthly Limit

Two fetch modes are supported:

1. `FETCH_METHOD=nitter` – Uses Twitter's public syndication/Nitter-like method (no auth). Returns engagement-sorted tweets that may be older; unlimited but not ideal for real-time.
2. `FETCH_METHOD=twitter` – Uses authenticated X API (timeline endpoint). Subject to a strict monthly product cap (≈100 timeline fetches) and per-15-minute limits.

To avoid exhausting the monthly cap early, the scheduler dynamically spaces fetches across the remaining days of the month:

```env
MONTHLY_FETCH_LIMIT=100   # Total authenticated timeline fetches allowed per month
FETCH_SPREAD=true         # Enable dynamic spacing (recommended)
```

When the monthly limit is reached, the bot attempts a lightweight fallback scrape via a public proxy (`r.jina.ai`) to extract recent tweet IDs/text best-effort (timestamps not guaranteed). This allows continued operation (translations/posting) without further authenticated timeline calls.

Logs include monthly usage: `monthly usage X/100` to help monitoring.

## Usage

1. **Dry-run mode** (default): Translates but doesn't post
   - Set `DRY_RUN=1` in `.env`
   - Check logs to verify translations

2. **Production mode**: Enables posting
   - Set `DRY_RUN=0` in `.env`
   - Monitor `combined.log` and `error.log`

3. **Logs**:
   - `combined.log` - All activity
   - `error.log` - Errors only

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TWITTER_CLIENT_ID` | Yes (OAuth2) | Twitter OAuth 2.0 client ID |
| `TWITTER_CLIENT_SECRET` | No (OAuth2) | Twitter OAuth 2.0 client secret (optional for PKCE) |
| `TWITTER_CALLBACK_URL` | No (OAuth2) | OAuth 2.0 redirect URL (default: `http://127.0.0.1:6789/callback`) |
| `TWITTER_OAUTH2_ACCESS_TOKEN` | Auto | OAuth 2.0 access token (auto-populated by auth script) |
| `TWITTER_OAUTH2_REFRESH_TOKEN` | Auto | OAuth 2.0 refresh token (auto-populated by auth script) |
| `TWITTER_API_KEY` | Yes (OAuth1) | Twitter OAuth 1.0a API key (legacy) |
| `TWITTER_API_SECRET` | Yes (OAuth1) | Twitter OAuth 1.0a API secret (legacy) |
| `TWITTER_ACCESS_TOKEN` | Yes (OAuth1) | Twitter OAuth 1.0a access token (legacy) |
| `TWITTER_ACCESS_SECRET` | Yes (OAuth1) | Twitter OAuth 1.0a access token secret (legacy) |
| `SOURCE_USERNAME` | No | Source Twitter username (default: BroTeamPills) |
| `SOURCE_USER_ID` | No | Source Twitter user ID (cached to avoid lookups) |
| `LIBRETRANSLATE_URL` | No | LibreTranslate endpoint (default: `http://127.0.0.1:5000/translate`) |
| `DRY_RUN` | No | Set to `1` to prevent posting (default: 1) |
| `RATE_LIMIT_BUFFER_SECONDS` | No | Safety buffer after rate limit reset (default: 10) |
| `LANGUAGES` | No | Comma-separated language codes for telephone-game chain (default: ja,ar,fi,hu,ko,tr,zh,ru,th,vi,hi,pl,el) |

## Troubleshooting

### OAuth 2.0 callback issues
- **State mismatch**: Delete `.oauth2-meta.json` and re-run `npm run oauth2:auth` with a fresh URL
- **Can't reach callback server**: Use the manual handler with `--force`:
  ```powershell
  npm run oauth2:handle -- --force "http://127.0.0.1:6789/callback?code=...&state=..."
  ```
- **Token expired**: The bot auto-refreshes tokens on 401 errors if `offline.access` scope is granted

### Rate limit errors (429)
- Wait 15 minutes for Twitter rate limit reset
- Check [RATE_LIMITS.md](RATE_LIMITS.md) for current limits
- Bot respects per-endpoint rate limits (timeline, user-lookup, post)
- Single-instance lock prevents duplicate runs (`.bot-lock` file)

### LibreTranslate not reachable
```powershell
# Check container status
docker ps --filter "name=libretranslate"

# View logs
docker logs libretranslate

# Restart container
docker-compose restart
```

### Translation errors
- Ensure LibreTranslate is running on port 5000
- Test with: `npm run translate:one -- "test"`

## Contributing

Contributions welcome! Please:
1. Test changes with `DRY_RUN=1`
2. Respect rate limits
3. Document environment variables
4. Ensure code passes `npm run build` and `npm run lint` before pushing

### Pre-Push Hook

A git pre-push hook is installed at `.git/hooks/pre-push` that automatically runs:
- `npm run build` (TypeScript compilation)
- `npm run lint` (ESLint checks)

If either fails, the push is blocked. To bypass in emergencies (not recommended):
```powershell
git push --no-verify
```

## Available npm Scripts

- `npm run admin` - Interactive admin CLI for OAuth2 token management
- `npm run dev` - Development mode with auto-reload
- `npm start` - Production mode
- `npm run build` - Compile TypeScript
- `npm run lint` - ESLint checks
- `npm run oauth2:auth` - Manual OAuth2 authorization flow
- `npm run oauth2:handle` - Handle OAuth2 callback
- `npm run translate:one` - Test translation chain with a single text
- `npm run resolve:user` - Resolve Twitter username to user ID
- `npm run test:tokens` - Test tokenizer for tweet splitting

See [ADMIN_CLI.md](ADMIN_CLI.md) for detailed admin CLI documentation.

## License

MIT License

## Security Notes

- Never commit real secrets or tokens. Files like `.env`, `.twitter-oauth2-tokens.json`, `.rate-limit-state.json`, `.tweet-queue.json`, `.processed-tweets.json`, `.post-tracker.json`, `.last-run.json`, and `.oauth2-meta.json` are gitignored on purpose.
- OAuth2 tokens are refreshed automatically. If compromised, revoke/rotate in the Twitter Developer Portal and remove local token files.
- The OAuth2 PKCE verifier/state (`.oauth2-meta.json`) is deleted after successful login; if present, delete and re-run auth.
- Logs may contain error details. We avoid logging secrets, but always treat logs as sensitive and rotate regularly.
- Use `DRY_RUN=1` when testing changes.