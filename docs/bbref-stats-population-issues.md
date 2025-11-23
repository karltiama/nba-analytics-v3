# BBRef Stats Population Issues - Investigation Report

## Summary

Investigation into why BBRef Team Game Stats and schedules aren't populating correctly.

## Current State

### Schedule Status ✅
- **Total games in `bbref_schedule`**: 1,200
- **Games with `canonical_game_id`**: 1,200 (100%)
- **Games without `canonical_game_id`**: 0
- **Status**: ✅ Schedule is properly populated and matched to games table

### Team Stats Status ⚠️
- **Games with team stats**: 170
- **Games that match schedule (will show in UI)**: 170
- **Games missing team stats**: ~1,030 games

### Root Cause

The issue is **NOT** with schedule population. The schedule is working correctly. The problem is:

1. **Missing Player Stats**: Most games don't have player stats in `bbref_player_game_stats` yet
2. **Missing Team Stats Aggregation**: Team stats are aggregated from player stats, so if player stats don't exist, team stats can't be created
3. **UI Query Filter**: The BBRef Stats component filters by `canonical_game_id` match, which is correct but means games without stats won't show

## How BBRef Stats Work

### Data Flow
```
scraped_boxscores (source: 'bbref_csv')
    ↓
bbref_player_game_stats (populated by populate-bbref-stats.ts)
    ↓
bbref_team_game_stats (aggregated from player stats)
    ↓
UI Query (requires canonical_game_id match in bbref_schedule)
```

### UI Query Filter
The `getBBRefTeamGameStats` query requires:
```sql
WHERE btgs.team_id = $1
  AND btgs.source = 'bbref'
  AND EXISTS (
    SELECT 1 FROM bbref_schedule bs 
    WHERE bs.canonical_game_id = btgs.game_id
  )
```

This means:
- ✅ Games with team stats AND matching canonical_game_id → **SHOW**
- ❌ Games without team stats → **DON'T SHOW**
- ❌ Games with team stats but no canonical_game_id → **DON'T SHOW** (but this isn't happening)

## Issues Found

### Issue 1: Missing Player Stats
- **Problem**: Only 170 games have player stats, but 1,200 games exist in schedule
- **Impact**: Team stats can't be aggregated for games without player stats
- **Solution**: Need to scrape/populate player stats for more games

### Issue 2: Team Stats Not Aggregated
- **Problem**: Even if player stats exist, team stats might not be aggregated
- **Impact**: Games with player stats won't show in BBRef Stats component
- **Solution**: Run `populate-bbref-stats.ts --teams-only` to aggregate team stats

### Issue 3: Schedule Query (Separate Issue)
- **Status**: The `TeamSchedule` component queries `games` table directly, not `bbref_schedule`
- **Impact**: Schedule should work fine if games exist in `games` table
- **Note**: This is separate from BBRef stats issue

## Diagnostic Scripts

### Run Investigation
```bash
npx tsx scripts/investigate-bbref-stats-population.ts
```

This script checks:
- Schedule status
- Team stats status
- Games missing team stats
- Games with player stats but no team stats
- UI query test

## Fixes

### Fix 1: Populate Missing Team Stats
If games have player stats but no team stats:
```bash
npx tsx scripts/populate-bbref-stats.ts --teams-only
```

### Fix 2: Populate Missing Player Stats
If games don't have player stats:
1. Check `scraped_boxscores` table for games with `source = 'bbref_csv'`
2. Ensure player_ids are resolved
3. Run:
```bash
npx tsx scripts/populate-bbref-stats.ts --players-only
```

### Fix 3: Full Population
To populate both player and team stats:
```bash
npx tsx scripts/populate-bbref-stats.ts
```

## Verification

After running fixes, verify:
1. Check team stats count:
```sql
SELECT COUNT(DISTINCT game_id) FROM bbref_team_game_stats;
```

2. Check UI query returns data:
```sql
SELECT COUNT(*) 
FROM bbref_team_game_stats btgs
JOIN games g ON btgs.game_id = g.game_id
WHERE btgs.team_id = '2'  -- Example team
  AND btgs.source = 'bbref'
  AND EXISTS (
    SELECT 1 FROM bbref_schedule bs 
    WHERE bs.canonical_game_id = btgs.game_id
  );
```

## Next Steps

1. **Investigate why player stats aren't being scraped** for most games
   - Check if scraping scripts are running
   - Check if `scraped_boxscores` has data for games without player stats
   - Check if player_id resolution is failing

2. **Run team stats aggregation** for games that have player stats but no team stats
   ```bash
   npx tsx scripts/populate-bbref-stats.ts --teams-only
   ```

3. **Monitor data population** to ensure new games get stats populated

## Related Scripts

- `scripts/populate-bbref-stats.ts` - Populate player and team stats
- `scripts/investigate-bbref-stats-population.ts` - Diagnostic script
- `scripts/compare-bbref-schedule-games.ts` - Compare schedule vs stats
- `scripts/check-missing-games-from-schedule.ts` - Check missing games

