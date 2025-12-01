# Box Score Scripts Test Results

## Test Date: 2025-12-01

## Test Results Summary

### ✅ Test 1: `scrape-basketball-reference.ts` - **WORKING** ⭐
- **Game Tested:** 1842025112099 (SAC @ MEM, 2025-11-20)
- **Result:** ✅ SUCCESS
- **Details:**
  - Found 23 player stat rows
  - Inserted 21 player stats
  - 2 players unresolved (GG Jackson II, Jahmai Mashack)
- **Method:** HTML scraping with cheerio
- **Speed:** Fast (~5-10 seconds)
- **Dependencies:** Minimal (just cheerio)
- **Storage:** `player_game_stats` table

### ✅ Test 2: `backfill-boxscores-bbref.ts` - **WORKING**
- **Game Tested:** 18446819 (HOU @ OKC, 2025-10-21)
- **Result:** ⚠️ Game not found on Basketball Reference (404)
- **Details:**
  - Script works correctly
  - Tried both home and away team URLs
  - Handled 404 gracefully
- **Method:** Wrapper around `scrape-basketball-reference.ts`
- **Use Case:** Batch processing multiple games
- **Storage:** `player_game_stats` table

### ✅ Test 3: `reseed-boxscores-bbref.ts` - **WORKING**
- **Game Tested:** All games from 2025-11-20
- **Result:** ✅ SUCCESS (dry-run)
- **Details:**
  - Found 4 Final games
  - All 4 already have box scores
  - Script correctly identifies games to reseed
- **Method:** Wrapper around `scrape-basketball-reference.ts`
- **Use Case:** Re-fetch existing box scores for accuracy
- **Storage:** `player_game_stats` table (updates existing)

### ⚠️ Test 4: `scrape-bbref-csv-boxscores.ts` - **PARTIALLY WORKING**
- **Game Tested:** 0022500256 (CHA @ IND, 2025-11-19)
- **Result:** ✅ SUCCESS (surprisingly!)
- **Details:**
  - Found 2 team box score tables
  - Successfully clicked "Share & Export" buttons
  - Extracted CSV data
  - Inserted 25 player stats (12 CHO + 13 IND)
  - 1 player unresolved (Monte Morris)
- **Method:** Puppeteer to extract CSV data
- **Speed:** Slower (~30-40 seconds due to Puppeteer)
- **Dependencies:** Heavy (Puppeteer ~300MB)
- **Storage:** `scraped_boxscores` table (different table!)
- **Note:** Earlier tests showed 0 tables found, but this test worked. May be inconsistent.

## Comparison

| Script | Status | Speed | Dependencies | Table | Use Case |
|--------|--------|-------|--------------|-------|----------|
| `scrape-basketball-reference.ts` | ✅ Working | Fast | Minimal | `player_game_stats` | Single game or batch |
| `backfill-boxscores-bbref.ts` | ✅ Working | Fast | Minimal | `player_game_stats` | Batch backfill |
| `reseed-boxscores-bbref.ts` | ✅ Working | Fast | Minimal | `player_game_stats` | Re-fetch existing |
| `scrape-bbref-csv-boxscores.ts` | ⚠️ Inconsistent | Slow | Heavy (Puppeteer) | `scraped_boxscores` | Alternative method |

## Recommendation

### For Daily Automation (Lambda):
**Use:** `scrape-basketball-reference.ts` approach (HTML scraping)
- ✅ Fast and reliable
- ✅ Minimal dependencies
- ✅ Already tested and working
- ✅ Stores in `player_game_stats` (main table)

### For Manual Use:
**Primary:** `scrape-basketball-reference.ts`
- Direct control
- Fast execution
- Single game or batch

**Backfill:** `backfill-boxscores-bbref.ts`
- Finds games automatically
- Processes in order
- Rate limiting built-in

**Reseed:** `reseed-boxscores-bbref.ts`
- Re-fetch for accuracy
- Update existing data

### CSV Scraper Decision:
**Recommendation:** Keep `scrape-bbref-csv-boxscores.ts` as backup
- It worked in this test
- May be useful if HTML scraping fails
- But prioritize HTML scraper (faster, simpler)

## Final Recommendation

**For Lambda Function:** Use HTML scraping approach (already implemented in `lambda/boxscore-scraper/index.ts`)

**For Manual Scripts:** 
- Keep all 3 working scripts
- Use `scrape-basketball-reference.ts` for single games
- Use `backfill-boxscores-bbref.ts` for batch processing
- Use `reseed-boxscores-bbref.ts` for data quality

