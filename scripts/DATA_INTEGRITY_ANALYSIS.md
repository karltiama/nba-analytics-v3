# Data Integrity & Script Cleanup Analysis

## Executive Summary

This document identifies data integrity issues and provides a cleanup plan for scripts that overwrite data. The main concerns are:

1. **Unconditional overwrites** - Scripts overwrite existing data without checking if it's better
2. **Overlapping functionality** - Multiple scripts update the same fields, causing conflicts
3. **No data validation** - Scripts don't validate data quality before overwriting
4. **Missing safeguards** - No protection against overwriting good data with bad data

---

## Critical Issues Found

### 1. Game Score Overwrites

**Problem**: Multiple scripts unconditionally overwrite `home_score` and `away_score`:

#### Scripts with unconditional score overwrites:

1. **`seed_games_nba.py`** (lines 120-129)
   ```python
   on conflict (game_id) do update set
       home_score = excluded.home_score,  # ❌ Overwrites even if NULL
       away_score = excluded.away_score,  # ❌ Overwrites even if NULL
   ```
   - **Issue**: NBA Stats API sometimes returns games without scores, overwriting existing scores with NULL
   - **Risk**: HIGH - Can lose correct scores

2. **`seed-full-season-schedule.ts`** (lines 199-208)
   ```typescript
   on conflict (game_id) do update set
       home_score = excluded.home_score,  # ❌ Overwrites even if NULL
       away_score = excluded.away_score,  # ❌ Overwrites even if NULL
   ```
   - **Issue**: BallDontLie API may not have scores for all games
   - **Risk**: MEDIUM - Schedule seeding shouldn't overwrite scores

3. **`scrape-nba-com.ts`** (lines 561-564)
   ```typescript
   ON CONFLICT (game_id) DO UPDATE SET
       home_score = EXCLUDED.home_score,  # ❌ Overwrites unconditionally
       away_score = EXCLUDED.away_score,  # ❌ Overwrites unconditionally
   ```
   - **Issue**: Scraping may have incomplete data
   - **Risk**: MEDIUM

#### Scripts that correctly protect scores:

✅ **`update-scores-from-stats.py`** - Only updates if scores are NULL (line 41-42)
✅ **`update-scores-from-boxscores.ts`** - Only updates games with missing scores (line 38)
✅ **`fix-inconsistent-scores.ts`** - Only fixes inconsistencies, doesn't overwrite good data

---

### 2. Game Status Overwrites

**Problem**: Multiple scripts update status without checking if existing status is correct:

#### Scripts updating status:

1. **`seed_games_nba.py`** (line 123)
   ```python
   status = excluded.status,  # ❌ Overwrites unconditionally
   ```
   - **Issue**: May overwrite "Final" with "Scheduled" if API data is stale
   - **Risk**: HIGH

2. **`seed-full-season-schedule.ts`** (line 202)
   ```typescript
   status = excluded.status,  # ❌ Overwrites unconditionally
   ```
   - **Issue**: Schedule seeding shouldn't change status of completed games
   - **Risk**: MEDIUM

3. **`update-game-statuses.py`** (line 27)
   ```python
   SET status = 'Final'  # ✅ Only updates if status != 'Final'
   ```
   - **Status**: ✅ Safe - Only updates non-Final games

4. **`fix-incorrect-statuses.ts`** (line 154)
   ```typescript
   UPDATE games SET status = $1  # ✅ Only fixes incorrect statuses
   ```
   - **Status**: ✅ Safe - Only fixes logical inconsistencies

5. **`fix-game-statuses.ts`** (line 132)
   ```typescript
   UPDATE games SET status = $1  # ✅ Only fixes invalid statuses
   ```
   - **Status**: ✅ Safe - Only fixes NULL or invalid values

---

### 3. Overlapping Scripts

#### Score Update Scripts (3 scripts doing similar things):

1. **`update-scores-from-stats.py`** ✅
   - Updates scores from aggregated player stats
   - Only updates if scores are NULL
   - **Recommendation**: KEEP - Primary method

2. **`update-scores-from-boxscores.ts`** ✅
   - Updates scores from Basketball Reference scraping
   - Only updates if scores are NULL
   - **Recommendation**: KEEP - Fallback method

3. **`fix-inconsistent-scores.ts`** ✅
   - Fixes games where scores don't match box scores
   - **Recommendation**: KEEP - Data quality fix

**Action**: These are complementary, not duplicates. Keep all three.

#### Status Update Scripts (3 scripts):

1. **`update-game-statuses.py`** ✅
   - Sets status to 'Final' if game has scores
   - **Recommendation**: KEEP - ETL utility

2. **`fix-incorrect-statuses.ts`** ✅
   - Fixes logical inconsistencies (past games marked Scheduled, etc.)
   - **Recommendation**: KEEP - Data quality fix

3. **`fix-game-statuses.ts`** ✅
   - Fixes NULL or invalid status values
   - **Recommendation**: KEEP - Data quality fix

**Action**: These handle different cases. Keep all three.

---

### 4. Seeding Script Conflicts

**Problem**: Multiple scripts seed games from different sources:

1. **`seed-full-season-schedule.ts`** - Seeds from BallDontLie (full season)
2. **`seed-games-bdl.ts`** - Seeds from BallDontLie (date range)
3. **`seed_games_nba.py`** - Seeds from NBA Stats API

**Issue**: Running these in different orders can overwrite data differently.

**Recommendation**: 
- Use `seed-full-season-schedule.ts` for initial season seeding
- Use `seed_games_nba.py` only for box score fetching (it also seeds games)
- Consider deprecating `seed-games-bdl.ts` if superseded by `seed-full-season-schedule.ts`

---

## Recommended Fixes

### Priority 1: Protect Scores in UPSERTs

**Fix**: Modify game UPSERTs to only update scores if:
1. Existing score is NULL, OR
2. New score is NOT NULL (don't overwrite with NULL)

**Files to fix**:
- `scripts/seed_games_nba.py` - Line 120-129
- `scripts/seed-full-season-schedule.ts` - Line 199-208
- `scripts/scrape-nba-com.ts` - Line 561-564

### Priority 2: Protect Status in UPSERTs

**Fix**: Modify game UPSERTs to only update status if:
1. Existing status is NULL or invalid, OR
2. New status is more complete (e.g., "Final" > "Scheduled")

**Files to fix**:
- `scripts/seed_games_nba.py` - Line 123
- `scripts/seed-full-season-schedule.ts` - Line 202

### Priority 3: Add Data Validation

**Fix**: Create helper functions to validate data before UPSERTs:
- Check if scores are reasonable (0-200 range)
- Check if status transitions are valid
- Log warnings when overwriting non-NULL values

### Priority 4: Consolidate Scripts

**Action**: Document clear usage guidelines:
- Which script to use for what purpose
- When to run each script
- Order of operations

---

## Script Usage Guidelines

### Daily ETL Workflow

1. **Seed games for today**: `run_day_seed.py`
2. **Update game statuses**: `update-game-statuses.py`
3. **Fetch box scores**: `seed_boxscores_nba.py`
4. **Update scores from stats**: `update-scores-from-stats.py` (if needed)

### Initial Season Setup

1. **Seed full schedule**: `seed-full-season-schedule.ts --season 2025`
2. **Sync provider mappings**: `sync-game-provider-mappings.py`
3. **Fetch box scores**: `seed_boxscores_nba.py`

### Data Quality Maintenance

1. **Check data quality**: `check-data-quality.ts`
2. **Fix status issues**: `fix-incorrect-statuses.ts --dry-run` (review), then run without dry-run
3. **Fix score inconsistencies**: `fix-inconsistent-scores.ts`
4. **Clean duplicates**: `cleanup-duplicate-games.ts --dry-run` (review), then run

### Score Backfilling

1. **From player stats**: `update-scores-from-stats.py --start-date YYYY-MM-DD`
2. **From Basketball Reference**: `update-scores-from-boxscores.ts --start-date YYYY-MM-DD`

---

## Implementation Plan

### Phase 1: Critical Fixes (Do First)
- [ ] Fix score overwrites in `seed_games_nba.py`
- [ ] Fix score overwrites in `seed-full-season-schedule.ts`
- [ ] Fix score overwrites in `scrape-nba-com.ts`
- [ ] Fix status overwrites in `seed_games_nba.py`
- [ ] Fix status overwrites in `seed-full-season-schedule.ts`

### Phase 2: Validation & Safety
- [ ] Add data validation helpers
- [ ] Add logging for overwrite warnings
- [ ] Add dry-run modes where missing

### Phase 3: Documentation
- [ ] Create script usage guide
- [ ] Document ETL workflow
- [ ] Add comments to scripts explaining their purpose

### Phase 4: Testing
- [ ] Test UPSERT fixes with existing data
- [ ] Verify no data loss
- [ ] Test edge cases (NULL values, invalid data)

---

## Safe Scripts (No Changes Needed)

These scripts already have proper safeguards:

✅ `update-scores-from-stats.py` - Only updates NULL scores
✅ `update-scores-from-boxscores.ts` - Only updates NULL scores
✅ `update-game-statuses.py` - Only updates non-Final games
✅ `fix-incorrect-statuses.ts` - Only fixes logical issues
✅ `fix-game-statuses.ts` - Only fixes invalid values
✅ `fix-inconsistent-scores.ts` - Only fixes inconsistencies
✅ `cleanup-duplicate-games.ts` - Has dry-run mode, preserves best data

---

## Summary

**Critical Issues**: 5 scripts need fixes to prevent data loss
**Overlapping Scripts**: None need deletion, but usage guidelines needed
**Safe Scripts**: 7 scripts already have proper safeguards

**Next Steps**: 
1. Implement Priority 1 fixes (score protection)
2. Implement Priority 2 fixes (status protection)
3. Add validation and logging
4. Create usage documentation

