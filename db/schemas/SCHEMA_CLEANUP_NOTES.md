# Schema Cleanup Notes

## Removed Schema Files

The following schema files have been removed as they are deprecated:

1. ✅ `bbref_player_game_stats.sql` - Removed
   - Duplicate of `player_game_stats`
   - Data should use `player_game_stats` with `source='bbref'`

2. ✅ `bbref_team_game_stats.sql` - Removed
   - Duplicate of `team_game_stats`
   - Data should use `team_game_stats` with `source='bbref'`

3. ✅ `scraped_boxscores.sql` - Removed
   - Used by inconsistent CSV scraper
   - Main scraper uses `player_game_stats`

4. ✅ `bbref_boxscores_csv.sql` - Removed
   - Unused, created for CSV scraping approach

## Scripts That May Need Updates

The following scripts still reference the deprecated tables. They may need to be updated to use the main tables instead:

### Scripts using `bbref_player_game_stats`:
- `scripts/populate-bbref-stats.ts`
- `scripts/cleanup-non-bbref-entries.ts`
- `scripts/batch-scrape-missing-bbref-games.ts`

### Scripts using `bbref_team_game_stats`:
- `scripts/populate-bbref-stats.ts`
- `scripts/cleanup-non-bbref-entries.ts`

### Scripts using `scraped_boxscores`:
- `scripts/scrape-bbref-csv-boxscores.ts` (CSV scraper - inconsistent)
- `scripts/populate-bbref-stats.ts`
- `scripts/manual-resolve-players.ts`
- `scripts/resolve-missing-player-ids.ts`

## Tables Still in Use

### `bbref_games.sql` - ⚠️ Still Used
- Used by several scripts:
  - `scripts/update-bbref-game-scores.ts`
  - `scripts/scrape-bbref-csv-boxscores.ts`
  - `scripts/batch-scrape-missing-bbref-games.ts`
  - `scripts/populate-bbref-stats.ts`
- **Note:** This table may be redundant if `bbref_schedule` provides all needed data
- **Action:** Review if these scripts can be updated to use `bbref_schedule` instead

### `bbref_schedule.sql` - ✅ Active
- Source of truth for Basketball Reference schedule
- Used by main scrapers

### `bbref_team_season_stats.sql` - ⚠️ Review
- May still be needed for season-level stats
- Review if this is actively used

## Current Active Schema Files

### Box Scores (BBRef Only)
- ✅ `player_game_stats.sql` - Main table for player box scores
- ✅ `team_game_stats.sql` - Main table for team box scores

### Games
- ✅ `games.sql` - Main canonical games table
- ✅ `bbref_schedule.sql` - Basketball Reference schedule

### Other
- ✅ `players.sql`
- ✅ `teams.sql`
- ✅ `player_team_rosters.sql`
- ✅ `markets.sql`
- ✅ `provider_id_map.sql`
- ✅ `staging_events.sql`

## Next Steps

1. ✅ Schema files removed
2. ⚠️ Review and update scripts that reference deprecated tables
3. ⚠️ Consider migrating data from deprecated tables if needed
4. ⚠️ Drop deprecated tables from database after migration
5. ⚠️ Review `bbref_games` usage and consider consolidating to `bbref_schedule`

