# Copilot Instructions

## Project Overview

Twitter translation bot that fetches tweets from @BroTeamPills, translates them through 4-chain sequences for comedic effect, and posts to @BroTeamForeign. Built with TypeScript, Jest (388 tests), Twitter API v2 OAuth 2.0, LibreTranslate, and ONNX-based humor detection.

## Architecture Patterns

**Entry Point Flow**: `index.ts` → validates environment → initializes graceful shutdown → starts scheduler → orchestrates fetch/translate/post loops via `translateAndPostWorker.ts`

**Graceful Shutdown**: All components that manage state (monthlyUsageTracker, tweetTracker, postTracker, rateLimitTracker) MUST register cleanup handlers via `gracefulShutdown.registerHandler()`. Ensures data persistence on SIGTERM/SIGINT.

**Atomic File Operations**: Use `atomicWriteJsonSync()` from `src/utils/safeFileOps.ts` for ALL JSON writes. Implements temp-file-rename strategy with Windows-specific race condition handling (3 retries, exponential backoff). Never use direct `fs.writeFileSync()` for state files.

**Snowflake ID Handling**: Use shared `snowflakeToDate()` or `snowflakeToDateSafe()` from `src/utils/snowflakeId.ts` for Twitter ID timestamp extraction. Uses BigInt arithmetic with Twitter epoch (1288834974657). Already used by fetchTweets.ts, jinaFetch.ts, nitterScraper.ts, nitterFeed.ts.

**Token Preservation**: Translation pipeline protects URLs, @mentions, and #hashtags via `src/translator/tokenizer.ts`. Tokens replaced with `__XTOK_*__` placeholders, restored post-translation. MENTION regex: `/(?:^|\B)@[a-zA-Z0-9_-]+(?:\n|(?=\W)|$)/g`. Restore uses Unicode-aware `[\p{L}\p{N}]` patterns.

**Duplicate Prevention**: Multi-layer system in `src/utils/duplicatePrevention.ts`: SHA-256 content hashing, semantic similarity (cosine), URL tracking, temporal windows. Check via `checkForDuplicates()` before posting.

**Rate Limiting**: Three-tier system: sliding window (`rateLimitTracker.ts`, 5 posts/15min), daily limit (`postTracker.ts`, 50/24h), monthly fetch cap (`monthlyUsageTracker.ts`, 10,000/month). Track via `.canPost()` methods.

**Event Handler Registration**: Before registering process-level event handlers (uncaughtException, unhandledRejection), check `process.listenerCount()` to avoid conflicts. See `src/utils/enhancedInstanceLock.ts` for pattern.

**Humor Detection**: ML-based scoring via `src/utils/humorScorer.ts` using ONNX BERT models. LRU cache (500 entries, 5min TTL). Default threshold 0.7. Influences translation chain selection in worker.

## Testing Conventions

**Mock Structure**: Jest tests extensively mock dependencies. Pattern: mock logger, tweetTracker, postTracker, contentDeduplication at top of test files. See `tests/duplicate-prevention.test.ts` for canonical structure.

**Test Environment**: Tests use `NODE_ENV=test` to trigger test-specific behavior. `monthlyUsageTracker.ts` uses `isTestEnv = process.env.NODE_ENV === 'test'` to disable tracking (NOT coupled to DISABLE_USAGE_TRACKING flag). Tests run in parallel with worker-isolated temp directories (`.test-temp/worker-{id}/`).

**Pre-Push Hooks**: Husky runs `npm run build` + `npm run lint` before push. All commits MUST compile and pass linting. CI runs same checks on PRs.

**Coverage Goals**: 100% on core utilities. 388 tests across 18 suites (414 total assertions). Run `npm run test:coverage` for reports. Tests execute in parallel using Jest workers (50% of available cores).

## Development Workflow

**Branching**: `development` is primary branch. Feature branches → PR to `development` → CI validation → merge. `main` only updated via approved PRs.

**Build Commands**:
- `npm run build`: Compile TypeScript (Must pass before commits)
- `npm test`: Run all 388 tests
- `npm run dev`: Development mode with auto-reload
- `npm run admin`: Interactive CLI for bot management

**Environment Setup**: OAuth 2.0 with PKCE flow. Run `npm run admin` → "Authorize OAuth 2.0" for interactive setup. Tokens saved to `.env` and `.twitter-oauth2-tokens.json`.

**Docker Integration**: LibreTranslate runs in Docker container. Required for translation functionality. Start via `docker-compose up -d libre`.

## Key Files Reference

- **Entry**: `src/index.ts` - App initialization, env validation, shutdown handling
- **Core Worker**: `src/workers/translateAndPostWorker.ts` - Translation pipeline orchestration (1343 lines)
- **Configuration**: `src/config/index.ts` - Centralized config with defaults
- **Twitter Client**: `src/twitter/client.ts` - OAuth 2.0 wrapper, token refresh, rate limiting
- **Utilities**: `src/utils/` - safeFileOps, gracefulShutdown, snowflakeId, duplicatePrevention, humorScorer
- **Tests**: `tests/` - Comprehensive test suites with mocked dependencies

## Non-Obvious Patterns

**Windows File Atomicity**: Windows `fs.rename()` fails if target exists. `atomicWriteJsonSync()` deletes target before rename, with retry logic for EEXIST race conditions (immediate retries). For proper exponential backoff, use async `atomicWriteJson()`.

**Debounce Tuning**: `monthlyUsageTracker.ts` uses 200ms debounce (reduced from 1000ms) to minimize data loss on ungraceful shutdowns while avoiding excessive disk I/O.

**Deduplication Logic**: When content hashes match, keeps MOST RECENT entry (not oldest). Allows reposting after sufficient time gap. See `src/utils/contentDeduplication.ts`.

**Translation Chains**: 4 predefined chains with language sequences optimized for humor (e.g., English→Japanese→Russian→Spanish→English). Configurable via `OLDSCHOOL_MODE=true` for fixed chains vs dynamic selection.

**Fetch Methods**: Two modes: `twitter` (direct API, counts against monthly limit) and `nitter` (scraper, no quota impact). Set via `FETCH_METHOD` env var.

## Configuration Notes

**Required Env Vars**: `TWITTER_CLIENT_ID`, `TWITTER_REFRESH_TOKEN`, `SOURCE_USER_ID` (numeric), `TARGET_ACCOUNT_USERNAME`

**Optional Tuning**: `FETCH_INTERVAL` (5min default), `TRANSLATE_INTERVAL` (10min), `POST_RATE_LIMIT_PER_24H` (50), `DRY_RUN` (1=no posting)

**API Endpoints**: `LIBRE_TRANSLATE_URL` (default: http://localhost:5000/translate), optional `LIBRE_TRANSLATE_API_KEY`

## Common Operations

**Add Cleanup Handler**: `onShutdown(async () => { /* cleanup code */ })` in initialization

**Check Duplicates**: `const isDupe = await checkForDuplicates(content, tweetId, urls); if (isDupe) return;`

**Atomic Write**: `atomicWriteJsonSync(filePath, data)` - Returns boolean success

**Extract Timestamp**: `const date = snowflakeToDateSafe(tweetId, new Date())` - Fallback on error

**Test Locally**: `npm run build && npm test` - Must pass before push

## Documentation

- [ARCHITECTURE.md](../ARCHITECTURE.md) - System design and component interactions
- [CONTRIBUTING.md](../CONTRIBUTING.md) - PR workflow and branch structure
- [ADMIN_CLI.md](../ADMIN_CLI.md) - Interactive management tool usage
- [DUAL_CHAIN_TRANSLATION.md](../DUAL_CHAIN_TRANSLATION.md) - Translation chain logic
- [DUPLICATE_PREVENTION.md](../DUPLICATE_PREVENTION.md) - Multi-layer dedup system
- [HUMOR_DETECTION.md](../HUMOR_DETECTION.md) - ML model integration details
