# Basketball Reference Architecture

## Overview

**Basketball Reference tables are the PRIMARY and AUTHORITATIVE source of truth** for all box score data. All BBRef scrapers write directly to these tables.

## BBRef Table Structure

### Core Tables

1. **`bbref_games`** - BBRef game records
   - Primary key: `bbref_game_id` (format: `bbref_YYYYMMDDHHMM_AWAY_HOME`)
   - Contains game metadata, scores, teams
   - **Source of truth for BBRef games**

2. **`bbref_schedule`** - BBRef schedule
   - Primary key: `bbref_game_id`
   - Links to canonical `games` table via `canonical_game_id`
   - **Source of truth for BBRef schedule**

3. **`bbref_player_game_stats`** - Player box scores
   - Primary key: `(game_id, player_id)`
   - References: `bbref_games(bbref_game_id)`
   - **PRIMARY source for all player box score data**
   - Contains: offensive_rebounds, defensive_rebounds, personal_fouls

4. **`bbref_team_game_stats`** - Team box scores (aggregated)
   - Primary key: `(game_id, team_id)`
   - References: `bbref_games(bbref_game_id)`
   - **PRIMARY source for all team box score data**
   - Populated by aggregating `bbref_player_game_stats`

5. **`bbref_team_season_stats`** - Season-level team statistics
   - Aggregated from `bbref_team_game_stats`

## Data Flow

```
Basketball Reference Website
    ↓
Scrapers (scrape-basketball-reference.ts, Lambda)
    ↓
bbref_games (game metadata)
    ↓
bbref_player_game_stats (player box scores)
    ↓
bbref_team_game_stats (team box scores - aggregated)
    ↓
bbref_team_season_stats (season stats - aggregated)
```

## Key Principles

1. **BBRef tables are authoritative** - All BBRef data goes here first
2. **No mixing sources** - BBRef tables only contain BBRef data (enforced by constraints)
3. **Referential integrity** - All BBRef stats reference `bbref_games`, not `games`
4. **Source tracking** - All rows have `source='bbref'` (enforced by constraint)

## Relationship to Canonical Tables

- `bbref_schedule` links to `games` via `canonical_game_id` (optional)
- `bbref_games` is independent from `games` table
- BBRef tables can exist independently
- Canonical `games` table may reference BBRef data via `bbref_schedule.canonical_game_id`

## Scraper Requirements

All BBRef scrapers must:
1. Write to `bbref_games` first (or ensure game exists)
2. Write player stats to `bbref_player_game_stats`
3. Use `bbref_game_id` (not canonical `game_id`)
4. Set `source='bbref'` (enforced by constraint)
5. Include all available fields (ORB, DRB, PF)

## Migration Notes

If you need to sync BBRef data to canonical tables:
- Use `bbref_schedule.canonical_game_id` to map BBRef games to canonical games
- Copy data from `bbref_player_game_stats` to `player_game_stats` if needed
- But BBRef tables remain the source of truth



















