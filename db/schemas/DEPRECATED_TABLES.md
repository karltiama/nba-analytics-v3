# Deprecated Tables

The following tables are deprecated and should not be used for new data. They were created during experimentation with different data sources, but we've now consolidated to Basketball Reference only.

## Deprecated Box Score Tables

### `bbref_player_game_stats`
- **Status:** Deprecated
- **Reason:** Duplicate of `player_game_stats` with BBRef-specific structure
- **Action:** Data should be migrated to `player_game_stats` if needed, then table can be dropped

### `bbref_team_game_stats`
- **Status:** Deprecated
- **Reason:** Duplicate of `team_game_stats` with BBRef-specific structure
- **Action:** Data should be migrated to `team_game_stats` if needed, then table can be dropped

### `scraped_boxscores`
- **Status:** Deprecated
- **Reason:** Used by CSV scraper which is inconsistent. Main scraper uses `player_game_stats`
- **Action:** Can be dropped after confirming no important data

### `bbref_boxscores_csv`
- **Status:** Deprecated
- **Reason:** Unused, created for CSV scraping approach
- **Action:** Can be dropped

## Deprecated Game Tables

### `bbref_games`
- **Status:** Deprecated (if not needed for schedule)
- **Reason:** May be redundant if `bbref_schedule` is sufficient
- **Action:** Review if `bbref_schedule` provides all needed data, then consider dropping

## Current Active Tables

### Box Scores
- ✅ `player_game_stats` - Main table for player box scores (BBRef only)
- ✅ `team_game_stats` - Main table for team box scores (BBRef only)

### Games
- ✅ `games` - Main canonical games table
- ✅ `bbref_schedule` - Basketball Reference schedule (source of truth for dates/teams)

## Migration Notes

If you need to migrate data from deprecated tables:
1. Check data quality in deprecated tables
2. Map fields to new schema
3. Use `source='bbref'` when inserting into main tables
4. Verify data integrity after migration
5. Drop deprecated tables once migration is complete

