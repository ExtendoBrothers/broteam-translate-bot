# Twitter API Rate Limits

## Current Configuration (Optimized for Free Tier)

### Twitter Free Tier Limits (ACTUAL)
- **Tweet fetch requests**: 1 per 15 minutes (96 per day)
- **Tweet posts**: 17 per 24 hours

### Bot Settings
- **Fetch interval**: Every 30 minutes (48 times per day, 2x safety margin)
- **Tweets per fetch**: 1 (to stay under 17 posts/day with 13 languages)
- **Delay between posts**: 2 seconds
- **Delay between tweet batches**: 5 seconds

### Daily API Usage
- **Fetches**: 48 fetches/day ✅ (under 96 limit with 2x margin)
- **Posts**: 1 tweet × 13 languages = **13 posts/day** ✅ (under 17 limit)

### Safety Features
1. **Rate limit detection**: Bot stops immediately on 429 errors
2. **Post delays**: 2s between posts, 5s between tweets
3. **Conservative fetch limit**: Only 1 tweet at a time
4. **30-minute intervals**: 2x safety margin on fetch limit

### Recommendations
- ✅ Current settings are SAFE for Free tier with margin
- Monitor `error.log` for rate limit warnings
- If you get upgraded API access:
  - Increase tweets per fetch to 2-3
  - Keep 30-minute interval
- For production, consider:
  - Tracking previously processed tweet IDs to avoid duplicates
  - Adding a database to store translation history
