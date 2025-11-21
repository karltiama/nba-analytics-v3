# Handling Missing Player IDs - Best Practices

## Overview

When scraping box score data, some players may not have a resolved `player_id` due to:
- Name variations (e.g., "J.R. Smith" vs "JR Smith")
- Players not yet in our `players` table
- Typos or formatting differences
- Team roster mismatches

## Current Approach

### ✅ **Store Data Anyway**

**Principle**: Never lose scraped data due to missing relationships.

- Box score data is stored in `scraped_boxscores` even when `player_id` is `NULL`
- `player_name` serves as the source of truth until resolution
- Data can be resolved later without re-scraping

### ✅ **Soft Failures**

**Principle**: Don't fail the entire scrape for one unresolved player.

- Log warnings for unresolved players
- Continue processing remaining players
- Track unresolved players for later resolution

### ✅ **Multiple Resolution Strategies**

The `resolvePlayerId()` function uses 5 strategies in order:

1. **Exact match** (case-insensitive)
2. **Normalized match** (handles "J.R." → "JR", "O'Brien" → "OBrien")
3. **First + Last name match** (handles "Jimmy Butler" vs "Jimmy Butler III")
4. **Last name match** (fuzzy - may have false positives)
5. **Partial match** (contains)

### ✅ **Tracking & Metrics**

- Count unresolved players during scrape
- Display summary at end of scrape
- Show first 10 unresolved players
- Provide tip to run resolution script

## Tools & Scripts

### 1. **SQL View: `unresolved_players`**

Query all unresolved players with stats:

```sql
SELECT * FROM unresolved_players ORDER BY stat_record_count DESC;
```

Shows:
- Player name and team
- Number of games and stat records
- Date range (first_seen, last_seen)
- Sample game IDs

### 2. **Resolution Script: `resolve-missing-player-ids.ts`**

Two modes:

**Auto Mode** (recommended first pass):
```bash
tsx scripts/resolve-missing-player-ids.ts --auto
```
- Automatically resolves using improved fuzzy matching
- Updates all matching records
- Shows summary of resolved vs still unresolved

**Interactive Mode**:
```bash
tsx scripts/resolve-missing-player-ids.ts
```
- Shows each unresolved player
- Displays candidate matches
- Allows manual selection or skipping

## Best Practices Summary

### ✅ DO:

1. **Store incomplete data** - Better to have partial data than none
2. **Log warnings** - Track what couldn't be resolved
3. **Use multiple strategies** - Try exact → normalized → fuzzy matching
4. **Batch resolve later** - Don't block scraping for resolution
5. **Track metrics** - Know your resolution rate
6. **Preserve source data** - Keep `player_name` and `raw_data` JSONB

### ❌ DON'T:

1. **Fail on null player_id** - Don't skip or error on missing IDs
2. **Over-match** - Last name only can match wrong players
3. **Lose source data** - Always keep `player_name` even with `player_id`
4. **Block scraping** - Don't wait for manual resolution during scrape
5. **Ignore unresolved** - Track and resolve regularly

## Example Workflow

```bash
# 1. Scrape box scores (some players may be unresolved)
tsx scripts/scrape-bbref-csv-boxscores.ts --game-id 1842025102199

# 2. Check unresolved players
psql $SUPABASE_DB_URL -c "SELECT * FROM unresolved_players LIMIT 10;"

# 3. Auto-resolve what we can
tsx scripts/resolve-missing-player-ids.ts --auto

# 4. Manually resolve remaining (if needed)
tsx scripts/resolve-missing-player-ids.ts
```

## Data Quality Metrics

Track resolution rate:

```sql
SELECT 
  COUNT(*) FILTER (WHERE player_id IS NOT NULL) as resolved,
  COUNT(*) FILTER (WHERE player_id IS NULL) as unresolved,
  ROUND(100.0 * COUNT(*) FILTER (WHERE player_id IS NOT NULL) / COUNT(*), 2) as resolution_pct
FROM scraped_boxscores;
```

**Target**: >95% resolution rate after auto-resolution

## Common Issues & Solutions

### Issue: "Jimmy Butler" not found
- **Cause**: Name variation or player not in `players` table
- **Solution**: 
  1. Check if player exists: `SELECT * FROM players WHERE full_name ILIKE '%butler%';`
  2. If missing, seed player first
  3. Re-run resolution script

### Issue: Multiple matches (last name only)
- **Cause**: Common last names (e.g., "Smith", "Johnson")
- **Solution**: Use interactive mode to manually select correct player

### Issue: Team mismatch
- **Cause**: Player traded mid-season or roster data outdated
- **Solution**: 
  1. Check `player_team_rosters` for correct team
  2. May need to resolve without team filter for traded players

## Future Improvements

- [ ] Levenshtein distance for fuzzy matching
- [ ] Nickname mapping table (e.g., "Jimmy" → "James")
- [ ] Cross-reference with Basketball Reference player IDs
- [ ] Automated resolution via API (BallDontLie, API-Basketball)
- [ ] Alert system for high-value unresolved players

