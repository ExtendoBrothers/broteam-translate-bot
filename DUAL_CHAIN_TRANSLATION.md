# Dual-Chain Translation with Humor Scoring

## Overview

The translation bot now runs **both** translation chains for every tweet and uses humor detection to automatically select the funniest result.

## How It Works

### 1. Dual Translation Execution

For each new tweet, the system now:

1. **Runs Random Chain**: Translates through 12 randomly selected languages
2. **Runs Oldschool Chain**: Translates through the fixed language sequence defined in `OLDSCHOOL_LANGUAGES`
3. **Both chains execute in parallel**: Maximizes chances of getting good results

### 2. Quality Validation

Both translation results are checked against quality criteria:
- Length (must be at least 33% of original)
- Not empty or punctuation-only
- Not a duplicate of previously posted tweets
- Not identical to input
- Detected as English language
- No problematic characters

### 3. Humor-Based Selection

**If both chains produce acceptable results:**
- Both are scored using the ML-powered humor detector
- The result with the **higher humor score** is selected
- Logged with `✨ Selected [CHAIN] (humor score: X.XXX)`

**If only one chain succeeds:**
- That result is used automatically
- Logged with `✓ Using [CHAIN] (only acceptable result)`

**If neither chain succeeds:**
- Falls back to retry logic (up to 33 attempts)
- Retries use current mode setting

## Logging

New log prefixes help track the dual-chain process:

- `[DUAL_CHAIN]` - Overall dual-chain execution status
- `[RANDOM-XX]` - Steps in the random chain (e.g., `[RANDOM-ja]`, `[RANDOM-ru]`)
- `[OLDSCHOOL-XX]` - Steps in the oldschool chain (e.g., `[OLDSCHOOL-ja]`, `[OLDSCHOOL-ru]`)

### Example Log Output

```
[DUAL_CHAIN] Executing both random and oldschool translation chains...
[RANDOM] Starting translation chain...
[RANDOM-ja] Translated through ja: ...
[RANDOM-ar] Translated through ar: ...
...
[OLDSCHOOL] Starting translation chain...
[OLDSCHOOL-ja] Translated through ja: ...
[OLDSCHOOL-en] Translated through en: ...
...
[DUAL_CHAIN] Random chain: ACCEPTABLE - passed all checks
[DUAL_CHAIN] Oldschool chain: ACCEPTABLE - passed all checks
[DUAL_CHAIN] Both chains produced acceptable results! Comparing humor scores...
[DUAL_CHAIN] Random chain humor score: 0.856 (HUMOR)
[DUAL_CHAIN] Oldschool chain humor score: 0.742 (HUMOR)
[DUAL_CHAIN] ✨ Selected RANDOM chain (humor score: 0.856 > 0.742)
```

## Configuration

No new configuration needed! The system uses existing settings:

- `OLDSCHOOL_LANGUAGES` - Defines the fixed language sequence for oldschool chain
- `LANGUAGES` - Pool of languages for random selection
- `HUMOR_DETECTION_ENABLED` - Can enable/disable humor scoring (always on if model available)

## Performance Impact

- **Translation Time**: ~2x longer (both chains run sequentially)
- **API Usage**: ~2x more translation API calls per tweet
- **Humor Scoring**: Adds ~150-200ms per comparison
- **Overall**: Expect ~10-15 minutes per tweet vs 5-7 minutes previously

**Trade-off**: Longer processing time for significantly funnier results

## Benefits

1. **Higher Quality**: Two chances to get acceptable results
2. **Funnier Output**: ML-powered selection of the most humorous translation
3. **Fallback Safety**: If one chain fails, the other might succeed
4. **Automatic Selection**: No manual intervention needed

## Future Enhancements

- Parallel execution of both chains to reduce processing time
- Configurable weight between humor score and other quality metrics
- Historical tracking of which chain produces funnier results
- Adaptive chain selection based on success rates
