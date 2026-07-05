# Changelog

## Unreleased

- Raised the acceptability character cap from 288 to 1000 so longer translations can still be accepted and split manually if needed.
- Switched manual dashboard startup to the enhanced instance lock so stale PID reuse no longer blocks the dashboard from coming online.
- Doubled failed-translation penalties for random chains and reduced the oldschool loss penalty to one third to compensate for its lower frequency.
- Tightened the short-output gate to 40% for tweets with at least 10 words and shortened translation-chain cooldowns so LibreTranslate can keep up.
- Relaxed the short-output gate for sub-10-word tweets from 33% to 25% to reduce false rejections like 11-character outputs from 40-character inputs.