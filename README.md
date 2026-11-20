# BroTeam Translate Bot

[![CI](https://github.com/ExtendoBrothers/broteam-translate-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/ExtendoBrothers/broteam-translate-bot/actions/workflows/ci.yml)
[![License: WTFPL](https://img.shields.io/badge/License-WTFPL-brightgreen.svg)](http://www.wtfpl.net/about/)
[![Node Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.1.6-blue)](https://www.typescriptlang.org/)

A Twitter translation bot that fetches tweets from @BroTeamPills, runs them through multi-language chains for comedic effect, and presents the results in a **local web dashboard**. In manual mode you choose a translation and post it via the Twitter intent link. Optional automatic mode uses that link in a dedicated browser and keeps the candidates on the dashboard for your feedback. Neither mode requires Twitter API credentials.

## How It Works

1. The bot polls @BroTeamPills via Nitter (no Twitter API quota consumed)
2. Each new tweet is run through **4 parallel translation chains** using LibreTranslate
3. Candidates are scored by a humor ML model and heuristic evaluator
4. Results appear in a **local dashboard** at `http://localhost:3456`
5. You review the candidates, pick the best one, and click **Post**
6. The bot opens `twitter.com/intent/tweet?text=...` in your browser — you click Tweet

In automatic mode the bot instead posts the dashboard's BEST candidate (quality
gate first, then English preference and humor plus heuristic score) and leaves
the item visible until you choose your preferred translation. That choice updates
feedback and language weights; it does not make another post.

### Automatic browser posting

Run `./scripts/restart-clean.ps1` and choose **A** when prompted, or use
`./scripts/restart-clean.ps1 -Mode automatic` for a non-interactive restart.
Choose **M** (the default) to keep manual posting. All eligible ready items,
including the existing queue and manually submitted items, can be posted.
By default, the bot starts Chrome with the separate `.automatic-browser-profile`
directory; sign in to the intended X account in that browser.

To use an existing Firefox session instead, restart Firefox once with
`--remote-debugging-port 9222` and set
`AUTOMATIC_BROWSER_WS_ENDPOINT=ws://127.0.0.1:9222/session` in your local
`.env`. For Firefox Portable, launch its underlying `App\firefox64\firefox.exe`
with `-no-remote -profile "<portable directory>\Data\profile"` and the
remote-debugging flag. Close the existing Firefox instance using that profile
first; afterward the bot attaches to the running browser and leaves it open
when the bot stops. It reuses an existing X tab for the login check when one is
available in the default browser context; otherwise it opens a login tab. Posts
are prepared in a separate temporary tab. The debugging endpoint grants local
processes control over your browser, so only enable it on a trusted machine and
do not expose it to the network. Keep the browser open and avoid interacting
with the bot's tabs while posting. Challenges, browser changes, and X interface
changes may require your attention.

If Firefox reports that an automation session is already active, stop the other
automation client. If a previous bot stopped unexpectedly and left a stale
session, close and reopen Firefox with the same remote-debugging flag; the bot
will retry pending items. Check X before retrying any item marked uncertain.

Long translations are composed as threads. Browser posting is limited to 50 posts
per 24 hours and 10 posts per 30 minutes, counting each thread part and other
posts recorded by the bot. Posts made outside the bot are not counted. Browser
posting also uses a 30-second interval between attempts. Failed quality checks
remain available for manual review. Language checks flag non-Latin scripts and
suspicious untranslated words, while allowing contextual names and quotations;
the dictionary-based checks can still make mistakes. Previously queued results
are checked again before automatic posting. If post confirmation times out, the
bot retries automatically up to 10 times, at least 30 seconds apart and subject
to posting limits. **A timeout does not prove that X rejected the post: retries
can create duplicates.** Other uncertain outcomes, including interrupted posts,
remain on the dashboard for review. After checking X, use **Confirm posted** on
an uncertain item to stop retries and choose a preferred translation without
posting again. New items take priority over retries, which reserve a posting
slot for new items when possible. Posting limits still apply, including to
uncertain attempts. Browser automation depends on X's interface and is not
guaranteed to work if X changes it.

The Nitter RSS fallback uses public instances that permit scraping; availability
can change. Check [Nitter Status](https://status.d420.net/) for current instance
and RSS health. A reported healthy instance may still fail for a specific feed
or network, in which case the bot tries the next instance.
The bot requests timelines including replies when supported. Reply addressees
are preserved in the translation text, except when the followed account is the
sole addressee; its self-reply mention is removed to avoid tagging it.

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

Random chains use weighted language selection based on lifetime counts in
`translation-logs/language-weights.json`. Each manual selection adds a positive
signal, while each failed chain attempt adds a negative signal to its listed
languages (two for random chains). The weight is
`0.1 + 1.8 * (4 * positives + 5) / (4 * positives + negatives + 10)`;
new languages start at 1.0. The smoothed ratio keeps weights between 0.1 and
1.9 without cumulative score drift, while retaining the full history. These
are selection and retry signals, not measured per-language success rates.

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
- Google Chrome for automatic mode, or Firefox started with its local WebDriver BiDi endpoint

### Installation

**One-click setup (Windows):**
```powershell
git clone https://github.com/ExtendoBrothers/broteam-translate-bot.git
cd broteam-translate-bot
npm run setup
```
`npm run setup` checks your Node version, installs dependencies, creates `.env` from `.env.example` if missing, starts the LibreTranslate Docker container, waits for it to come up, and builds the project. For a local run, use `npm start`; for deployment or restart, use `./scripts/restart-clean.ps1`.

**Manual steps** (if you'd rather do it yourself, or aren't on Windows):

1. **Clone and install:**
   ```powershell
   git clone https://github.com/ExtendoBrothers/broteam-translate-bot.git
   cd broteam-translate-bot
   npm install
   ```

2. **Start LibreTranslate:**
   ```powershell
   docker-compose up -d libretranslate
   ```

3. **Configure environment:**
   ```powershell
   cp .env.example .env
   # Only DASHBOARD_PORT and LIBRETRANSLATE_URL are needed to get started
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
| `LIBRETRANSLATE_URL` | `http://127.0.0.1:5000/translate` | LibreTranslate endpoint |
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
| `BOT_MODE` | `manual` | `manual` or `automatic`; the restart script selects this for PM2 |
| `MONTHLY_FETCH_LIMIT` | `0` | Keep at `0` to always skip the Twitter API |
| `AUTOMATIC_BROWSER_WS_ENDPOINT` | — | Local Firefox WebDriver BiDi URL; when unset, automatic posting launches Chrome |

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
| `POST` | `/api/queue/:id/preference/:idx` | Save a preferred candidate for an automatically posted item |
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
docker-compose up -d libretranslate

# Check it's healthy
curl http://localhost:5000/languages

# View logs
docker logs libretranslate
```

**First run note:** `LT_UPDATE_MODELS=true` makes the container download all 49 language models on first start, which can take several minutes over a slow connection and may exceed the container's `start_period: 60s` healthcheck window (it'll just report `unhealthy`/`starting` until the download finishes — check progress with `docker logs -f libretranslate` rather than assuming it's broken).

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
- LibreTranslate is likely down: `docker-compose restart libretranslate`
- Verify `LIBRETRANSLATE_URL` in `.env`
- On first run, LibreTranslate needs a few minutes to download language models — check `docker logs -f libretranslate`

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
