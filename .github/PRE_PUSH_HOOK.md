# Pre-Push Hook

The `.git/hooks/pre-push` hook runs automatically before every `git push` to ensure code quality.

## What It Checks

1. **TypeScript Build** (`npm run build`)
   - Ensures code compiles without errors
   - Fails on any TypeScript errors

2. **ESLint** (`npm run lint`)
   - Checks code style and best practices
   - Allows warnings (230 warnings are normal)
   - Only fails on actual errors

3. **Tests** (`npm test`)
   - Runs all 419 tests (20 test suites)
   - Uses `--bail` to exit on first failure (faster feedback)
   - Uses `--maxWorkers=2` to reduce resource contention
   - Takes ~2 minutes to complete

## Typical Output

```
Running pre-push checks...
→ Building TypeScript...
→ Running ESLint...
→ Running tests...
✅ Pre-push checks passed (build + lint + 419 tests).
```

## If Checks Fail

The hook will:
- Show which step failed (build, lint, or tests)
- Prevent the push
- Display relevant error output

To fix:
```bash
# Run checks locally to see details
npm run build   # Check build errors
npm run lint    # Check lint errors  
npm test        # See which tests failed
```

## Bypass Hook (Not Recommended)

Only in emergencies:
```bash
git push --no-verify
```

**Note:** Always run `npm test` locally after bypassing to ensure nothing is broken.
