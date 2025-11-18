# Script Cleanup Summary

## ✅ KEEP (Production/Useful Scripts)

These scripts are documented, reusable, and part of the maintenance workflow:

1. **`check-data-quality.ts`** - Comprehensive data quality checker
   - Checks duplicates, missing mappings, inconsistent scores, orphaned records
   - Documented with usage examples
   - Referenced in `reseed-database.md`

2. **`cleanup-duplicate-games.ts`** - Production cleanup script
   - Removes duplicate games intelligently
   - Migrates associated data
   - Has dry-run mode
   - Documented with usage examples

3. **`cleanup-orphaned-mappings.ts`** - Cleanup utility
   - Removes orphaned provider mappings
   - Simple, useful script

4. **`fix-inconsistent-scores.ts`** - Data fix script
   - Fixes games with inconsistent score/status
   - Useful maintenance script

5. **`seed-full-season-schedule.ts`** - Production seeding script
   - Seeds entire season schedule
   - Documented with usage examples
   - Idempotent (safe to run multiple times)

6. **`reseed-database.md`** - Documentation
   - Guides users through database maintenance
   - References the above scripts

7. **`update-game-statuses.py`** - ETL utility
   - Updates game statuses from scores
   - Useful for daily ETL

8. **`update-scores-from-stats.py`** - ETL utility
   - Updates game scores from player stats
   - Useful for daily ETL

---

## ❌ DELETE (One-off Diagnostic Scripts)

These are one-time diagnostic scripts that are no longer needed:

### November-specific checks:
- `check-all-nov-games.ts`
- `check-nov11-games.ts`
- `check-game-matching-november.ts`
- `test-nba-api-november.py`

### Superseded by `check-data-quality.ts`:
- `check-duplicate-games.ts` (functionality covered)
- `check-schedule-duplicates.ts` (functionality covered)
- `check-date-offset-duplicates.ts` (functionality covered)
- `check-final-games.ts` (functionality covered)
- `check-games-status.ts` (functionality covered)
- `check-nba-stats-final.ts` (functionality covered)
- `check-nba-stats-missing.ts` (functionality covered)
- `check-recent-games.ts` (functionality covered)

### One-off debug scripts:
- `debug-specific-game.ts`
- `verify-nba-seeding.ts`

### Specific event checks:
- `check-nba-cup-games.ts`

---

## 🤔 MAYBE DELETE (One-time Migration Scripts)

These were likely used for one-time migrations and may no longer be needed:

- `copy-stats-to-bdl-games.py` - One-time migration to copy stats
- `fix-bdl-games.ts` - One-time fix for BDL games
- `seed-nba-then-crossref-bdl.py` - One-time seeding workflow

**Recommendation**: If these migrations are complete, delete them. If you might need to run them again, keep them but add a comment explaining they're one-time migration scripts.

---

## Summary

**Keep**: 8 scripts + 1 doc file
**Delete**: ~15 diagnostic scripts
**Maybe Delete**: 3 migration scripts (review first)

