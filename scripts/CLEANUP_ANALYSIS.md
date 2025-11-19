# Script Cleanup Analysis - Based on Git Changes

## Current State Analysis

Based on git history and current files, here's what exists and what's safe to delete:

---

## ✅ KEEP - All Current Scripts (26 scripts)

### Data Quality & Maintenance (8 scripts):
1. **`check-data-quality.ts`** ✅ - Comprehensive data quality checker
   - Modified in recent commits
   - Production script

2. **`cleanup-duplicate-games.ts`** ✅ - Remove duplicate games
   - Production cleanup script

3. **`cleanup-orphaned-mappings.ts`** ✅ - Remove orphaned mappings
   - Production cleanup script

4. **`fix-inconsistent-scores.ts`** ✅ - Fix score/status inconsistencies
   - Production fix script

5. **`fix-game-statuses.ts`** ✅ - Fix incorrectly formatted statuses
   - Fixes timestamps in status field
   - Production script

6. **`fix-incorrect-statuses.ts`** ✅ - Fix incorrect statuses based on data
   - Modified in recent commits
   - Fixes status logic issues (different from fix-game-statuses.ts)
   - Production script

7. **`investigate-missing-team-stats.ts`** ✅ - Diagnostic for missing team stats
   - Useful diagnostic tool
   - Keep for troubleshooting

8. **`backfill-team-stats.ts`** ✅ - Backfill team_game_stats from player stats
   - Production backfill script
   - Aggregates from player_game_stats

### Box Score Retrieval & Scraping (5 scripts):
9. **`backfill-boxscores-bbref.ts`** ✅ - Backfill box scores from Basketball Reference
   - Modified in recent commits
   - Production script

10. **`fetch-missing-boxscores.ts`** ✅ - Fetch missing box scores from NBA API
    - Production script

11. **`retry-missing-boxscores.ts`** ✅ - Retry failed box score fetches
    - Production script

12. **`scrape-basketball-reference.ts`** ✅ - Scrape box scores from Basketball Reference
    - Modified in recent commits
    - Production script with rate limiting

13. **`scrape-nba-com.ts`** ✅ - Scrape box scores from NBA.com
    - Production script

### Score Update Scripts (2 scripts):
14. **`update-scores-from-boxscores.ts`** ✅ - Update scores from box score data
    - Modified in recent commits
    - Production script

15. **`update-scores-from-stats.py`** ✅ - Update scores from player stats
    - Modified in recent commits
    - Production ETL script

### Seeding Scripts (7 scripts):
16. **`seed-full-season-schedule.ts`** ✅ - Seed entire season from BallDontLie
    - Production seeding

17. **`seed-games-bdl.ts`** ✅ - Seed games from BallDontLie (date range)
    - Alternative seeding method
    - Keep if still used

18. **`seed_boxscores_nba.py`** ✅ - Fetch box scores from NBA Stats
    - Production seeding

19. **`seed_games_nba.py`** ✅ - Seed games from NBA Stats
    - Production seeding

20. **`seed_players_nba.py`** ✅ - Seed players and rosters from NBA Stats
    - Production seeding

21. **`seed-teams.ts`** ✅ - Seed teams
    - Production seeding

22. **`seed-players.ts`** ✅ - Alternative player seeding
    - Production seeding

### ETL Scripts (4 scripts):
23. **`run_day_seed.py`** ✅ - Daily ETL for single date
    - Production ETL

24. **`update-game-statuses.py`** ✅ - Update game statuses
    - Modified in recent commits
    - Production ETL script

25. **`sync-game-provider-mappings.py`** ✅ - Sync provider mappings
    - Production ETL script

26. **`backfill_quarter_data.py`** ✅ - Backfill quarter data for games
    - Production script

---

## 📚 Documentation Files (3 files)

1. **`reseed-database.md`** ✅ - Database maintenance guide
   - Keep - useful documentation

2. **`SCRIPT_CLEANUP_FINAL.md`** ✅ - Previous cleanup documentation
   - Keep - historical reference

3. **`SCRIPTS_REMAINING.md`** ✅ - Current scripts summary
   - Keep - needs update to reflect new scripts

---

## ❌ ALREADY DELETED (from git history)

These scripts were deleted in previous commits and are no longer in the repo:

### Diagnostic Scripts (deleted):
- check-duplicates-detailed.ts
- check-game-statuses.ts
- check-roster-data.ts
- check-date-mismatch.ts
- check-game-mappings.ts
- check-games.ts
- check-null-scores.ts
- check-team-abbreviations.ts
- check_player_issues.py
- diagnose-game-matching.ts

### Test Scripts (deleted):
- test-api-response.ts
- test_all_boxscore_endpoints.py
- test_boxscore_summary.py
- test_nba_boxscore.py
- test_nba_scoreboard.py
- test_past_game_boxscore.py
- test_playbyplay_quarters.py
- test_quarter_data.py
- test_quarter_endpoints.py
- test_quarter_endpoints_comprehensive.py
- test_seed_boxscore.py
- test_traditional_v3.py
- test_v3_endpoints.py
- test_v3_full_stats.py
- test_v3_periods.py
- test_v3_raw.py
- test_v3_raw_structure.py
- test_v3_team_structure.py
- test_v3_teams.py

### Migration Scripts (deleted):
- copy-stats-to-bdl-games.py
- fix-bdl-games.ts
- seed-nba-then-crossref-bdl.py
- fetch_balldontlie_games.js

---

## 🤔 POTENTIAL CONSOLIDATION OPPORTUNITIES

### Similar Scripts (consider consolidating in future):

1. **Status Fix Scripts:**
   - `fix-game-statuses.ts` - Fixes timestamps in status field
   - `fix-incorrect-statuses.ts` - Fixes status logic issues
   - **Recommendation**: Keep both - they handle different issues

2. **Box Score Scripts:**
   - `backfill-boxscores-bbref.ts` - Backfills from Basketball Reference
   - `scrape-basketball-reference.ts` - Scrapes from Basketball Reference
   - **Recommendation**: Keep both - different use cases (backfill vs ongoing scraping)

3. **Score Update Scripts:**
   - `update-scores-from-boxscores.ts` - Updates from box scores
   - `update-scores-from-stats.py` - Updates from player stats
   - **Recommendation**: Keep both - different data sources

---

## 📊 Summary

### Current State:
- **Total Scripts**: 26 production scripts
- **Documentation**: 3 files
- **Already Deleted**: ~30 scripts (diagnostic, test, migration)

### Recommendation:
✅ **KEEP ALL CURRENT SCRIPTS** - All 26 scripts serve production purposes:
- Data quality & maintenance (8)
- Box score retrieval & scraping (5)
- Score updates (2)
- Seeding (7)
- ETL (4)

### Action Items:
1. ✅ No scripts need deletion - cleanup already done
2. 📝 Update `SCRIPTS_REMAINING.md` to reflect all 26 current scripts
3. 📝 Consider adding brief comments to scripts explaining their specific use cases

---

## Notes

- All test scripts have been removed ✅
- All one-off diagnostic scripts have been removed ✅
- All migration scripts have been removed ✅
- Current scripts are all production/maintenance scripts ✅
- Scripts are not imported by other code (standalone scripts) ✅

