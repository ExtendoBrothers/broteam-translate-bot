# Pre-Push Hook

If you install a `.git/hooks/pre-push` hook in your local clone, it will run automatically before every `git push` to help ensure code quality.

## Setup (Local Only)

Git hooks are not version-controlled. To enable this pre-push behavior in your repo clone:

1. Create (or edit) `.git/hooks/pre-push` in your local repository.
2. Add the desired script logic (e.g., run `npm run build`, `npm run lint`, and `npm test`).
3. Make the hook executable:
   ```bash
   chmod +x .git/hooks/pre-push
   ```

Once configured, the hook will be invoked automatically by Git before each push.

## What It Checks

1. **TypeScript Build** (`npm run build`)
   - Ensures code compiles without errors
   - Fails on any TypeScript errors

2. **ESLint** (`npm run lint`)
   - Checks code style and best practices
   - Allows warnings (currently acceptable)
   - Only fails on actual errors

3. **Tests** (`npm test -- --bail --maxWorkers=2`)
   - Runs the full Jest test suite
   - Hook adds `--bail` to exit on first failure (faster feedback)
   - Hook adds `--maxWorkers=2` to reduce resource contention
   - Takes ~2 minutes to complete

## Typical Output

```
Running pre-push checks...
→ Building TypeScript...
→ Running ESLint...
→ Running tests...
✅ Pre-push checks passed (build + lint + tests).
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
