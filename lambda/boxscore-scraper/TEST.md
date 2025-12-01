# Local Testing Guide

## Prerequisites

1. **Install dependencies** (this may take a few minutes, especially Puppeteer):
   ```powershell
   cd lambda/boxscore-scraper
   npm install
   ```

2. **Set up environment variables**

   You need `SUPABASE_DB_URL` from your Supabase project. You can either:

   **Option A: Create a `.env` file in the project root** (`C:\Users\tiama\Desktop\Coding\nba-analytics-v3\.env`):
   ```
   SUPABASE_DB_URL=postgresql://postgres:[PASSWORD]@[PROJECT].supabase.co:5432/postgres
   BBREF_SCRAPE_DELAY_MS=4000
   MAX_GAMES_PER_RUN=3
   ```

   **Option B: Set environment variables in PowerShell** (for this session only):
   ```powershell
   $env:SUPABASE_DB_URL="postgresql://postgres:[PASSWORD]@[PROJECT].supabase.co:5432/postgres"
   $env:BBREF_SCRAPE_DELAY_MS="4000"
   $env:MAX_GAMES_PER_RUN="3"
   ```

## Running the Test

1. **Navigate to the Lambda directory:**
   ```powershell
   cd lambda/boxscore-scraper
   ```

2. **Run the test:**
   ```powershell
   npm run test
   ```

   Or directly with tsx:
   ```powershell
   npx tsx index.ts
   ```

## What to Expect

The function will:
1. Connect to your Supabase database
2. Query for Final games without box scores (limited by `MAX_GAMES_PER_RUN`)
3. For each game:
   - Construct Basketball Reference URL
   - Launch Puppeteer browser
   - Scrape CSV data
   - Parse and insert into `scraped_boxscores` table
   - Wait 4 seconds between games (rate limiting)

**Expected output:**
```
Starting box score scraping Lambda...
Found 3 Final games without box scores

[1/3] Processing game: 1842025102199
📊 Processing game bbref_202510210000_HOU_OKC (HOU @ OKC, 2025-10-21)...
   Constructed URL: https://www.basketball-reference.com/boxscores/202510210OKC.html
🌐 Loading page with Puppeteer: ...
   Found 2 CSV data block(s)
   Processing CSV data for team: OKC
   Parsed 15 CSV records
   ✅ Inserted 15 player stats for OKC
✅ Success: Inserted 30 player stats

=== Summary ===
{
  "success": true,
  "processed": 3,
  "successful": 3,
  "failed": 0,
  "totalInserted": 90,
  "durationMs": 45000
}
```

## Troubleshooting

### Issue: "Missing SUPABASE_DB_URL"
- Make sure you've set the environment variable (see Prerequisites above)
- Check that `.env` file exists in project root if using Option A

### Issue: Puppeteer installation takes too long
- This is normal - Puppeteer downloads Chromium (~300MB)
- Be patient, it only needs to install once
- You can cancel and retry later if needed

### Issue: "Connection timeout" or database errors
- Verify your `SUPABASE_DB_URL` is correct
- Check that your IP is allowed in Supabase (if using direct connection)
- Try using the pooled connection (port 6543) instead

### Issue: No games found
- This is normal if all Final games already have box scores
- Check your `games` table for Final games without box scores
- You can manually mark a game as needing a box score for testing

### Issue: Puppeteer browser launch fails
- Make sure you have enough disk space (Puppeteer needs ~300MB)
- On Windows, you may need Visual C++ Redistributable
- Try running with `--no-sandbox` flag (already included in code)

## Testing with a Specific Game

If you want to test with a specific game, you can temporarily modify the query in `index.ts`:

```typescript
// In getGamesWithoutBoxScores function, add:
WHERE g.status = 'Final'
  AND g.game_id = 'YOUR_GAME_ID'  // Add this line for testing
  AND sb.game_id IS NULL
```

## Next Steps

Once local testing works:
1. Build for Lambda: `npm run build`
2. Package for deployment (see README.md)
3. Deploy to AWS Lambda
4. Set up EventBridge schedule

