# Box Score Scraper Lambda

Automatically scrapes box scores from Basketball Reference CSV for all Final games without box scores. Runs daily at 03:00 ET via EventBridge.

**Features:**
- ✅ Scrapes Basketball Reference CSV box scores using Puppeteer
- ✅ Processes Final games without box scores automatically
- ✅ Player name resolution to player_id
- ✅ Idempotent UPSERTs (safe to re-run)
- ✅ Rate limiting (4 seconds between requests)
- ✅ Error handling with graceful continuation

## Setup

### 1. Install Dependencies

```bash
cd lambda/boxscore-scraper
npm install
```

**Note:** Puppeteer adds ~300MB to the package. For Lambda deployment, consider:
- Using a Lambda layer for Chromium
- Using `puppeteer-core` + `@sparticuz/chromium` (smaller bundle)
- Using a container image if package exceeds 250MB unzipped

### 2. Build for Lambda

```bash
npm run build
```

This compiles TypeScript to JavaScript in the `dist/` directory.

### 3. Deploy to AWS Lambda

**Option A: Using AWS CLI**

```bash
# Build first
npm run build

# Zip the function (Windows PowerShell)
cd dist
Compress-Archive -Path index.js,../node_modules,../package.json -DestinationPath ../function.zip -Force
cd ..

# Or on Linux/Mac:
zip -r function.zip dist/index.js node_modules package.json

# Create/update Lambda function
aws lambda create-function \
  --function-name boxscore-scraper \
  --runtime nodejs20.x \
  --role arn:aws:iam::YOUR_ACCOUNT:role/lambda-execution-role \
  --handler index.handler \
  --zip-file fileb://function.zip \
  --environment Variables="{
    SUPABASE_DB_URL=your_db_url,
    BBREF_SCRAPE_DELAY_MS=4000,
    MAX_GAMES_PER_RUN=50
  }" \
  --timeout 900 \
  --memory-size 1024
```

**Option B: Using Serverless Framework or CDK**

See AWS documentation for your preferred deployment method.

**Important Configuration:**
- **Timeout:** 900 seconds (15 minutes) - allows processing ~50 games with rate limiting
- **Memory:** 1024 MB (Puppeteer requires more memory)
- **Handler:** `index.handler`

### 4. Set Up EventBridge Schedule

```bash
# Create EventBridge rule
aws events put-rule \
  --name boxscore-scraper-daily \
  --schedule-expression "cron(0 8 * * ? *)" \
  --description "Daily box score scraping at 03:00 ET"

# Add Lambda permission
aws lambda add-permission \
  --function-name boxscore-scraper \
  --statement-id allow-eventbridge \
  --action lambda:InvokeFunction \
  --principal events.amazonaws.com \
  --source-arn arn:aws:events:REGION:ACCOUNT:rule/boxscore-scraper-daily

# Add Lambda as target
aws events put-targets \
  --rule boxscore-scraper-daily \
  --targets "Id=1,Arn=arn:aws:lambda:REGION:ACCOUNT:function:boxscore-scraper"
```

**Schedule Note:**
- `cron(0 8 * * ? *)` = 08:00 UTC = 03:00 ET (EST) or 04:00 ET (EDT)
- Lambda filters by ET timezone, so this works for both EST and EDT

## Local Testing

```bash
# Set environment variables
$env:SUPABASE_DB_URL="your_db_url"
$env:BBREF_SCRAPE_DELAY_MS="4000"
$env:MAX_GAMES_PER_RUN="5"  # Test with fewer games

# Test locally
npm run test

# Or with tsx directly
tsx index.ts
```

**Expected Output:**
```
Starting box score scraping Lambda...
Found 5 Final games without box scores

[1/5] Processing game: 1842025102199
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
  "processed": 5,
  "successful": 5,
  "failed": 0,
  "totalInserted": 150,
  "durationMs": 45000
}
```

## Environment Variables

- `SUPABASE_DB_URL` (required): Database connection string
- `BBREF_SCRAPE_DELAY_MS` (optional, default: 4000): Rate limiting delay between requests (milliseconds)
- `MAX_GAMES_PER_RUN` (optional, default: 50): Maximum games to process per execution

## How It Works

1. **Query for games:**
   - Finds all Final games without box scores from `games` table
   - Joins with `bbref_games` or `bbref_schedule` to get Basketball Reference team codes
   - Orders by `start_time` (oldest first)
   - Limits to `MAX_GAMES_PER_RUN` games per execution

2. **Process each game:**
   - Extracts game info (home/away team codes, game date)
   - Constructs Basketball Reference box score URL
   - Uses Puppeteer to scrape CSV data from the page
   - Parses CSV and inserts into `scraped_boxscores` table
   - Resolves player names to `player_id` when possible
   - Handles rate limiting (4 seconds between requests)

3. **Error handling:**
   - Continues processing if one game fails
   - Logs errors to CloudWatch with game context
   - Returns summary with success/failure counts

4. **Idempotency:**
   - Checks if box score already exists before processing
   - Uses `ON CONFLICT` UPSERT to prevent duplicates
   - Safe to re-run (won't create duplicates)

## Database Schema

**Target Table:** `scraped_boxscores`

Stores:
- Game and team information
- Player names (with optional resolved player_id)
- All box score statistics (FG, 3P, FT, rebounds, assists, etc.)
- Raw CSV row data (for debugging/reference)
- Timestamps for tracking when data was scraped

**Unique Constraint:** `(game_id, team_code, player_name, source)`
- Prevents duplicates when re-scraping
- Updates existing records if re-run

## Monitoring

### CloudWatch Logs

**Log Group:** `/aws/lambda/boxscore-scraper`

**Key Log Messages:**
- `Starting box score scraping Lambda...`
- `Found X Final games without box scores`
- `[X/Y] Processing game: ...`
- `✅ Success: Inserted X player stats`
- `❌ Failed: ...`
- `=== Summary ===`

### CloudWatch Metrics

- **Invocations:** Number of Lambda executions
- **Errors:** Failed executions
- **Duration:** Execution time
- **Throttles:** Rate limit issues

### Expected Metrics

- **Duration:** ~30-60 seconds per game (with rate limiting)
- **Memory:** ~500-800 MB (Puppeteer usage)
- **Success Rate:** Should be >95% (some games may not have box scores available yet)

## Troubleshooting

### Issue: Lambda timeout

**Symptoms:** Function times out before processing all games

**Solutions:**
- Reduce `MAX_GAMES_PER_RUN` (process fewer games per execution)
- Increase Lambda timeout (max 15 minutes)
- Check if Puppeteer is hanging on specific games

### Issue: Puppeteer errors

**Symptoms:** Browser launch failures or page load timeouts

**Solutions:**
- Increase Lambda memory (Puppeteer needs more memory)
- Check if Basketball Reference is blocking requests
- Verify Puppeteer is properly bundled (check package size)

### Issue: No games found

**Symptoms:** `Found 0 Final games without box scores`

**Solutions:**
- Check if games are marked as `Final` in database
- Verify `scraped_boxscores` table exists
- Check if games already have box scores

### Issue: Player resolution failures

**Symptoms:** Many unresolved players in logs

**Solutions:**
- Run player resolution script separately: `tsx scripts/resolve-missing-player-ids.ts`
- Check `players` and `player_team_rosters` tables have data
- Verify team abbreviations match between BBRef and database

### Issue: Rate limiting

**Symptoms:** 429 errors or timeouts from Basketball Reference

**Solutions:**
- Increase `BBREF_SCRAPE_DELAY_MS` (default: 4000ms)
- Reduce `MAX_GAMES_PER_RUN` to process fewer games per run
- Spread processing across multiple Lambda invocations

## Cost Estimate

**EventBridge:**
- First 1 million events/month: **FREE** ✅
- Our usage: 30 events/month (one per day)
- **Cost: $0.00**

**Lambda:**
- First 1 million requests/month: **FREE** ✅
- Our usage: 30 invocations/month
- Compute time: ~15 minutes/day × 30 days = 450 minutes/month
- First 400,000 GB-seconds/month: **FREE** ✅
- **Cost: $0.00** (well within free tier)

**Total AWS Cost: $0.00** ✅

## What Gets Stored

**Per Game:**
- All player box score statistics
- Team codes (Basketball Reference format)
- Player names (with resolved player_id when possible)
- Raw CSV data (for debugging)

**Storage:**
- Table: `scraped_boxscores`
- Source: `bbref_csv`
- Idempotent: Safe to re-run (won't create duplicates)

## Next Steps

After deployment:

1. ✅ **Monitor first few runs** (check CloudWatch logs)
2. ✅ **Verify data quality** (check `scraped_boxscores` table)
3. ✅ **Check player resolution** (run resolution script if needed)
4. ✅ **Set up alerts** (optional - CloudWatch alarms for failures)

## Notes

- **Puppeteer Size:** Puppeteer adds ~300MB to package size. Consider using Lambda layers or container images if package exceeds limits.
- **Rate Limiting:** Critical to avoid being blocked by Basketball Reference. Default 4 seconds between requests.
- **Timeout:** 15 minutes allows processing ~50 games with rate limiting. Adjust `MAX_GAMES_PER_RUN` if needed.
- **Memory:** 1024 MB recommended for Puppeteer. May need adjustment based on actual usage.

---

_Last updated: 2025-01-15_

