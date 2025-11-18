# Final Script Cleanup Guide

## ✅ KEEP (Production/Maintenance Scripts)

### Data Quality & Maintenance:
1. **`check-data-quality.ts`** ✅ - Comprehensive data quality checker
   - Checks duplicates, missing mappings, inconsistent scores, orphaned records
   - Documented, referenced in reseed-database.md

2. **`cleanup-duplicate-games.ts`** ✅ - Production cleanup script
   - Removes duplicate games intelligently
   - Migrates box scores and copies scores
   - Has dry-run mode, documented

3. **`cleanup-orphaned-mappings.ts`** ✅ - Cleanup utility
   - Removes orphaned provider mappings

4. **`fix-inconsistent-scores.ts`** ✅ - Data fix script
   - Fixes games with inconsistent score/status

5. **`fix-game-statuses.ts`** ✅ - Data fix script (NEW)
   - Fixes incorrectly formatted game statuses
   - Has dry-run mode, documented

### Seeding Scripts:
6. **`seed-full-season-schedule.ts`** ✅ - Production seeding
   - Seeds entire season schedule from BallDontLie
   - Idempotent, documented

7. **`seed_boxscores_nba.py`** ✅ - Production seeding
   - Fetches box scores from NBA Stats API
   - Used in daily ETL

8. **`seed_games_nba.py`** ✅ - Production seeding
   - Seeds games from NBA Stats API

9. **`seed_players_nba.py`** ✅ - Production seeding
   - Seeds players and rosters from NBA Stats API

10. **`seed-teams.ts`** ✅ - Production seeding
    - Seeds teams data

11. **`seed-players.ts`** ✅ - Production seeding
    - Alternative player seeding script

### ETL Scripts:
12. **`run_day_seed.py`** ✅ - Daily ETL
    - Seeds games for a single date

13. **`update-game-statuses.py`** ✅ - ETL utility
    - Updates game statuses from scores

14. **`update-scores-from-stats.py`** ✅ - ETL utility
    - Updates game scores from player stats

15. **`sync-game-provider-mappings.py`** ✅ - ETL utility
    - Syncs provider ID mappings

### Documentation:
16. **`reseed-database.md`** ✅ - Documentation
    - Guides users through database maintenance

17. **`SCRIPT_CLEANUP_SUMMARY.md`** ✅ - Documentation
    - Previous cleanup summary (keep for reference)

---

## ❌ DELETE (One-off Diagnostic Scripts)

These were created for debugging specific issues and are no longer needed:

### Recently Created Diagnostic Scripts:
- `check-duplicates-detailed.ts` - One-off diagnostic for duplicate games
- `check-game-statuses.ts` - One-off diagnostic for status issues
- `check-roster-data.ts` - One-off diagnostic for roster data

### Other Diagnostic Scripts:
- `check-date-mismatch.ts` - Diagnostic
- `check-game-mappings.ts` - Diagnostic
- `check-games.ts` - Diagnostic
- `check-null-scores.ts` - Diagnostic
- `check-team-abbreviations.ts` - Diagnostic
- `check_player_issues.py` - Diagnostic
- `diagnose-game-matching.ts` - Diagnostic

---

## 🧪 DELETE (Test Scripts)

All test scripts for API endpoints - these are for development/testing, not production:

- `test_all_boxscore_endpoints.py`
- `test_boxscore_summary.py`
- `test_nba_boxscore.py`
- `test_nba_scoreboard.py`
- `test_past_game_boxscore.py`
- `test_playbyplay_quarters.py`
- `test_quarter_data.py`
- `test_quarter_endpoints_comprehensive.py`
- `test_quarter_endpoints.py`
- `test_seed_boxscore.py`
- `test_traditional_v3.py`
- `test_v3_endpoints.py`
- `test_v3_full_stats.py`
- `test_v3_periods.py`
- `test_v3_raw_structure.py`
- `test_v3_raw.py`
- `test_v3_team_structure.py`
- `test_v3_teams.py`
- `test-api-response.ts`

---

## 🤔 REVIEW (Migration/Alternative Scripts)

These might be one-time migrations or superseded by newer scripts:

1. **`copy-stats-to-bdl-games.py`** - One-time migration
   - Copies stats from NBA Stats games to BallDontLie games
   - **Recommendation**: DELETE if migration is complete

2. **`fix-bdl-games.ts`** - One-time fix
   - Fixed BDL games issues
   - **Recommendation**: DELETE if fix is complete

3. **`seed-nba-then-crossref-bdl.py`** - One-time seeding workflow
   - **Recommendation**: DELETE if workflow is no longer used

4. **`seed-games-bdl.ts`** - Alternative seeding script
   - Seeds games from BallDontLie
   - **Recommendation**: KEEP if still used, otherwise DELETE (superseded by seed-full-season-schedule.ts)

5. **`fetch_balldontlie_games.js`** - Alternative fetching script
   - **Recommendation**: KEEP if still used, otherwise DELETE

6. **`backfill_quarter_data.py`** - Quarter data backfill
   - **Recommendation**: KEEP if useful for ETL, otherwise DELETE

---

## Summary

**KEEP**: ~17 production/maintenance scripts + 2 docs
**DELETED**: 9 diagnostic scripts + 18 test scripts + 3 migration scripts = 30 scripts ✅
**REVIEW**: 3 scripts remaining (seed-games-bdl.ts, fetch_balldontlie_games.js, backfill_quarter_data.py)

---

## ✅ DELETED Scripts (30 total)

### Diagnostic Scripts (9):
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

### Test Scripts (18):
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

### Migration Scripts (3):
- copy-stats-to-bdl-games.py
- fix-bdl-games.ts
- seed-nba-then-crossref-bdl.py

