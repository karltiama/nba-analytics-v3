# Scraper Update Summary - BBRef Tables as Primary Source

## ✅ Completed Updates

### 1. Updated `scripts/scrape-basketball-reference.ts`
- ✅ Added `generateBbrefGameId()` function
- ✅ Updated `getTeamAbbreviations()` to return `bbrefGameId` and team IDs
- ✅ Added `ensureBbrefGameExists()` function to create/update `bbref_games` entries
- ✅ Updated `processBBRefBoxScore()` to:
  - Use `bbrefGameId` instead of canonical `game_id`
  - Write to `bbref_player_game_stats` (PRIMARY source)
  - Ensure `bbref_games` entry exists before writing stats
  - Still updates canonical `games` table scores for compatibility

### 2. Updated `lambda/boxscore-scraper/index.ts`
- ✅ Added `generateBbrefGameId()` function
- ✅ Updated `getTeamAbbreviations()` to return `bbrefGameId` and team IDs
- ✅ Added `ensureBbrefGameExists()` function
- ✅ Updated `getGamesWithoutBoxScores()` to check `bbref_player_game_stats` via `bbref_schedule`
- ✅ Updated `processBBRefBoxScore()` to:
  - Use `bbrefGameId` instead of canonical `game_id`
  - Write to `bbref_player_game_stats` (PRIMARY source)
  - Ensure `bbref_games` entry exists before writing stats

## Architecture

### Data Flow
```
Basketball Reference Website
    ↓
Scrapers (scrape-basketball-reference.ts, Lambda)
    ↓
bbref_games (game metadata) ← Created/updated first
    ↓
bbref_player_game_stats (player box scores) ← PRIMARY source
    ↓
bbref_team_game_stats (team box scores - aggregated)
```

### Key Changes
1. **BBRef tables are PRIMARY** - All BBRef data goes to `bbref_player_game_stats`
2. **bbref_game_id format** - `bbref_YYYYMMDDHHMM_AWAY_HOME`
3. **Auto-create bbref_games** - Scrapers ensure `bbref_games` entry exists
4. **Canonical games still updated** - Scores still sync to `games` table for compatibility

## Testing

Before deploying:
1. Test with a single game: `npx tsx scripts/scrape-basketball-reference.ts --game-id <game_id>`
2. Verify data in `bbref_games` and `bbref_player_game_stats`
3. Test Lambda function locally

## Next Steps

1. ✅ Scrapers updated
2. ⚠️ Test locally
3. ⚠️ Deploy Lambda function
4. ⚠️ Monitor first few runs








