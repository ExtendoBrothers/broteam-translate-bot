# BroTeam Translate Bot

A production-ready, resilient Twitter bot that translates @BroTeamPills tweets through randomized language chains and posts them to @BroTeamForeign. Built with TypeScript, featuring comprehensive error handling, rate limiting, and extensive test coverage.

## ✨ Key Features

### 🔄 Translation Engine
- **Multi-Chain Translation**: Randomized translation through 3 different language chains + 1 deterministic chain
- **Humor Scoring**: ML-based humor detection using ONNX models with LRU caching (~50% performance improvement)
- **Smart Selection**: Automatically selects the funniest translation from multiple candidates
- **Fallback System**: Robust retry logic with up to 33 attempts per tweet

### 🛡️ Stability & Reliability
- **Graceful Shutdown**: SIGINT/SIGTERM handlers with cleanup timeouts
- **Health Monitoring**: Built-in health checks with memory and heap tracking
- **Crash Recovery**: Comprehensive error handling with safe file operations
- **Duplicate Prevention**: Multi-layer deduplication (exact match, fuzzy, semantic similarity)
- **Queue System**: Persistent tweet queue survives restarts

### 📊 Rate Limiting & Safety
- **17 Posts/24h**: Strict enforcement of Twitter's free tier limits
- **Monthly Fetch Cap**: Dynamic spacing to avoid exhausting API quota
- **Cooldown Tracking**: Persists rate limits across restarts
- **Smart Scheduling**: Adaptive intervals (30-45 min) based on activity

### 🧪 Testing & Quality
- **388 Tests**: Comprehensive Jest test suite across 18 test files
- **100% Core Coverage**: All critical utilities tested
- **Pre-Push Hooks**: Automatic TypeScript compilation and ESLint checks
- **Type Safety**: Strict TypeScript configuration

### 🔐 Security & Auth
- **OAuth 2.0**: Full support with automatic token refresh
- **PKCE Flow**: Secure authentication without client secrets
- **Token Rotation**: Handles Twitter's rotating refresh tokens
- **No Secrets in Logs**: Sensitive data properly excluded

## 📁 Project Structure

## 📁 Project Structure

```
broteam-translate-bot
├── src/
│   ├── index.ts                      # Entry point with graceful shutdown
│   ├── config/index.ts               # Environment configuration
│   ├── twitter/
│   │   ├── client.ts                 # Twitter API client with OAuth2
│   │   ├── fetchTweets.ts            # Fetch from @BroTeamPills
│   │   └── postTweets.ts             # Post to @BroTeamForeign
│   ├── translator/
│   │   └── googleTranslate.ts        # LibreTranslate integration
│   ├── scheduler/jobs.ts             # Scheduled tasks with cooldowns
│   ├── workers/
│   │   └── translateAndPostWorker.ts # Main processing with multi-chain
│   └── utils/
│       ├── humorScorer.ts            # ML-based humor detection
│       ├── duplicatePrevention.ts    # Multi-layer deduplication
│       ├── gracefulShutdown.ts       # Process signal handlers
│       ├── healthCheck.ts            # System health monitoring
│       ├── safeFileOps.ts            # Atomic file operations
│       ├── streamLogReader.ts        # Memory-efficient log reading
│       └── optimizedDuplicateCheck.ts # Fast similarity detection
├── tests/                            # 18 test suites, 388 tests
├── models/humor-detector/            # ONNX humor detection models
├── scripts/                          # Admin CLI and utilities
├── STABILITY_IMPROVEMENTS.md         # Technical stability docs
├── UNIT_TESTING_SUMMARY.md          # Test coverage report
└── QUICK_REFERENCE.md               # Developer quick start

```

## 🚀 Quick Start

### Prerequisites
- Node.js v18+
- Docker Desktop (for LibreTranslate)
- Twitter API credentials (OAuth 2.0)

### Installation

1. **Clone and install:**
   ```powershell
   git clone https://github.com/yourusername/broteam-translate-bot.git
   cd broteam-translate-bot
   npm install
   ```

2. **Start LibreTranslate:**
   ```powershell
   docker-compose up -d
   ```

3. **Configure environment:**
   ```powershell
   cp .env.example .env
   # Edit .env with your Twitter API credentials
   
   # Or use interactive setup:
   npm run admin  # Select "Authorize OAuth 2.0"
   ```

4. **Run tests:**
   ```bash
   npm test              # All 388 tests
   npm run test:coverage # Coverage report
   ```

5. **Start the bot:**
   ```powershell
   npm run dev           # Development mode
   # or
   npm run build && npm start  # Production mode
   ```

### OAuth 2.0 Setup

1. Go to [developer.x.com](https://developer.x.com) → Your App → User authentication settings
2. Set **Type of App**: `Native App` (Public client)
3. Add **Callback URL**: `http://127.0.0.1:6789/callback`
4. Enable scopes: `tweet.read`, `tweet.write`, `users.read`, `offline.access`
5. Run interactive setup:
   ```powershell
   npm run admin  # Select option 1 to authorize
   ```

**Alternative manual flow:**
```powershell
npm run oauth2:auth
# Open the printed URL in browser, approve app
# Tokens saved automatically to .env and .twitter-oauth2-tokens.json
```

## ⚙️ Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `TWITTER_CLIENT_ID` | Twitter OAuth 2.0 client ID |
| `TWITTER_CLIENT_SECRET` | OAuth 2.0 client secret (optional for PKCE) |
| `TWITTER_REFRESH_TOKEN` | OAuth 2.0 refresh token (auto-populated) |
| `SOURCE_USER_ID` | Numeric user ID of @BroTeamPills |
| `TARGET_ACCOUNT_USERNAME` | Your bot's username (e.g., BroTeamForeign) |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `LIBRE_TRANSLATE_URL` | `http://localhost:5000/translate` | LibreTranslate endpoint |
| `LIBRE_TRANSLATE_API_KEY` | - | API key if required |
| `FETCH_METHOD` | `nitter` | Fetch mode: `nitter` or `twitter` |
| `FETCH_INTERVAL` | `5` | Minutes between fetches |
| `TRANSLATE_INTERVAL` | `10` | Minutes between translation jobs |
| `RATE_LIMIT_WINDOW_MS` | `900000` | Rate limit window (15 min) |
| `RATE_LIMIT_MAX_POSTS` | `5` | Max posts per window |
| `POST_RATE_LIMIT_PER_24H` | `50` | Daily post limit |
| `OAUTH2_REFRESH_MAX_RETRIES` | `3` | Token refresh retry attempts |
| `OAUTH2_REFRESH_BACKOFF_MS` | `2000` | Retry backoff duration |
| `DRY_RUN` | `1` | Set to `0` to enable posting |
| `OLDSCHOOL_MODE` | `false` | Use fixed translation chains |
| `NODE_ENV` | `development` | Environment mode |

See [.env.example](.env.example) for complete configuration template.

## 🧪 Testing

### Test Coverage

- **18 test suites, 388 passing tests**
- **100% coverage on core utilities**
- **Integration tests with mocked Twitter/LibreTranslate APIs**

```bash
npm test                    # Run all tests
npm run test:watch          # Watch mode for development
npm run test:coverage       # Generate coverage report
npm run test:unit           # Unit tests only
npm run test:integration    # Integration tests only
```

### Key Test Suites

- [tests/duplicate-prevention.test.ts](tests/duplicate-prevention.test.ts) - Exact & semantic duplicate detection
- [tests/spam-filter.test.ts](tests/spam-filter.test.ts) - Content filtering logic
- [tests/rate-limit-tracker.test.ts](tests/rate-limit-tracker.test.ts) - Sliding window rate limits
- [tests/translation-worker.test.ts](tests/translation-worker.test.ts) - Multi-chain translation logic
- [tests/crash-scenarios.test.ts](tests/crash-scenarios.test.ts) - Graceful shutdown & recovery
- [tests/tokenizer.test.ts](tests/tokenizer.test.ts) - BERT tokenization for ML models

## 🛠️ Advanced Features

### Admin CLI

Interactive command-line tool for bot management:

```powershell
npm run admin
```

**Available Commands:**
- 📋 View posted tweets (with date/language filters)
- 🧹 Clean up processed tweet history
- 💾 Export feedback data for model fine-tuning
- 🏥 Monitor system health and rate limits
- 🔐 Authorize OAuth 2.0 (interactive browser flow)

See [ADMIN_CLI.md](ADMIN_CLI.md) for complete documentation.

### Humor Detection System

ML-based humor scoring using ONNX BERT models:

- **Model:** Fine-tuned BERT classifier (distilbert-base-uncased)
- **Cache:** LRU cache with 500 entries, 5-minute TTL
- **Performance:** ~50% faster with caching enabled
- **Threshold:** Configurable humor threshold (default: 0.7)

```typescript
import { scoreHumor } from './utils/humorScorer';

const score = await scoreHumor("This joke is hilarious!");
console.log(`Humor score: ${score}`); // 0.0 - 1.0

if (score > 0.7) {
  // Use humor-optimized translation chain
  useHumorChain();
}
```

**Model files:** [models/humor-detector/](models/humor-detector/)

### Duplicate Prevention

Multi-layer duplicate detection system:

1. **Exact Match:** SHA-256 content hashing
2. **Semantic Similarity:** Cosine similarity on normalized text
3. **URL Tracking:** Prevents reposting identical URLs
4. **Time Windows:** Tracks recent posts for temporal deduplication

```typescript
import { isContentDuplicateSync } from './utils/duplicatePrevention';

const isDuplicate = isContentDuplicateSync(
  content,
  0.85 // similarity threshold
);
```

**Performance:** Optimized with bloom filters and efficient string matching.

### Graceful Shutdown

Handles process signals (SIGINT, SIGTERM, SIGHUP) for clean exits:

```typescript
import { registerShutdownHandler } from './utils/gracefulShutdown';

registerShutdownHandler(async () => {
  await stopScheduler();
  await closeConnections();
  await flushLogs();
  console.log("✅ Graceful shutdown complete");
});
```

**Features:**
- Waits for in-flight translations to complete
- Persists rate limit state to disk
- Closes file handles and network connections
- Prevents data loss during deployment/restart

**Tests:** [tests/crash-scenarios.test.ts](tests/crash-scenarios.test.ts)

### Health Monitoring

Automated system health checks:

```typescript
import { startHealthCheck } from './utils/healthCheck';

startHealthCheck({
  interval: 60000, // 1 minute
  onUnhealthy: (status) => {
    logger.error("System unhealthy", status);
    sendAlert(status);
  }
});
```

**Monitored Metrics:**
- Translation API availability
- Twitter API connectivity
- Disk space for logs
- Rate limit status
- Memory usage

### Safe File Operations

Atomic file writes with automatic backups:

```typescript
import { writeFileSafely, readFileSafely } from './utils/safeFileOps';

await writeFileSafely('data.json', JSON.stringify(data));
// Creates data.json.tmp, validates, then atomically renames
```

**Features:**
- Atomic writes (write-then-rename)
- Automatic backup creation
- JSON validation on read
- Prevents corruption from crashes mid-write

## 📊 Monitoring & Logs

### Log Files

```
combined.log              # All activity (info, warnings, errors)
error.log                 # Errors only
translation-debug.log     # Detailed translation steps and validation
translation-logs/         # Archived logs (rotated daily)
```

### Log Levels

```env
NODE_ENV=production       # Minimal logging
NODE_ENV=development      # Verbose logging with debug info
```

### Stream Log Reading

For large log files, use the memory-efficient stream reader:

```typescript
import { processLogFileLines } from './utils/streamLogReader';

await processLogFileLines('combined.log', (line) => {
  if (line.includes('ERROR')) {
    console.log(line);
  }
});
```

**Benefits:** Processes multi-GB log files without loading into memory.

### Rate Limit Monitoring

```bash
# View current rate limit status
npm run admin
# Select "Monitor system health"

# Check specific endpoints
grep "rate-limit" combined.log
```

### Performance Metrics

- **Humor detection:** ~100ms with cache, ~200ms without
- **Translation:** ~1-2s per tweet (12-hop chain)
- **Duplicate check:** <10ms for exact, <50ms for semantic
- **Memory usage:** ~150MB baseline, ~300MB under load

## 🐛 Troubleshooting

### OAuth 2.0 Issues

**State mismatch error:**
```powershell
# Delete cached OAuth state
Remove-Item .oauth2-meta.json
npm run oauth2:auth
```

**Callback server not reachable:**
```powershell
# Use manual handler with full callback URL
npm run oauth2:handle -- --force "http://127.0.0.1:6789/callback?code=...&state=..."
```

**Token expired/invalid:**
- Bot automatically refreshes tokens if `offline.access` scope is granted
- Check `.twitter-oauth2-tokens.json` for current tokens
- Re-run authorization if refresh fails

### Rate Limit Errors (429)

**Twitter API rate limits:**
- Wait 15 minutes for reset
- Check rate limit status in logs: `grep "rate-limit" combined.log`
- Bot automatically respects cooldowns and persists state

**Monthly fetch limit reached:**
- Bot falls back to Jina proxy scraping
- Logs show: `⚠️ Monthly fetch limit reached, using fallback`
- Set `MONTHLY_FETCH_LIMIT=100` (or higher with paid tier)

**Single-instance lock:**
- Prevents duplicate bot runs
- If stuck, delete `.bot-lock` file

### LibreTranslate Issues

**Container not running:**
```powershell
docker ps --filter "name=libretranslate"
docker logs libretranslate
docker-compose restart
```

**Connection refused:**
- Check `LIBRE_TRANSLATE_URL` in `.env` (default: `http://localhost:5000/translate`)
- Verify Docker Desktop is running
- Test endpoint: `curl http://localhost:5000/translate`

**Translation quality issues:**
- Disable problematic languages in [src/config/index.ts](src/config/index.ts)
- Use `OLDSCHOOL_MODE=true` for predictable chains
- Check language support: [LibreTranslate languages](https://libretranslate.com/)

### Test Failures

**Permission denied (EACCES):**
```powershell
# Run as administrator or fix permissions
icacls . /grant Users:F /t
```

**Tests timeout:**
```powershell
# Increase timeout in jest.config.js
npm test -- --testTimeout=10000
```

**Mock API errors:**
- Check test setup in [tests/setup.ts](tests/setup.ts)
- Verify mocks match actual API responses

### Health Check Failures

**Translation API unhealthy:**
- Verify LibreTranslate is running
- Check network connectivity
- Review error logs: `grep "health-check" error.log`

**Disk space warnings:**
- Clean up old logs: `npm run clean:logs`
- Archive logs: `npm run archive:logs`
- Check available space: `df -h` (Linux) or `Get-PSDrive` (PowerShell)

**Memory issues:**
- Restart bot to clear cache
- Reduce `HUMOR_CACHE_SIZE` if needed
- Monitor with: `Get-Process node | Select-Object WS,PM` (PowerShell)

## 🤝 Contributing

Contributions welcome! Please follow these guidelines:

1. **Fork and clone** the repository
2. **Create a branch** for your feature: `git checkout -b feature/my-feature`
3. **Write tests** for new functionality (maintain 100% core coverage)
4. **Run linter:** `npm run lint -- --fix`
5. **Run tests:** `npm test` (all must pass)
6. **Update docs:** Modify README or create new docs in `docs/`
7. **Submit PR** with clear description

### Code Style

- **TypeScript:** Strict mode enabled
- **ESLint:** Use provided config (`eslint.config.js`)
- **Indentation:** 4 spaces (enforced by linter)
- **Line length:** 120 characters max
- **Naming:** camelCase for variables/functions, PascalCase for classes

### Testing Requirements

- **Unit tests:** Required for all new utility functions
- **Integration tests:** Required for API interactions
- **Coverage:** Maintain 100% on core utilities
- **Mock data:** Use realistic Twitter API responses

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.


MIT License - See [LICENSE](LICENSE) file for details.

## 📚 Additional Documentation

- [ADMIN_CLI.md](ADMIN_CLI.md) - Complete admin CLI reference
- [RATE_LIMITS.md](RATE_LIMITS.md) - Rate limiting details and strategies
- [STABILITY_IMPROVEMENTS.md](STABILITY_IMPROVEMENTS.md) - Technical stability documentation
- [UNIT_TESTING_SUMMARY.md](UNIT_TESTING_SUMMARY.md) - Comprehensive test coverage report
- [FINE_TUNING.md](FINE_TUNING.md) - Model fine-tuning guide for humor detection
- [HUMOR_DETECTION.md](HUMOR_DETECTION.md) - Humor scoring system details
- [DUAL_CHAIN_TRANSLATION.md](DUAL_CHAIN_TRANSLATION.md) - Multi-chain translation architecture
- [DUPLICATE_PREVENTION.md](DUPLICATE_PREVENTION.md) - Deduplication algorithms explained
- [OAUTH2-AUTOMATION.md](OAUTH2-AUTOMATION.md) - OAuth 2.0 setup automation

## 🙋 Support

**Issues:** Report bugs or request features via [GitHub Issues](https://github.com/yourusername/broteam-translate-bot/issues)

**Questions:** Check existing documentation or open a discussion

**Security:** Report vulnerabilities privately to [security@example.com](mailto:security@example.com)

---

**Built with:** TypeScript • Jest • ONNX Runtime • LibreTranslate • Twitter API v2

**Status:** ✅ Production-ready • 388 tests passing • 100% core coverage
