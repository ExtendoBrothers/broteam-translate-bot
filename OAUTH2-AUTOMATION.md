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

To automatically check OAuth2 health hourly and receive alerts:

1. **Run the setup script** (as Administrator):
   ```powershell
   .\scripts\setup-oauth2-monitoring.ps1
   ```

2. **What it does:**
   - Creates a Windows Task Scheduler task
   - Runs OAuth2 health check **hourly** (not daily)
   - Shows Windows toast notifications if re-auth is needed
   - Can automatically restart bot with OAuth1 fallback
   - Logs results to `.oauth2-health.log`

3. **Test it immediately:**
   ```powershell
   Start-ScheduledTask -TaskName "BroTeam-OAuth2-HealthCheck"
   ```

## Enhanced Automation Features

The enhanced monitoring system provides:

- **Hourly Health Checks**: Catches token issues quickly
- **Windows Notifications**: Clickable toast notifications
- **Automatic Fallback**: Can restart bot with OAuth1 when OAuth2 fails
- **Proactive Monitoring**: Detects issues before they cause posting failures

### Manual Enhanced Check
```powershell
# Basic health check
.\scripts\enhanced-oauth2-monitor.ps1

# With notifications
.\scripts\enhanced-oauth2-monitor.ps1 -SendNotification

# With auto-restart on failure
.\scripts\enhanced-oauth2-monitor.ps1 -AutoRestart
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
- ✅ **NEW:** Hourly health monitoring with notifications
- ✅ **NEW:** Automatic bot restart with OAuth1 fallback

## What Still Requires Manual Intervention

Unfortunately, **OAuth2 re-authentication cannot be fully automated** because:
- Twitter requires user consent through a browser
- Security policies prevent automated credential renewal
- Manual authorization ensures account security

**When you need to intervene:**
- When refresh tokens expire (typically after weeks of inactivity)
- When you see "OAuth2 refresh failed - refresh token is invalid" errors
- When the bot falls back to OAuth1 and you want full OAuth2 functionality

**How to intervene:**
```bash
npm run oauth2:auth
```
This takes ~30 seconds and happens rarely (every few weeks).

## Troubleshooting

### "OAuth2 refresh failed - refresh token is invalid"
Run: `npm run oauth2:auth` to get new credentials.

### "401 received from Twitter API"
Your tokens are expired. Run: `npm run oauth2:auth`

### "Refresh token was rotated"
Twitter rotated your refresh token. Restart the bot with `pm2 restart broteam-translate-bot` to pick up the new token from `.env`.
