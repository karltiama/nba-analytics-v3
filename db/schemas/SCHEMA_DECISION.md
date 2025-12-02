# Schema Architecture Decision

## Decision: BBRef Tables as Primary Source

**BBRef tables are the PRIMARY and AUTHORITATIVE source** for all Basketball Reference data.

## Table Structure

### BBRef Tables (Primary Source)
- ✅ `bbref_games` - BBRef game records
- ✅ `bbref_schedule` - BBRef schedule (links to canonical games)
- ✅ `bbref_player_game_stats` - Player box scores (PRIMARY)
- ✅ `bbref_team_game_stats` - Team box scores (PRIMARY)
- ✅ `bbref_team_season_stats` - Season stats

### Canonical Tables (May Reference BBRef)
- `games` - Canonical games (may link to BBRef via bbref_schedule)
- `player_game_stats` - May contain BBRef data (if synced)
- `team_game_stats` - May contain BBRef data (if synced)

## Scraper Updates Needed

Current scrapers write to:
- ❌ `player_game_stats` (references `games` table)

Should write to:
- ✅ `bbref_player_game_stats` (references `bbref_games` table)

## Next Steps

1. ✅ Restore BBRef schema files
2. ⚠️ Update scrapers to write to BBRef tables
3. ⚠️ Update Lambda function to write to BBRef tables
4. ⚠️ Ensure `bbref_games` entries exist before writing stats





