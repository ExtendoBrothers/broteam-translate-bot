- Resolved the moderate `@humanfs/node` symlink traversal vulnerability by upgrading ESLint and pinning the transitive dependency to `0.16.8`.
# Changelog

## Unreleased

- Overrode PM2's vulnerable `js-yaml` dependency with patched version `4.3.2`.
- Fixed fetched tweet text picking up translated link-card metadata, such as Twitch preview titles and viewer counts, across syndication and Nitter RSS sources.
- Clarified dependency audit closure, setup/restart instructions, translation-length comments, and test module isolation following review feedback.
- Updated dependency alert tracking to create or refresh the issue for low-severity vulnerabilities as well.
- Updated PM2 and its system information dependency to patched releases, removing remaining audited transitive vulnerabilities; the dependency workflow now closes its alert issue after a clean audit.
- Pinned optional `onnxruntime-node` to 1.21.1, which removes the vulnerable `adm-zip` dependency from production installs.
- Added `npm run setup` (`scripts/setup.ps1`) for one-click installs: checks Node version, runs `npm ci`, creates `.env`, starts LibreTranslate via Docker, waits for it to be healthy, and builds the project.
- Fixed README setup instructions referencing a nonexistent `libre` docker-compose service (actual service name is `libretranslate`), which broke fresh installs on a new machine.
- Fixed README documenting `LIBRE_TRANSLATE_URL` instead of the actual `LIBRETRANSLATE_URL` env var used by the code.
- Added a troubleshooting note about LibreTranslate's first-run language model download exceeding the healthcheck `start_period`.
- Raised the acceptability character cap from 288 to 1000 so longer translations can still be accepted and split manually if needed.
- Switched manual dashboard startup to the enhanced instance lock so stale PID reuse no longer blocks the dashboard from coming online.
- Doubled failed-translation penalties for random chains and reduced the oldschool loss penalty to one third to compensate for its lower frequency.
- Tightened the short-output gate to 40% for tweets with at least 10 words and shortened translation-chain cooldowns so LibreTranslate can keep up.
- Relaxed the short-output gate for sub-10-word tweets from 33% to 25% to reduce false rejections like 11-character outputs from 40-character inputs.
- Processed 563 pending feedback entries, expanded the agent feedback log to 942 reviewed entries, replayed 144 manual selections into heuristic weights, and updated humor guidance with measured length and candidate-selection findings.
- Restricted humor-model training export to manual user feedback by default, preventing automatically generated heuristic ratings from becoming self-reinforcing labels.
- Added deterministic class balancing and isolated ONNX conversion options for safer humor-model experiments.
- Ignored versioned local humor-model experiment artifacts alongside the canonical custom models.
- Clarified that the agent, not the user, generates ratings for pending feedback; added transformation, specific implication, short-twist, and conditional-repetition signals to the feedback workflow.
- Separated manual preference evidence from retained agent assessments in feedback analysis so generated ratings contribute to diagnostics and pattern discovery without being mistaken for user labels.
- Completed agent feedback logging with per-candidate heuristic analysis, normalized source comparisons, and explicit user-versus-agent labels in recent reports.
- Aligned manual feedback entry with the selection-only workflow and changed feedback JSON persistence to atomic writes.