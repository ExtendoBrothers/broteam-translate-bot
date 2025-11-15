# OAuth2 Authentication Automation

## Overview
The bot uses OAuth2 for Twitter API access. OAuth2 tokens expire and need to be refreshed periodically. This system automates monitoring and alerts you when re-authentication is needed.

## Quick Commands

### Check OAuth2 Health
```bash
npm run oauth2:check
```
Tests if your OAuth2 credentials are working and shows expiration info.

### Re-Authorize (when needed)
```bash
npm run oauth2:auth
```
Opens a browser to re-authenticate with Twitter. Follow the prompts.

## Automated Monitoring Setup (Windows)

To automatically check OAuth2 health daily and receive alerts:

1. **Run the setup script** (as Administrator):
   ```powershell
   .\scripts\setup-oauth2-monitoring.ps1
   ```

2. **What it does:**
   - Creates a Windows Task Scheduler task
   - Runs `npm run oauth2:check` daily at 9:00 AM
   - Shows a Windows notification if re-auth is needed
   - Logs results to `.oauth2-health.log`

3. **Test it immediately:**
   ```powershell
   Start-ScheduledTask -TaskName "BroTeam-OAuth2-HealthCheck"
   ```

## Manual Monitoring (Alternative)

If you don't want automated monitoring, just run this occasionally:
```bash
npm run oauth2:check
```

If it fails, run:
```bash
npm run oauth2:auth
```

## What Happens Automatically

The bot already has automatic token refresh built-in:
- ✅ Access tokens refresh automatically every 2 hours
- ✅ Refresh tokens are updated in `.env` when rotated
- ✅ Falls back to OAuth1 if OAuth2 fails

The only time you need manual intervention is if the **refresh token** expires (typically after weeks of inactivity).

## Troubleshooting

### "OAuth2 refresh failed - refresh token is invalid"
Run: `npm run oauth2:auth` to get new credentials.

### "401 received from Twitter API"
Your tokens are expired. Run: `npm run oauth2:auth`

### "Refresh token was rotated"
Twitter rotated your refresh token. Restart the bot with `pm2 restart broteam-translate-bot` to pick up the new token from `.env`.
