# Fixing Roster Issues Guide

## Overview

Roster issues occur when players appear in box scores (`bbref_player_game_stats`) but aren't on the team's active roster in the `player_team_rosters` table. This can happen when:

- Players are added to box scores but not to rosters
- Players are traded but rosters aren't updated
- Roster data is incomplete or outdated

## Identifying Roster Issues

### 1. View in Admin Dashboard

The `admin/bbref-data-check` page now shows roster issues:
- **Roster column**: Shows number of issues and active roster count
- **Issues alert**: Lists teams with roster issues

### 2. List All Roster Issues

```bash
# List all roster issues across all teams
tsx scripts/list-roster-issues.ts

# List issues for a specific team
tsx scripts/list-roster-issues.ts --team CLE
```

This will show:
- Which players are missing from rosters
- How many games each player has played
- Which season the roster should be for

## Fixing Roster Issues

### Option 1: Auto-Fix All Issues (Recommended)

Automatically adds all players in box scores to their team's active roster:

```bash
# Fix all teams
tsx scripts/fix-roster-issues.ts --auto

# Fix specific team
tsx scripts/fix-roster-issues.ts --team CLE --auto
```

**When to use:**
- You trust that all players in box scores should be on rosters
- You want to quickly fix all issues at once
- Most common use case

### Option 2: Interactive Mode

Review each player before adding to roster:

```bash
# Interactive mode for all teams
tsx scripts/fix-roster-issues.ts

# Interactive mode for specific team
tsx scripts/fix-roster-issues.ts --team CLE
```

**When to use:**
- You want to review each player before adding
- Some players might be on wrong teams (trades, etc.)
- You want more control over the process

### Option 3: Manual Fix

For specific players or teams, you can manually add players:

```bash
# Use the add-unresolved-players script
tsx scripts/add-unresolved-players.ts
```

## How It Works

1. **Identifies Issues**: Finds players in `bbref_player_game_stats` who aren't on active rosters
2. **Determines Season**: Uses the most common season from each team's games (defaults to '2025-26')
3. **Adds to Roster**: Inserts/updates `player_team_rosters` with `active=true`

## Example Workflow

```bash
# 1. Check current roster issues
tsx scripts/list-roster-issues.ts

# 2. Fix all issues automatically
tsx scripts/fix-roster-issues.ts --auto

# 3. Verify fixes (should show 0 issues)
tsx scripts/list-roster-issues.ts

# 4. Check admin dashboard
# Visit: /admin/bbref-data-check
# Roster column should show ✓ for all teams
```

## Important Notes

- **Season Detection**: The script automatically detects the season from each team's games. If no games exist, it defaults to '2025-26'
- **Active Status**: All added players are marked as `active=true`
- **No Duplicates**: Uses `ON CONFLICT` to prevent duplicate roster entries
- **Team Matching**: Players are added to the team they appear with in box scores

## Troubleshooting

### Players Still Showing as Issues After Fix

1. Check if the season matches:
   ```sql
   SELECT season, COUNT(*) 
   FROM bbref_games bg
   JOIN bbref_player_game_stats bpgs ON bg.bbref_game_id = bpgs.game_id
   WHERE bpgs.team_id = 'TEAM_ID'
   GROUP BY season;
   ```

2. Verify roster entry exists:
   ```sql
   SELECT * FROM player_team_rosters 
   WHERE player_id = 'PLAYER_ID' 
     AND team_id = 'TEAM_ID' 
     AND active = true;
   ```

### Players on Wrong Team

If a player appears in box scores for the wrong team (e.g., after a trade):
1. Don't auto-fix - use interactive mode
2. Manually update the roster entry
3. Or wait for the roster sync script to update it

## Related Scripts

- `list-roster-issues.ts` - List all roster issues
- `fix-roster-issues.ts` - Fix roster issues (auto or interactive)
- `add-unresolved-players.ts` - Manually add players to database and rosters
- `seed_players_nba.py` - Sync rosters from NBA API


