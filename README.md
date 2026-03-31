# BroTeam Translate Bot

[![CI](https://github.com/ExtendoBrothers/broteam-translate-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/ExtendoBrothers/broteam-translate-bot/actions/workflows/ci.yml)
[![License: WTFPL](https://img.shields.io/badge/License-WTFPL-brightgreen.svg)](http://www.wtfpl.net/about/)
[![Node Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.1.6-blue)](https://www.typescriptlang.org/)

A Twitter translation bot that fetches tweets from @BroTeamPills, runs them through multi-language chains for comedic effect, and presents the results in a **local web dashboard** for manual review. You choose which translation to post — the bot opens a `twitter.com/intent/tweet` URL in your browser so you post it yourself. **No Twitter API credentials required for the manual version. Alternatively, revert to version v0.12.2 for full automatic tweet fetching and posting. That version works but is no longer updated because Twitter disabled free API usage Q1 2026: https://github.com/ExtendoBrothers/broteam-translate-bot/releases/tag/v0.12.2**

## How It Works

1. The bot polls @BroTeamPills via Nitter (no Twitter API quota consumed)
2. Each new tweet is run through **4 parallel translation chains** using LibreTranslate
3. Candidates are scored by a humor ML model and heuristic evaluator
4. Results appear in a **local dashboard** at `http://localhost:3456`
5. You review the candidates, pick the best one, and click **Post**
6. The bot opens `twitter.com/intent/tweet?text=...` in your browser — you click Tweet

## Key Features

### Manual Review Dashboard
- Web UI at `http://localhost:3456` — no frontend build step, vanilla JS/CSS
- Per-tweet candidate cards with chain label, humor score bar, heuristic score, and best-candidate badge
- **Fetch button** to manually trigger a Nitter poll
- **Manual input** form to translate arbitrary text
- Skip/dismiss per tweet

### Translation Engine
- **4-Chain Translation**: 3 randomized language chains + 1 deterministic (oldschool) chain
- **Deep Chains**: 6-hop pivot language sequences (`en→…→en`) for maximum comedic distortion
- **Humor Scoring**: ML-based detection using ONNX BERT models with LRU caching
- **Heuristic Scoring**: Rule-based evaluator as fallback/secondary signal
- **Smart Selection**: Best candidate flagged automatically; you make the final call

### Stability & Reliability
- **Graceful Shutdown**: SIGINT/SIGTERM handlers with cleanup
- **Crash Recovery**: Atomic file writes, candidate queue survives restarts
- **Duplicate Prevention**: Multi-layer deduplication (exact hash, fuzzy, semantic similarity)
- **Sequential Generation**: One LibreTranslate request at a time — no concurrent hammering

### Testing & Quality
- **261 Tests** across 12 test suites
- **100% coverage** on core utilities
- **Pre-push hooks**: TypeScript build + ESLint + full test suite before every push

## Project Structure

```
broteam-translate-bot/
├── src/
│   ├── index.ts                      # Entry point (manual mode bootstrap)
│   ├── config/index.ts               # Environment configuration
│   ├── server/
│   │   ├── dashboardServer.ts        # HTTP server + REST API for the dashboard
│   │   ├── candidateStore.ts         # In-memory queue with JSON persistence
│   │   └── generationQueue.ts        # Sequential job queue (one job at a time)
│   ├── workers/
│   │   └── candidateGenerator.ts     # Runs 4 translation chains per tweet
│   ├── twitter/
│   │   └── fetchTweets.ts            # Nitter/Jina scraping (no Twitter API)
│   ├── translator/
│   │   └── googleTranslate.ts        # LibreTranslate integration
│   └── utils/
│       ├── humorScorer.ts            # ONNX BERT humor detection
│       ├── duplicatePrevention.ts    # Multi-layer deduplication
│       ├── gracefulShutdown.ts       # Process signal handlers
│       ├── healthCheck.ts            # System health monitoring
│       ├── safeFileOps.ts            # Atomic file operations
│       └── tweetTracker.ts           # Tracks processed tweet IDs
├── dashboard/
│   └── index.html                    # Single-file dashboard SPA
├── tests/                            # 12 test suites, 261 tests
├── models/humor-detector/            # ONNX humor detection model
└── scripts/                          # Utilities and admin tools
```

## Quick Start

### Prerequisites
- Node.js v18+
- Docker Desktop (for LibreTranslate)
- **No Twitter API credentials needed**

### Installation

1. **Clone and install:**
   ```powershell
   git clone https://github.com/ExtendoBrothers/broteam-translate-bot.git
   cd broteam-translate-bot
   npm install
   ```

2. **Start LibreTranslate:**
   ```powershell
   docker-compose up -d libre
   ```

3. **Configure environment:**
   ```powershell
   cp .env.example .env
   # Only DASHBOARD_PORT and LIBRE_TRANSLATE_URL are needed to get started
   ```

4. **Run tests:**
   ```bash
   npm test
   npm run test:coverage
   ```

5. **Start the bot:**
   ```powershell
   npm run build && npm start
   # or in development:
   npm run dev
   ```

6. **Open the dashboard:**
   Navigate to `http://localhost:3456` in your browser.

## Environment Variables

### Translation

| Variable | Default | Description |
|----------|---------|-------------|
| `LIBRE_TRANSLATE_URL` | `http://localhost:5000/translate` | LibreTranslate endpoint |
| `LIBRE_TRANSLATE_API_KEY` | — | API key if your instance requires one |
| `CANDIDATE_CHAIN_DEPTH` | `6` | Pivot-language hops per chain (higher = slower, more distortion) |
| `OLDSCHOOL_MODE` | `false` | Use fixed chains instead of randomized |

### Dashboard

| Variable | Default | Description |
|----------|---------|-------------|
| `DASHBOARD_PORT` | `3456` | Dashboard server port |
| `DASHBOARD_PASSWORD` | — | Optional bearer token for dashboard API auth |

### Fetching

| Variable | Default | Description |
|----------|---------|-------------|
| `FETCH_INTERVAL_MS` | `1800000` | Nitter poll interval in ms (default: 30 min) |
| `SOURCE_USER_ID` | — | Numeric Twitter user ID of the source account |

### Misc

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | Environment mode |
| `MONTHLY_FETCH_LIMIT` | `0` | Keep at `0` to always skip the Twitter API |

See [.env.example](.env.example) for a complete template.

## Testing

```bash
npm test                    # Run all 261 tests
npm run test:watch          # Watch mode
npm run test:coverage       # Coverage report
```

### Test Suites

| Suite | What it covers |
|-------|----------------|
| `candidateStore.test.ts` | Queue CRUD, persistence, old-queue import |
| `generationQueue.test.ts` | Sequential job processing, backpressure |
| `candidateGenerator.test.ts` | Chain runner, humor/heuristic scoring |
| `duplicate-prevention.test.ts` | Exact & semantic deduplication |
| `safeFileOps.test.ts` | Atomic writes, error recovery |
| `tweetTracker.test.ts` | Processed-ID tracking and persistence |
| `gracefulShutdown.test.ts` | SIGTERM/SIGINT handler ordering |
| `healthCheck.test.ts` | System health reporting |
| `monthlyUsageTracker.test.ts` | API quota bookkeeping |
| `tokenizer.test.ts` | BERT tokenization for ML models |
| `rate-limit-tracker.test.ts` | Sliding-window rate limiting |
| `streamLogReader.test.ts` | Memory-efficient log parsing |

## Dashboard REST API

Served on `http://localhost:3456` (configurable via `DASHBOARD_PORT`).

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/queue` | List pending/ready queue items |
| `POST` | `/api/queue/fetch` | Trigger a manual Nitter fetch cycle |
| `POST` | `/api/queue/submit` | Add a tweet by manual text input |
| `POST` | `/api/queue/:id/post/:idx` | Mark candidate as posted → returns `intentUrl` |
| `DELETE` | `/api/queue/:id` | Dismiss/skip a tweet |

The `POST .../post/:idx` response includes a `twitter.com/intent/tweet` URL the dashboard opens in a new tab.

## Translation Chains

Each tweet generates **4 candidates** in parallel:

- **3 randomized chains** — random sequences of 6 pivot languages, e.g. `en→ja→ru→de→zh→fr→es→en`
- **1 oldschool chain** — fixed deterministic sequence for consistency

Each candidate is scored by:
- **Humor scorer** — ONNX BERT classifier (0.0–1.0)
- **Heuristic evaluator** — rule-based signals (punctuation density, capitalization, repetition, etc.)
- **Combined score** — weighted blend; best candidate flagged with `isBestCandidate: true`

## Humor Detection

ML-based scoring using an ONNX BERT model:

- **Model:** Fine-tuned DistilBERT classifier in [models/humor-detector/](models/humor-detector/)
- **Cache:** LRU cache (500 entries, 5-minute TTL) for ~50% speed improvement
- **Fallback:** Heuristic score used if ONNX runtime is unavailable

See [HUMOR_DETECTION.md](HUMOR_DETECTION.md) for details.

## Duplicate Prevention

Multi-layer deduplication before queueing:

1. **Exact match** — SHA-256 content hash
2. **Semantic similarity** — cosine similarity on normalized text
3. **URL tracking** — prevents re-queueing tweets with identical URLs
4. **Temporal window** — ignores recently-seen content

See [DUPLICATE_PREVENTION.md](DUPLICATE_PREVENTION.md) for details.

## LibreTranslate / Docker

```powershell
# Start LibreTranslate
docker-compose up -d libre

# Check it's healthy
curl http://localhost:5000/languages

# View logs
docker logs libretranslate
```

If LibreTranslate is unreachable, translation jobs are marked as `error` and shown with an error badge in the dashboard. The bot keeps running.

## Troubleshooting

### Dashboard won't load
- Check terminal for startup errors
- Port conflict: `netstat -ano | findstr 3456`
- Verify `DASHBOARD_PORT` in `.env`

### No tweets appearing
- Click **Fetch from Nitter** in the dashboard
- Nitter instances can be flaky — multiple fallbacks are tried automatically
- Check `combined.log` for fetch errors

### Translations all show as error
- LibreTranslate is likely down: `docker-compose restart libre`
- Verify `LIBRE_TRANSLATE_URL` in `.env`

### Tests failing
```powershell
npm run build   # must compile first
npm test
```

## Contributing

1. Fork and clone
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Write tests for new functionality
4. Run `npm run build && npm test` — both must pass
5. Submit a PR to `manual-mode`

### Code Style
- TypeScript strict mode
- ESLint flat config (`eslint.config.js`)
- 2-space indentation, single quotes

See [CONTRIBUTING.md](CONTRIBUTING.md) for full guidelines.

## Additional Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — System design and component interactions
- [HUMOR_DETECTION.md](HUMOR_DETECTION.md) — ML model details
- [DUAL_CHAIN_TRANSLATION.md](DUAL_CHAIN_TRANSLATION.md) — Translation chain architecture
- [DUPLICATE_PREVENTION.md](DUPLICATE_PREVENTION.md) — Deduplication algorithms
- [RATE_LIMITS.md](RATE_LIMITS.md) — Rate limiting details
- [DOCKER.md](DOCKER.md) — Docker setup guide

---

**Built with:** TypeScript • Jest • ONNX Runtime • LibreTranslate • Nitter

**Status:** 261 tests passing • No Twitter API required
