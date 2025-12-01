# Box Score Scripts - Final Summary

## ✅ Remaining Scripts (Basketball Reference Only)

### 1. `scrape-basketball-reference.ts` ⭐ **PRIMARY SCRAPER**
- **Purpose:** Core HTML scraper for Basketball Reference
- **Method:** HTML scraping with cheerio (no Puppeteer)
- **Storage:** `player_game_stats` table
- **Status:** ✅ WORKING (tested successfully)
- **Usage:**
  ```bash
  tsx scripts/scrape-basketball-reference.ts --game-id 0022500264
  tsx scripts/scrape-basketball-reference.ts --game-date 2025-11-20 --home-team ORL
  ```
- **Rate Limit:** 15 requests/minute (4 second delay)

### 2. `backfill-boxscores-bbref.ts` ✅ **BACKFILL WRAPPER**
- **Purpose:** Backfill missing box scores using Basketball Reference
- **Method:** Wrapper that uses `scrape-basketball-reference.ts`
- **Storage:** `player_game_stats` table
- **Status:** ✅ WORKING (tested successfully)
- **Usage:**
  ```bash
  tsx scripts/backfill-boxscores-bbref.ts                    # All missing games up to yesterday
  tsx scripts/backfill-boxscores-bbref.ts --max-games 50     # Limit to 50 games
  tsx scripts/backfill-boxscores-bbref.ts --start-date 2025-10-21 --end-date 2025-11-17
  tsx scripts/backfill-boxscores-bbref.ts --dry-run           # Test without making changes
  ```

### 3. `reseed-boxscores-bbref.ts` ✅ **RESEED WRAPPER**
- **Purpose:** Re-fetch existing box scores for accuracy
- **Method:** Uses `scrape-basketball-reference.ts`
- **Storage:** `player_game_stats` table (updates existing)
- **Status:** ✅ WORKING (uses working scraper)
- **Usage:**
  ```bash
  tsx scripts/reseed-boxscores-bbref.ts --dry-run  # Preview
  tsx scripts/reseed-boxscores-bbref.ts --date 2025-11-20  # Specific date
  tsx scripts/reseed-boxscores-bbref.ts --days-back 7  # Last 7 days
  tsx scripts/reseed-boxscores-bbref.ts --month 2025-10  # All games in October
  ```

## ❌ Removed Scripts

The following scripts were removed because they don't use Basketball Reference:

- ❌ `scrape-bbref-csv-boxscores.ts` - CSV scraper (not working, uses Puppeteer)
- ❌ `fetch-missing-boxscores.ts` - NBA Stats API
- ❌ `retry-missing-boxscores.ts` - NBA Stats API
- ❌ `seed_boxscores_nba.py` - NBA Stats API
- ❌ `daily-boxscore-seed.py` - Multi-source (NBA Stats → BBRef → NBA.com)
- ❌ `daily-boxscore-seed-simple.py` - Multi-source (BBRef → NBA Stats)

## Lambda Function

The Lambda function `lambda/boxscore-scraper/` uses the same HTML scraping approach as `scrape-basketball-reference.ts` and is ready for deployment.

## Recommended Workflow

**Daily Automation:**
- Use Lambda function (scheduled via EventBridge at 03:00 ET)

**Manual Backfill:**
- Use `backfill-boxscores-bbref.ts` for historical games

**Data Quality:**
- Use `reseed-boxscores-bbref.ts` to refresh existing box scores

**Single Game:**
- Use `scrape-basketball-reference.ts` directly

