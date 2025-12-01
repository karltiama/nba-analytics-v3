# Box Score Scripts Analysis

## Current Box Score Scripts

### TypeScript Scripts

#### 1. `scrape-basketball-reference.ts` ✅ **KEEP - PRIMARY**
- **Purpose:** Core HTML scraper for Basketball Reference
- **Method:** HTML scraping with cheerio (no Puppeteer)
- **Storage:** `player_game_stats` table
- **Status:** ✅ WORKING (confirmed by user)
- **Usage:** Single game or batch processing
- **Rate Limit:** 15 requests/minute (4 second delay)

#### 2. `scrape-bbref-csv-boxscores.ts` ❌ **REMOVE**
- **Purpose:** CSV scraper using Puppeteer
- **Method:** Puppeteer to extract CSV data
- **Storage:** `scraped_boxscores` table
- **Status:** ❌ NOT WORKING (tests show 0 tables found)
- **Issues:** Requires Puppeteer (~300MB), complex, unreliable
- **Recommendation:** DELETE - use HTML scraper instead

#### 3. `backfill-boxscores-bbref.ts` ✅ **KEEP**
- **Purpose:** Backfill missing box scores using BBRef
- **Method:** Wrapper that uses `scrape-basketball-reference.ts`
- **Storage:** `player_game_stats` table
- **Status:** ✅ WORKING (uses working scraper)
- **Usage:** Backfill games up to yesterday
- **Recommendation:** KEEP - useful for backfilling

#### 4. `fetch-missing-boxscores.ts` ⚠️ **REVIEW**
- **Purpose:** Fetch box scores from NBA.com
- **Method:** NBA.com API/scraping
- **Storage:** `player_game_stats` table
- **Status:** Unknown (needs testing)
- **Recommendation:** TEST - may be useful as fallback

#### 5. `retry-missing-boxscores.ts` ⚠️ **REVIEW**
- **Purpose:** Retry failed box scores
- **Method:** Similar to fetch-missing-boxscores (NBA.com)
- **Storage:** `player_game_stats` table
- **Status:** Unknown (needs testing)
- **Recommendation:** TEST - may be duplicate of fetch-missing-boxscores

#### 6. `reseed-boxscores-bbref.ts` ✅ **KEEP**
- **Purpose:** Re-fetch existing box scores (for accuracy)
- **Method:** Uses `scrape-basketball-reference.ts`
- **Storage:** `player_game_stats` table (updates existing)
- **Status:** ✅ WORKING (uses working scraper)
- **Usage:** Reseed specific dates or all games
- **Recommendation:** KEEP - useful for data quality

### Python Scripts

#### 7. `daily-boxscore-seed.py` ⚠️ **CONSOLIDATE**
- **Purpose:** Multi-source fallback (NBA Stats → BBRef → NBA.com)
- **Method:** Calls other scripts
- **Storage:** `player_game_stats` table
- **Status:** Unknown (needs testing)
- **Recommendation:** TEST - may be useful but complex

#### 8. `daily-boxscore-seed-simple.py` ⚠️ **CONSOLIDATE**
- **Purpose:** Simpler version (BBRef → NBA Stats)
- **Method:** Calls TypeScript scraper + Python NBA Stats
- **Storage:** `player_game_stats` table
- **Status:** Unknown (needs testing)
- **Recommendation:** TEST - simpler than daily-boxscore-seed.py

#### 9. `seed_boxscores_nba.py` ✅ **KEEP**
- **Purpose:** NBA Stats API box scores (official source)
- **Method:** Official NBA Stats API
- **Storage:** `player_game_stats` table
- **Status:** Unknown (needs testing)
- **Recommendation:** KEEP - official source, useful as fallback

## Recommended Cleanup Plan

### Phase 1: Test All Scripts
1. Test each script with a known game that has box scores
2. Document which ones work and which don't
3. Identify duplicates

### Phase 2: Consolidate
**Keep:**
- ✅ `scrape-basketball-reference.ts` - Primary scraper (WORKING)
- ✅ `backfill-boxscores-bbref.ts` - Backfill wrapper (WORKING)
- ✅ `reseed-boxscores-bbref.ts` - Reseed wrapper (WORKING)
- ✅ `seed_boxscores_nba.py` - NBA Stats API (official source)

**Remove:**
- ❌ `scrape-bbref-csv-boxscores.ts` - Not working, use HTML scraper

**Test & Decide:**
- ⚠️ `fetch-missing-boxscores.ts` - Test if useful as fallback
- ⚠️ `retry-missing-boxscores.ts` - Test if different from fetch-missing
- ⚠️ `daily-boxscore-seed.py` - Test if useful (complex)
- ⚠️ `daily-boxscore-seed-simple.py` - Test if useful (simpler)

### Phase 3: Create Unified Script
After testing, create one main script that:
- Uses BBRef HTML scraper (primary)
- Falls back to NBA Stats API if needed
- Handles all use cases (backfill, daily, retry)

## Testing Plan

For each script, test with:
- A game ID that definitely has a box score available
- Document success/failure
- Note any issues

