# Agent Plan: Manual Mode Fork

## Goal

Fork `broteam-translate-bot` into a **no-API variant** that:

1. **Never uses the Twitter API** for fetching tweets (uses Nitter, Jina, RSS, or dashboard manual input).
2. **Never uses the Twitter API** for posting — instead, the user posts via their own browser session through `twitter.com/intent/tweet` (web intent), with the draft text pre-filled.
3. **Generates all 4 translation chain candidates** per source tweet and scores each with the humor scorer.
4. **Displays candidates in the dashboard** with humor scores, ranking, and a "best" badge on the top scorer.
5. **Lets the user choose** which candidate to post, clicking **Post** to open a pre-filled Twitter intent URL in a new tab (user must be logged in to Twitter in their browser).
6. Allows **manual tweet input** in the dashboard as an alternative to Nitter/Jina fetching.

---

## Branch Strategy

Work is done on branch: `feature/manual-mode`  
This is a fork within the same repo (not a separate repo). The branch diverges from `development`.

---

## Architecture Changes

### What is REMOVED
| Component | Reason |
|-----------|--------|
| `src/twitter/client.ts` OAuth 2.0 posting | No Twitter API key needed for posting |
| `src/twitter/postTweets.ts` | Replaced by web intent URL generation |
| `src/index.ts` OAuth validation | No Twitter credentials required |
| `monthlyUsageTracker` fetch quota tracking | No API quota |
| `rateLimitTracker` post cooldown | No API rate limits; user throttles manually |
| Scheduler auto-post loop | Replaced by manual review+post from dashboard |
| `postTracker` 50/day limit | No API limits |

### What is KEPT (unchanged)
- All translation chain logic (`src/workers/translateAndPostWorker.ts` — translate pipeline only)
- `src/translator/` (LibreTranslate integration, tokenizer)
- `src/twitter/nitterFeed.ts`, `nitterScraper.ts`, `jinaFetch.ts` (fetch only)
- `src/utils/humorScorer.ts` (ML humor scoring)
- `src/utils/tweetTracker.ts` (dedup, already-processed tracking)
- `src/utils/duplicatePrevention.ts` (content hash dedup)
- `src/utils/gracefulShutdown.ts`, `logger.ts`, `safeFileOps.ts`

### What is CHANGED
| Component | Change |
|-----------|--------|
| `src/index.ts` | Remove OAuth validation; no auto-scheduler; start Express dashboard server directly |
| `src/workers/translateAndPostWorker.ts` | Extract `generateCandidates(tweet)` that returns 4 candidates with scores; remove auto-post logic |
| `src/twitter/fetchTweets.ts` | Remove Twitter API fetch path; only nitter/jina fallbacks |
| `dashboard.html` → `dashboard/` | Full rewrite as a React-free SPA with candidates panel |

### What is ADDED
| Component | Description |
|-----------|-------------|
| `src/server/dashboardServer.ts` | Express HTTP server serving dashboard + REST endpoints |
| `src/server/candidateStore.ts` | In-memory store of pending tweet candidates (with file persistence) |
| `src/workers/candidateGenerator.ts` | Pure function: takes a tweet, runs all 4 chains, returns candidates with humor scores |
| `dashboard/index.html` | New dashboard UI with candidate cards |

---

## Translation Candidate Pipeline

### Chain Definitions (from existing worker)
The existing worker uses 4 predefined chains:
- Chain 0: `en → ja → ru → es → en`
- Chain 1: `en → zh → ar → de → en`
- Chain 2: `en → ko → fr → pt → en`
- Chain 3: `en → hi → tr → vi → en`

### `generateCandidates(tweet: Tweet): Promise<Candidate[]>`

```typescript
interface Candidate {
  chainIndex: number;      // 0-3
  chainLabel: string;      // e.g. "en→ja→ru→es→en"
  result: string;          // final translated text
  humorScore: number;      // 0.0–1.0 from humorScorer
  heuristicScore: number;  // from evaluateHeuristics
  combinedScore: number;   // weighted: 0.6*humor + 0.4*heuristic
  isBestCandidate: boolean;
}
```

All 4 chains run in parallel (`Promise.all`). Best candidate = highest `combinedScore`.

---

## Dashboard REST API Endpoints

Served by `src/server/dashboardServer.ts` on port `3456` (configurable via `DASHBOARD_PORT`).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/queue` | List all pending candidate sets |
| POST | `/api/queue/fetch` | Trigger a manual nitter/jina fetch cycle |
| POST | `/api/queue/submit` | Add a manual tweet text to the queue |
| POST | `/api/queue/:id/post/:candidateIndex` | Mark a candidate as posted (returns tweet intent URL) |
| DELETE | `/api/queue/:id` | Dismiss a tweet from queue (mark as skipped) |

---

## Posting Flow (No API)

1. User clicks **Post** on a candidate card.
2. Dashboard calls `POST /api/queue/:id/post/:candidateIndex`.
3. Server generates `https://twitter.com/intent/tweet?text=ENCODED_TEXT`.
4. Server marks the tweet as posted in `tweetTracker` and `contentDeduplication`.
5. Dashboard opens the intent URL in a new browser tab.
6. User is already logged into Twitter in their browser — they click **Tweet**.
7. Card is removed from the dashboard queue.

---

## Implementation Steps

### Step 1: Create feature branch
```
git checkout -b feature/manual-mode
```

### Step 2: Create `src/workers/candidateGenerator.ts`
Extract the 4-chain translation logic from `translateAndPostWorker.ts` into a pure async function. Each chain runs sequentially (LibreTranslate pipeline). All 4 run in parallel via `Promise.allSettled`.

### Step 3: Create `src/server/candidateStore.ts`
Thread-safe in-memory store with JSON file persistence (`candidate-queue.json`). Stores queue items:
```typescript
interface QueueItem {
  id: string;           // uuid
  tweet: Tweet;
  candidates: Candidate[];
  fetchedAt: string;    // ISO date
  status: 'pending' | 'posted' | 'skipped';
  postedCandidateIndex?: number;
}
```

### Step 4: Modify `src/twitter/fetchTweets.ts`
Remove the Twitter API fetch block (lines around `if (config.FETCH_METHOD === 'twitter')`). Keep only Jina, Nitter RSS, and Nitter scraper paths.

### Step 5: Create `src/server/dashboardServer.ts`
Express server with:
- Static file serving of `dashboard/index.html`
- All REST endpoints listed above
- Optional basic auth (`DASHBOARD_PASSWORD` env var)

### Step 6: Rewrite `dashboard/index.html`
Single-file SPA (no build step, vanilla JS + CSS). Features:
- Tweet queue panel with cards
- Each card shows: source tweet text, 4 candidate boxes with chain label, humor score bar, heuristic score, best badge
- Fetch button (triggers API fetch cycle)
- Manual input form
- Post button (per candidate) → opens intent URL
- Skip/dismiss button

### Step 7: Update `src/index.ts`
- Remove `validateEnv()` OAuth check
- Skip posting scheduler
- Start fetch scheduler (nitter polling every 30 min)
- Start `dashboardServer`
- On each fetch cycle: run `generateCandidates` for new tweets, push to `candidateStore`

### Step 8: Update `package.json`
- Add `express` and `uuid` to dependencies
- Add `"manual": "ts-node src/index.ts"` script

### Step 9: Update `.env.example`
Remove Twitter API posting vars. Add:
```
DASHBOARD_PORT=3456
DASHBOARD_PASSWORD=   # optional
```

### Step 10: Build & test
```
npm run build
npm test
```

---

## Files to Create
- `src/workers/candidateGenerator.ts`
- `src/server/dashboardServer.ts`
- `src/server/candidateStore.ts`
- `dashboard/index.html`

## Files to Modify
- `src/index.ts`
- `src/twitter/fetchTweets.ts`
- `package.json`

## Files to Leave Untouched
- All test files (tests still apply to translation/utils)
- `src/translator/*`
- `src/utils/*` (except removing unused postTracker/rateLimitTracker imports where applicable)

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| LibreTranslate not running | Candidates marked as error; shown with error badge in dashboard |
| Twitter intent URL character limit | Tweet splitter still runs; multi-part threads shown as multiple intent links |
| Nitter instances down | Multiple scraper fallbacks already exist |
| Humor scorer ONNX model not loaded | Falls back to heuristic score only |

---

## Done Criteria

- [ ] `npm run build` passes with no errors
- [ ] `npm test` passes (388+ tests)
- [ ] Dashboard serves on port 3456
- [ ] Fetching tweets via Nitter works and populates queue
- [ ] All 4 candidates shown per tweet with humor scores
- [ ] Best candidate highlighted
- [ ] Post button opens `twitter.com/intent/tweet` pre-filled
- [ ] Manual tweet input works
- [ ] No Twitter API credentials required in `.env`
