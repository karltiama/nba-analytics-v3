# Safe to Drop Tables Checklist

## ⚠️ Before Dropping Deprecated Tables

### Step 1: Check What Data Exists
Run `CHECK_DEPRECATED_TABLES.sql` in Supabase SQL Editor to see:
- How many rows are in each deprecated table
- What games/players are in them
- If there's data that doesn't exist in main tables

### Step 2: Decide on Migration
**If deprecated tables have data:**
- ✅ **Option A:** Migrate data to main tables first (see migration script below)
- ✅ **Option B:** If data is old/duplicate, you can drop directly

**If deprecated tables are empty or have duplicate data:**
- ✅ Safe to drop directly

### Step 3: Update Scripts (If Needed)
These scripts still reference deprecated tables:
- `scripts/populate-bbref-stats.ts` - Uses all deprecated tables
- `scripts/cleanup-non-bbref-entries.ts` - Uses bbref_player_game_stats, bbref_team_game_stats
- `scripts/scrape-bbref-csv-boxscores.ts` - Uses scraped_boxscores (CSV scraper - inconsistent)
- `scripts/manual-resolve-players.ts` - Uses scraped_boxscores
- `scripts/resolve-missing-player-ids.ts` - Uses scraped_boxscores

**Decision:**
- If you're not using these scripts → Safe to drop tables
- If you need these scripts → Update them first, then drop tables

### Step 4: Drop Tables
Once you've verified:
1. Run `CHECK_DEPRECATED_TABLES.sql` to see current state
2. Migrate data if needed (see migration script)
3. Update scripts if you're using them
4. Run `DROP_DEPRECATED_TABLES.sql` to drop tables

## Tables to Drop

1. ✅ `bbref_player_game_stats` - Duplicate of `player_game_stats`
2. ✅ `bbref_team_game_stats` - Duplicate of `team_game_stats`
3. ✅ `scraped_boxscores` - Used by inconsistent CSV scraper
4. ✅ `bbref_boxscores_csv` - Unused

## Migration Script (If Needed)

If you need to migrate data from deprecated tables to main tables, use this:

```sql
-- Migrate bbref_player_game_stats to player_game_stats
INSERT INTO player_game_stats (
  game_id, player_id, team_id, minutes, points, rebounds, 
  offensive_rebounds, defensive_rebounds, assists, steals, blocks, 
  turnovers, personal_fouls, field_goals_made, field_goals_attempted,
  three_pointers_made, three_pointers_attempted, free_throws_made,
  free_throws_attempted, plus_minus, started, source
)
SELECT 
  game_id, player_id, team_id, minutes, points, rebounds,
  offensive_rebounds, defensive_rebounds, assists, steals, blocks,
  turnovers, personal_fouls, field_goals_made, field_goals_attempted,
  three_pointers_made, three_pointers_attempted, free_throws_made,
  free_throws_attempted, plus_minus, started, 'bbref' as source
FROM bbref_player_game_stats
ON CONFLICT (game_id, player_id) DO NOTHING;  -- Skip duplicates

-- Similar for team_game_stats...
```

## Recommendation

**If your main tables (`player_game_stats`, `team_game_stats`) already have data:**
- ✅ Likely safe to drop deprecated tables
- The deprecated tables were experimental/legacy
- Your working scraper writes to main tables

**If you're unsure:**
1. Run the check script first
2. Review the data
3. Migrate if needed
4. Then drop

