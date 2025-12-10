# Contributing to Broteam Translate Bot

## Development Workflow

This project uses a Pull Request (PR) workflow to ensure code quality and proper CI/CD validation.

### Workflow Steps

1. **Create a feature branch** from `development`:
   ```bash
   git checkout development
   git pull origin development
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** and commit locally:
   ```bash
   # Make changes...
   git add .
   git commit -m "Description of changes"
   ```

3. **Push your feature branch**:
   ```bash
   git push origin feature/your-feature-name
   ```

4. **Create a Pull Request** on GitHub:
   - Go to https://github.com/ExtendoBrothers/broteam-translate-bot
   - Click "New Pull Request"
   - Select `development` as the base branch
   - Select your feature branch as the compare branch
   - Fill out the PR description

5. **Wait for CI to pass** the required "build" status check

6. **Merge the PR** once approved and CI passes

### Branch Structure

- `main`: Production branch, only updated via PR merges
- `development`: Main development branch for ongoing work
- `feature/*`: Feature branches for specific changes

### Pre-commit Checks

The repository includes pre-push hooks that run:
- TypeScript compilation (`npm run build`)
- ESLint linting (`npm run lint`)

These must pass before pushing to ensure CI will succeed.

### Code Quality

- All code must pass TypeScript compilation
- ESLint warnings are allowed but should be minimized
- Tests should be added for new features when appropriate