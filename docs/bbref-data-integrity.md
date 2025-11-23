# BBRef Data Integrity

## Overview

The BBRef tables (`bbref_player_game_stats` and `bbref_team_game_stats`) are **strictly BBRef-only** to maintain data source integrity and prevent confusion.

## Enforcement Mechanisms

### 1. Database Constraints

Both tables have a CHECK constraint that enforces `source = 'bbref'`:

```sql
-- bbref_team_game_stats
constraint bbref_team_game_stats_source_check check (source = 'bbref')

-- bbref_player_game_stats  
constraint bbref_player_game_stats_source_check check (source = 'bbref')
```

This prevents any non-BBRef data from being inserted into these tables.

### 2. Query Filtering

All queries in `lib/teams/bbref-queries.ts` explicitly filter for:
- `source = 'bbref'`
- Games that exist in `bbref_schedule` (via `EXISTS` check)

Example:
```typescript
WHERE btgs.team_id = $1
  AND btgs.source = 'bbref'
  AND EXISTS (
    SELECT 1 FROM bbref_schedule bs 
    WHERE bs.canonical_game_id = btgs.game_id
  )
```

### 3. Population Scripts

The `populate-bbref-stats.ts` script:
- Only reads from `scraped_boxscores` (BBRef source)
- Always sets `source = 'bbref'` when inserting
- Only processes games that exist in `bbref_schedule`

## Data Flow

```
scraped_boxscores (BBRef scraped data)
    ↓
bbref_player_game_stats (normalized, source='bbref')
    ↓
bbref_team_game_stats (aggregated, source='bbref')
    ↓
UI Components (BBRefStats, BBRefSeasonStats)
```

## Verification

Run `scripts/cleanup-non-bbref-entries.ts` to verify all entries are BBRef-affiliated:

```bash
npx tsx scripts/cleanup-non-bbref-entries.ts
```

This script checks:
1. Source field is 'bbref'
2. Games exist in `bbref_schedule`
3. Games exist in `scraped_boxscores`

## Current Status

✅ All 170 games (Oct 21 - Nov 21, 2025) are BBRef-affiliated
✅ All entries have `source = 'bbref'`
✅ All games match `bbref_schedule` by `canonical_game_id`
✅ Database constraints enforce BBRef-only data
✅ Queries filter for BBRef-only data

## Maintenance

When adding new BBRef data:
1. Ensure `scraped_boxscores` contains BBRef data only
2. Run `populate-bbref-stats.ts` to populate tables
3. Verify with `cleanup-non-bbref-entries.ts`
4. The constraints will automatically prevent non-BBRef data

