# Changelog

## Unreleased

- Clarified dependency audit closure, setup/restart instructions, translation-length comments, and test module isolation following review feedback.
- Updated PM2 and its system information dependency to patched releases, removing remaining audited transitive vulnerabilities; the dependency workflow now closes its alert issue after a clean audit.
- Updated optional `onnxruntime-node` to 1.29.0 to remove the vulnerable `adm-zip` 0.5.x dependency from production installs.
- Added `npm run setup` (`scripts/setup.ps1`) for one-click installs: checks Node version, runs `npm ci`, creates `.env`, starts LibreTranslate via Docker, waits for it to be healthy, and builds the project.
- Fixed README setup instructions referencing a nonexistent `libre` docker-compose service (actual service name is `libretranslate`), which broke fresh installs on a new machine.
- Fixed README documenting `LIBRE_TRANSLATE_URL` instead of the actual `LIBRETRANSLATE_URL` env var used by the code.
- Added a troubleshooting note about LibreTranslate's first-run language model download exceeding the healthcheck `start_period`.
- Raised the acceptability character cap from 288 to 1000 so longer translations can still be accepted and split manually if needed.
- Switched manual dashboard startup to the enhanced instance lock so stale PID reuse no longer blocks the dashboard from coming online.
- Doubled failed-translation penalties for random chains and reduced the oldschool loss penalty to one third to compensate for its lower frequency.
- Tightened the short-output gate to 40% for tweets with at least 10 words and shortened translation-chain cooldowns so LibreTranslate can keep up.
- Relaxed the short-output gate for sub-10-word tweets from 33% to 25% to reduce false rejections like 11-character outputs from 40-character inputs.