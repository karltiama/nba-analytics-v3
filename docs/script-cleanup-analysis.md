# Script Cleanup Analysis - Git Changes Review

## ✅ KEEP (Production Scripts)

### New Production Scripts:
1. **`backfill-team-stats.ts`** ✅ **KEEP**
   - Aggregates team stats from player_game_stats
   - Backfills missing team_game_stats records
   - Production-ready, useful for maintenance

2. **`backfill-boxscores-bbref.ts`** ✅ **KEEP**
   - Backfills box scores from Basketball Reference
   - Production script for data recovery

3. **`fetch-missing-boxscores.ts`** ✅ **KEEP**
   - Fetches missing box scores from NBA API
   - Production script for data recovery

4. **`retry-missing-boxscores.ts`** ✅ **KEEP**
   - Retries failed box score fetches
   - Production script for error recovery

5. **`scrape-basketball-reference.ts`** ✅ **KEEP**
   - Scrapes box scores from Basketball Reference
   - Production script with rate limiting
   - Well-documented

6. **`scrape-nba-com.ts`** ✅ **KEEP**
   - Scrapes box scores from NBA.com
   - Production script for alternative data source

7. **`update-scores-from-boxscores.ts`** ✅ **KEEP**
   - Updates game scores from box score data
   - Production script for data maintenance

8. **`fix-incorrect-statuses.ts`** ✅ **KEEP**
   - Fixes games with incorrect statuses
   - Has dry-run mode, production-ready

### Modified Production Scripts:
9. **`check-data-quality.ts`** ✅ **KEEP** (modified)
   - Comprehensive data quality checker
   - Now includes checks for missing team_game_stats
   - Production script

10. **`update-game-statuses.py`** ✅ **KEEP** (modified)
    - Updates game statuses
    - Production ETL script

11. **`update-scores-from-stats.py`** ✅ **KEEP** (modified)
    - Updates scores from player stats
    - Production ETL script

### Useful Diagnostic Scripts:
12. **`investigate-missing-team-stats.ts`** ✅ **KEEP**
    - Useful diagnostic script we created
    - Helps debug data quality issues
    - Can be reused for future investigations

---

## ❌ DELETE (One-off Diagnostic Scripts)

These scripts were created for debugging specific issues and their functionality is now covered by `check-data-quality.ts`:

1. **`check-boxscore-details.ts`** ❌ **DELETE**
   - One-off diagnostic for checking box score details
   - Functionality covered by check-data-quality.ts

2. **`check-date-range.ts`** ❌ **DELETE**
   - One-off diagnostic for checking date ranges
   - Functionality covered by check-data-quality.ts

3. **`check-incorrect-statuses.ts`** ❌ **DELETE**
   - One-off diagnostic for incorrect statuses
   - Functionality merged into check-data-quality.ts
   - Use `fix-incorrect-statuses.ts` for fixing

4. **`check-missing-boxscores.ts`** ❌ **DELETE**
   - One-off diagnostic for missing box scores
   - Functionality merged into check-data-quality.ts
   - Use `fetch-missing-boxscores.ts` or `backfill-boxscores-bbref.ts` for fixing

5. **`check-nov19-games.ts`** ❌ **DELETE**
   - One-off diagnostic for specific date (Nov 19)
   - No longer needed

6. **`check-potential-missing.ts`** ❌ **DELETE**
   - One-off diagnostic for potential missing data
   - Functionality covered by check-data-quality.ts

7. **`check-score-mismatches.ts`** ❌ **DELETE**
   - One-off diagnostic for score mismatches
   - Functionality merged into check-data-quality.ts

---

## ❌ DELETE (Test Scripts)

1. **`test-html-boxscore.ts`** ❌ **DELETE**
   - Test script for inspecting HTML structure
   - Development/testing only

2. **`test-boxscore-1763556527091.html`** ❌ **DELETE**
   - Test HTML file
   - Not needed in repo

---

## 📚 KEEP (Documentation)

1. **`docs/data-filling-action-plan.md`** ✅ **KEEP**
   - Documentation for data filling strategy

2. **`docs/html-boxscore-scraping.md`** ✅ **KEEP**
   - Documentation for HTML scraping approach

3. **`docs/missing-data-strategies.md`** ✅ **KEEP**
   - Documentation for missing data strategies

4. **`docs/missing-team-stats-root-cause.md`** ✅ **KEEP**
   - Root cause analysis documentation

---

## Summary

### Keep:
- **12 production scripts** (8 new + 3 modified + 1 diagnostic)
- **4 documentation files**

### Delete:
- **7 one-off diagnostic scripts**
- **2 test files**

### Total Files to Delete: 9

---

## Recommended Actions

1. **Delete one-off diagnostic scripts** (functionality covered by check-data-quality.ts)
2. **Delete test files**
3. **Keep all production scripts** - they serve different purposes:
   - `backfill-team-stats.ts` - Aggregates from player stats
   - `backfill-boxscores-bbref.ts` - Fetches from Basketball Reference
   - `fetch-missing-boxscores.ts` - Fetches from NBA API
   - `retry-missing-boxscores.ts` - Retries failed fetches
   - `scrape-basketball-reference.ts` - Scrapes Basketball Reference
   - `scrape-nba-com.ts` - Scrapes NBA.com
   - `update-scores-from-boxscores.ts` - Updates scores from boxscores
   - `fix-incorrect-statuses.ts` - Fixes status issues

4. **Update SCRIPTS_REMAINING.md** to reflect new scripts

