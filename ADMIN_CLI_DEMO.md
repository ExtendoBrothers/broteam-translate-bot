# Admin CLI Demo

## Quick Demo of Admin CLI Features

### Starting the CLI
```powershell
PS <your-project-root>\broteam-translate-bot> npm run admin

🤖 Welcome to the BroTeam Translate Bot Admin CLI

=== BroTeam Translate Bot - Admin CLI ===

1. Reauthorize OAuth2 (interactive browser flow)
2. Manual token entry (paste access/refresh tokens)
3. View current token status
4. Clear stored OAuth2 tokens
5. Test Twitter API connection
6. Exit

Select an option (1-6): 
```

### Option 1: Reauthorize OAuth2 (Browser Flow)
Most user-friendly option - opens browser automatically and handles everything:

```
Select an option (1-6): 1

--- OAuth2 Reauthorization Flow ---

Starting OAuth2 authorization flow...

📋 Open this URL in your browser to authorize:

https://twitter.com/i/oauth2/authorize?response_type=code&client_id=...

🔊 Listening for OAuth2 callback on http://127.0.0.1:6789/callback
   Waiting for browser authorization...

✅ Received authorization callback. Processing...

✅ OAuth2 tokens stored successfully!
   - Access token: ✓
   - Refresh token: ✓
   - Tokens saved to .env and .twitter-oauth2-tokens.json
```

### Option 2: Manual Token Entry
For advanced users who already have tokens:

```
Select an option (1-6): 2

--- Manual Token Entry ---

Enter OAuth2 Access Token: eXF5aGl0ZTVPdXRsYnpKVl9qdDVSQVJ...
Enter OAuth2 Refresh Token (optional, press Enter to skip): b0otd2lzTGJReVgxczVwLW5ZbVg...
Token expires in seconds (optional, e.g., 7200): 7200

✅ Tokens saved successfully!
   - Saved to .env
   - Saved to .twitter-oauth2-tokens.json
```

### Option 3: View Current Token Status
Check your stored tokens and expiration:

```
Select an option (1-6): 3

--- Current Token Status ---

📄 Stored tokens (.twitter-oauth2-tokens.json):
   Access token: eXF5aGl0ZTVPdXRsYn...
   Refresh token: b0otd2lzTGJReVgxcz...
   Expires: 2025-11-15T16:30:45.123Z (in 1h 55m)

🌍 Environment variables:
   TWITTER_OAUTH2_ACCESS_TOKEN: ✓ Set
   TWITTER_OAUTH2_REFRESH_TOKEN: ✓ Set
```

### Option 4: Clear Stored Tokens
Remove tokens safely:

```
Select an option (1-6): 4

--- Clear Stored OAuth2 Tokens ---

Are you sure you want to clear all OAuth2 tokens? (yes/no): yes
✅ Deleted .twitter-oauth2-tokens.json

⚠️  Note: This does NOT remove tokens from .env file.
   To remove from .env, manually edit the file and remove:
   - TWITTER_OAUTH2_ACCESS_TOKEN
   - TWITTER_OAUTH2_REFRESH_TOKEN
```

### Option 5: Test Twitter API Connection
Verify tokens work:

```
Select an option (1-6): 5

--- Test Twitter API Connection ---

🔍 Testing connection by fetching user info for @BroTeamPills...

✅ Connection successful!
   User: @BroTeamPills
   Name: BroTeam
   ID: 1234567890
```

If tokens are expired or invalid:
```
❌ Connection failed: Request failed with code 401
   This might indicate expired/invalid tokens or rate limits.
```

### Option 6: Exit
```
Select an option (1-6): 6

👋 Goodbye!
```

## Common Workflows

### First-Time Setup
1. Run `npm run admin`
2. Select option **1** (Reauthorize OAuth2)
3. Complete browser authorization
4. Select option **5** to test connection
5. Select option **6** to exit
6. Run `npm run dev` to start the bot

### Token Expired / Invalid
1. Run `npm run admin`
2. Select option **3** to view status
3. If expired, select option **1** to reauthorize
4. Select option **5** to verify new tokens work
5. Exit and restart bot

### Emergency Token Rotation
1. Run `npm run admin`
2. Select option **4** to clear old tokens
3. Select option **1** to get fresh tokens
4. Verify with option **5**
5. Restart bot

## Features

✅ **Interactive** - Easy-to-use menu system  
✅ **Automatic persistence** - Saves to both `.env` and `.twitter-oauth2-tokens.json`  
✅ **Browser flow** - Opens OAuth2 in your default browser  
✅ **Connection testing** - Verify tokens before running the bot  
✅ **Status checking** - See token expiration and validity  
✅ **Safe clearing** - Confirm before deleting tokens  

## Tips

- Use option **1** for quickest setup
- Use option **3** regularly to check token expiration
- Use option **5** after any token changes to verify
- Keep the CLI running during browser authorization (option 1)
- Manual entry (option 2) is for advanced users or automation scripts
