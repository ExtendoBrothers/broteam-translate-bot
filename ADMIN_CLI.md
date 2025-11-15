# Admin CLI Usage Guide

The Admin CLI provides an interactive interface for managing OAuth2 tokens and testing the bot's Twitter API connection.

## Quick Start

Run the admin CLI:
```powershell
npm run admin
```

## Available Options

### 1. Reauthorize OAuth2 (Interactive Browser Flow)
- Starts a local server and opens OAuth2 authorization in your browser
- Automatically handles the callback and stores tokens
- Saves tokens to both `.env` and `.twitter-oauth2-tokens.json`
- **Recommended for most users**

### 2. Manual Token Entry
- Paste access token and refresh token directly
- Useful if you already have tokens from another source
- Specify token expiration time (default: 7200 seconds / 2 hours)

### 3. View Current Token Status
- Shows stored tokens from `.twitter-oauth2-tokens.json`
- Displays token expiration status
- Shows environment variable status

### 4. Clear Stored OAuth2 Tokens
- Deletes `.twitter-oauth2-tokens.json`
- Does NOT modify `.env` (you must manually edit that file)
- Requires confirmation before deletion

### 5. Test Twitter API Connection
- Attempts to fetch user info for @BroTeamPills
- Validates that your tokens are working
- Shows detailed error messages if connection fails

### 6. Exit
- Closes the admin CLI

## Example Session

```
$ npm run admin

🤖 Welcome to the BroTeam Translate Bot Admin CLI

=== BroTeam Translate Bot - Admin CLI ===

1. Reauthorize OAuth2 (interactive browser flow)
2. Manual token entry (paste access/refresh tokens)
3. View current token status
4. Clear stored OAuth2 tokens
5. Test Twitter API connection
6. Exit

Select an option (1-6): 1

--- OAuth2 Reauthorization Flow ---

Starting OAuth2 authorization flow...

📋 Open this URL in your browser to authorize:

https://twitter.com/i/oauth2/authorize?...

🔊 Listening for OAuth2 callback on http://127.0.0.1:6789/callback
   Waiting for browser authorization...

✅ Received authorization callback. Processing...

✅ OAuth2 tokens stored successfully!
   - Access token: ✓
   - Refresh token: ✓
   - Tokens saved to .env and .twitter-oauth2-tokens.json
```

## Troubleshooting

### Port Already in Use
If port 6789 is already in use, change `TWITTER_CALLBACK_URL` in `.env`:
```
TWITTER_CALLBACK_URL=http://127.0.0.1:7890/callback
```
Update the callback URL in your Twitter app settings to match.

### Timeout During Authorization
The authorization flow times out after 5 minutes. If you need more time:
1. Exit the admin CLI
2. Run again and complete authorization faster

### Token Expiration
OAuth2 access tokens typically expire after 2 hours. The bot automatically refreshes them using the refresh token. If refresh fails:
1. Use admin CLI option 1 to reauthorize
2. Check that `TWITTER_CLIENT_ID` and `TWITTER_CLIENT_SECRET` are correct in `.env`

## Automation

You can also use the admin CLI non-interactively by directly calling the underlying scripts:

- Authorize: `npm run oauth2:auth`
- Handle callback: `npm run oauth2:handle -- <redirect-url>`
- Resolve user ID: `npm run resolve:user`

But the admin CLI provides a more user-friendly interface for these operations.
