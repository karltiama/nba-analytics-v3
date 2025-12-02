# BBRef Data Population Plan

## Current State

- **Total games in bbref_games**: 1,200
- **Games with player stats**: 170 (14% coverage)
- **Games with scraped data**: 170 (all already populated)
- **Games missing stats**: 1,030 (86% need work)

## The Problem

Most games in `bbref_games` don't have player stats yet because:
1. They haven't been scraped from Basketball Reference
2. The scraped data hasn't been populated into `bbref_player_game_stats`

## Data Flow

```
bbref_games (schedule)
    ↓
scraped_boxscores (scrape from BBRef)
    ↓
bbref_player_game_stats (populate from scraped)
    ↓
bbref_team_game_stats (aggregate from player stats)
```

## Step-by-Step Fix Plan

### Step 1: Populate Existing Scraped Data ✅

**Status**: Already done! All 170 games with scraped data have been populated.

**Command** (if needed):
```bash
npx tsx scripts/populate-bbref-stats.ts
```

This populates `bbref_player_game_stats` from `scraped_boxscores`.

### Step 2: Scrape Missing Games 📥

**Priority**: HIGH - This is the main bottleneck

**What to do**:
1. Identify games that need scraping (Final games first)
2. Run scraping scripts to get boxscore data
3. Store in `scraped_boxscores` table

**Scripts to check**:
- `scripts/scrape-bbref-csv-boxscores.ts` - CSV boxscore scraping
- `scripts/scrape-basketball-reference.ts` - HTML boxscore scraping
- `scripts/batch-scrape-october.ts` - Batch scraping example

**Focus on**:
- Final games first (they have complete data)
- Games from recent dates (easier to verify)
- One team/date range at a time

**Example**:
```bash
# Scrape specific date range
npx tsx scripts/scrape-bbref-csv-boxscores.ts --start-date 2025-10-22 --end-date 2025-11-01
```

### Step 3: Populate Player Stats 📊

**After scraping**, populate the new data:

```bash
# Populate player stats from scraped_boxscores
npx tsx scripts/populate-bbref-stats.ts --players-only

# Then aggregate team stats
npx tsx scripts/populate-bbref-stats.ts --teams-only
```

Or do both at once:
```bash
npx tsx scripts/populate-bbref-stats.ts
```

### Step 4: Verify & Monitor 🔍

**Check progress**:
```bash
# Command line
npx tsx scripts/check-bbref-team-data.ts

# Or web dashboard
# Visit: http://localhost:3000/admin/bbref-data-check
```

**Target metrics**:
- ✅ 80%+ coverage for reliable analysis
- ✅ All Final games have stats
- ✅ Recent games (last 30 days) have stats

## Quick Start Commands

### Check what needs work:
```bash
npx tsx scripts/diagnose-missing-bbref-data.ts
```

### Populate existing scraped data:
```bash
npx tsx scripts/populate-bbref-stats.ts
```

### Check team coverage:
```bash
npx tsx scripts/check-bbref-team-data.ts
```

### View web dashboard:
```
http://localhost:3000/admin/bbref-data-check
```

## Priority Order

1. **Final games** - Complete data, ready to use
2. **Recent games** - Last 30 days for current analysis
3. **Historical games** - Fill in gaps for season-long stats
4. **Future games** - Will populate as they finish

## Notes

- All 170 games with scraped data are already populated ✅
- Need to scrape 1,030 more games
- Focus on Final games first (they have complete boxscores)
- Use the web dashboard to track progress visually
- Run population scripts after each batch of scraping

## Expected Timeline

- **Quick wins**: Scrape Final games from last 30 days (~100-200 games)
- **Medium term**: Complete current season (~500-800 games)
- **Long term**: Historical data as needed

## Success Criteria

✅ 80%+ coverage across all teams
✅ All Final games have stats
✅ Recent games (last 30 days) are complete
✅ Team stats aggregated for all games with player stats

















