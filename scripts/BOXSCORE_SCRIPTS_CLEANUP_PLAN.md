# Box Score Scripts Cleanup Plan

## Test Results

### ✅ Working Scripts

1. **`scrape-basketball-reference.ts`** ✅
   - **Test:** ✅ WORKING - Successfully scraped game 0022500264
   - **Result:** Inserted 24 player stats
   - **Status:** KEEP - This is the primary working scraper

2. **`backfill-boxscores-bbref.ts`** ✅
   - **Test:** ✅ WORKING - Dry run successful
   - **Uses:** `scrape-basketball-reference.ts`
   - **Status:** KEEP - Useful wrapper for backfilling

### ⚠️ Scripts to Test

3. **`fetch-missing-boxscores.ts`**
   - **Purpose:** Fetch from NBA Stats API (stats.nba.com)
   - **Method:** Official NBA Stats API
   - **Status:** NEEDS TESTING
   - **Note:** Different source than BBRef (official but delayed)

4. **`retry-missing-boxscores.ts`**
   - **Purpose:** Retry failed box scores (1+ day old)
   - **Method:** NBA Stats API (same as fetch-missing-boxscores)
   - **Status:** NEEDS TESTING
   - **Note:** Very similar to fetch-missing-boxscores - may be duplicate

5. **`reseed-boxscores-bbref.ts`**
   - **Purpose:** Re-fetch existing box scores for accuracy
   - **Method:** Uses `scrape-basketball-reference.ts`
   - **Status:** LIKELY WORKING (uses working scraper)
   - **Note:** Useful for data quality

6. **`seed_boxscores_nba.py`**
   - **Purpose:** NBA Stats API box scores (official)
   - **Method:** Official NBA Stats API via nba_api package
   - **Status:** NEEDS TESTING
   - **Note:** Python version of NBA Stats API fetching

7. **`daily-boxscore-seed.py`**
   - **Purpose:** Multi-source fallback (NBA Stats → BBRef → NBA.com)
   - **Method:** Calls other scripts
   - **Status:** NEEDS TESTING
   - **Note:** Complex, may be overkill

8. **`daily-boxscore-seed-simple.py`**
   - **Purpose:** Simpler fallback (BBRef → NBA Stats)
   - **Method:** Calls TypeScript scraper + Python NBA Stats
   - **Status:** NEEDS TESTING
   - **Note:** Simpler than daily-boxscore-seed.py

### ❌ Scripts to Remove

9. **`scrape-bbref-csv-boxscores.ts`** ❌
   - **Status:** NOT WORKING (tests show 0 tables found)
   - **Issues:** Requires Puppeteer, complex, unreliable
   - **Action:** DELETE - use HTML scraper instead

## Recommended Cleanup Actions

### Immediate Actions

1. **DELETE:** `scrape-bbref-csv-boxscores.ts` (not working)

2. **TEST:** All remaining scripts with a known game ID

3. **CONSOLIDATE:** After testing, identify duplicates:
   - `fetch-missing-boxscores.ts` vs `retry-missing-boxscores.ts` (both use NBA Stats API)
   - `daily-boxscore-seed.py` vs `daily-boxscore-seed-simple.py` (both do similar things)
   - `seed_boxscores_nba.py` vs `fetch-missing-boxscores.ts` (both use NBA Stats API)

### Keep Structure

**Primary Scraper:**
- ✅ `scrape-basketball-reference.ts` - HTML scraper (WORKING)

**Wrappers/Utilities:**
- ✅ `backfill-boxscores-bbref.ts` - Backfill wrapper (WORKING)
- ✅ `reseed-boxscores-bbref.ts` - Reseed wrapper (LIKELY WORKING)

**Fallback Sources (after testing):**
- ⚠️ One NBA Stats API script (consolidate fetch/retry/seed)
- ⚠️ One daily seeding script (consolidate daily-boxscore-seed variants)

## Next Steps

1. Test all remaining scripts
2. Document which ones work
3. Remove duplicates
4. Create unified daily script if needed

