# Missing team_game_stats Root Cause Analysis

## Problem
20 Final games are missing `team_game_stats` records, even though they have `player_game_stats`.

## Root Cause

**Multiple box score processing scripts only insert `player_game_stats` but do NOT create `team_game_stats`:**

### Scripts that DON'T create team_game_stats:
1. `scripts/fetch-missing-boxscores.ts` - Only inserts `player_game_stats`
2. `scripts/scrape-basketball-reference.ts` - Only inserts `player_game_stats`
3. `scripts/retry-missing-boxscores.ts` - Only inserts `player_game_stats`

### Scripts that DO create team_game_stats:
1. `scripts/seed_boxscores_nba.py` - Properly creates both `player_game_stats` AND `team_game_stats`

## Evidence

All 20 affected games:
- ✅ Have `player_game_stats` records
- ✅ Have correct team IDs matching the games table
- ❌ Missing `team_game_stats` records

Some games are missing stats for one team entirely (e.g., only away team has stats, home team missing), but even games with both teams having stats are missing `team_game_stats`.

## Affected Games

All games from November 16-18, 2025:
- `0022500234` through `0022500254`

These games were likely processed by one of the TypeScript scripts during backfill/retry operations, which explains why they have player stats but no team stats.

## Solution Options

### Option 1: Backfill team_game_stats from existing player_game_stats
Create a script that aggregates `player_game_stats` to create `team_game_stats` for these games.

### Option 2: Fix the scripts to create team_game_stats
Update `fetch-missing-boxscores.ts`, `scrape-basketball-reference.ts`, and `retry-missing-boxscores.ts` to also create `team_game_stats` after inserting `player_game_stats`.

**Recommendation:** Do both - backfill the missing data AND fix the scripts to prevent future issues.

