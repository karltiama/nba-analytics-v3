# BBRef Standalone Architecture

## Overview

BBRef data is now completely independent from the canonical `games` table. BBRef has its own games table (`bbref_games`) and all BBRef stats reference this standalone table.

## Architecture

### Tables

```
bbref_games (standalone games table)
    ↓
bbref_player_game_stats (references bbref_games)
    ↓
bbref_team_game_stats (aggregated from player stats, references bbref_games)
```

### Key Points

1. **Complete Independence**: BBRef data does NOT depend on the canonical `games` table
2. **Own Game IDs**: BBRef uses its own game ID format (`bbref_YYYYMMDDHHMM_AWAY_HOME`)
3. **Self-Contained**: All BBRef stats, schedules, and game data are in BBRef-specific tables

## Schema

### bbref_games

```sql
CREATE TABLE bbref_games (
  bbref_game_id     text primary key,        -- Format: bbref_YYYYMMDDHHMM_AWAY_HOME
  game_date         date not null,
  season            text,
  start_time        timestamptz,
  status            text,
  home_team_id      text references teams(team_id),
  away_team_id      text references teams(team_id),
  home_team_abbr    text not null,
  away_team_abbr    text not null,
  home_score        int,
  away_score        int,
  venue             text,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);
```

### Foreign Key References

- `bbref_player_game_stats.game_id` → `bbref_games.bbref_game_id`
- `bbref_team_game_stats.game_id` → `bbref_games.bbref_game_id`

## Migration

To migrate from the old architecture (using `bbref_schedule` + `canonical_game_id`):

```bash
# Preview changes
npx tsx scripts/migrate-to-bbref-games-table.ts --dry-run

# Actually migrate
npx tsx scripts/migrate-to-bbref-games-table.ts
```

The migration script:
1. Creates `bbref_games` table
2. Migrates data from `bbref_schedule` to `bbref_games`
3. Updates `game_id` references in `bbref_player_game_stats` and `bbref_team_game_stats`
4. Updates foreign key constraints to reference `bbref_games`

## Population

### Populate Games from Schedule

When scraping BBRef schedule, populate `bbref_games` directly:

```typescript
await pool.query(`
  INSERT INTO bbref_games (
    bbref_game_id, game_date, season, start_time, status,
    home_team_id, away_team_id, home_team_abbr, away_team_abbr
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  ON CONFLICT (bbref_game_id) DO UPDATE SET ...
`, [bbrefGameId, gameDate, season, startTime, status, homeTeamId, awayTeamId, homeAbbr, awayAbbr]);
```

### Populate Stats

Stats reference `bbref_games` directly:

```typescript
// Player stats
INSERT INTO bbref_player_game_stats (game_id, player_id, team_id, ...)
VALUES ($1, $2, $3, ...)
-- game_id must exist in bbref_games

// Team stats (aggregated from player stats)
INSERT INTO bbref_team_game_stats (game_id, team_id, ...)
VALUES ($1, $2, ...)
-- game_id must exist in bbref_games
```

## Queries

### Get Team Game Stats

```typescript
SELECT 
  btgs.*,
  bg.game_date,
  bg.home_team_abbr,
  bg.away_team_abbr,
  bg.home_score,
  bg.away_score
FROM bbref_team_game_stats btgs
JOIN bbref_games bg ON btgs.game_id = bg.bbref_game_id
WHERE btgs.team_id = $1
```

### Get Player Game Stats

```typescript
SELECT 
  bpgs.*,
  bg.game_date,
  bg.home_team_abbr,
  bg.away_team_abbr
FROM bbref_player_game_stats bpgs
JOIN bbref_games bg ON bpgs.game_id = bg.bbref_game_id
WHERE bpgs.player_id = $1
```

## Benefits

1. **Independence**: BBRef data doesn't depend on canonical games table
2. **Clarity**: Clear separation between BBRef data and other sources
3. **Simplicity**: No need to match BBRef games to canonical games
4. **Flexibility**: BBRef can have its own game IDs, dates, and metadata

## Comparison: Old vs New

### Old Architecture
```
bbref_schedule (with canonical_game_id → games table)
    ↓
bbref_player_game_stats (references games table)
    ↓
bbref_team_game_stats (references games table)
```

**Issues:**
- Required matching BBRef games to canonical games
- Dependency on `games` table
- Complex queries with `EXISTS` checks on `bbref_schedule`

### New Architecture
```
bbref_games (standalone)
    ↓
bbref_player_game_stats (references bbref_games)
    ↓
bbref_team_game_stats (references bbref_games)
```

**Benefits:**
- No dependency on canonical games table
- Simpler queries (direct joins)
- BBRef is self-contained

## Next Steps

1. Run migration script to create `bbref_games` and update references
2. Update scraping scripts to populate `bbref_games` directly
3. Update population scripts to use `bbref_games` game IDs
4. (Optional) Drop `bbref_schedule` table if no longer needed





















