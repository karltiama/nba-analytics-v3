# Batch Scraping Missing BBRef Games - Quick Guide

## Overview

The `batch-scrape-missing-bbref-games.ts` script systematically scrapes missing games from Basketball Reference and stores them in `scraped_boxscores` for later population.

## Usage

### Basic Commands

**Dry run (preview what would be scraped):**
```bash
npx tsx scripts/batch-scrape-missing-bbref-games.ts --limit 10 --dry-run
```

**Scrape Final games only (recommended first step):**
```bash
npx tsx scripts/batch-scrape-missing-bbref-games.ts --limit 50 --status Final
```

**Scrape specific date range:**
```bash
npx tsx scripts/batch-scrape-missing-bbref-games.ts --start-date 2025-10-22 --end-date 2025-11-01
```

**Scrape all missing Final games:**
```bash
npx tsx scripts/batch-scrape-missing-bbref-games.ts --status Final
```

### Options

- `--limit N` - Limit to N games (useful for testing)
- `--status STATUS` - Filter by status (e.g., `Final`, `Scheduled`)
- `--start-date YYYY-MM-DD` - Start date filter
- `--end-date YYYY-MM-DD` - End date filter
- `--dry-run` - Preview without scraping

## Workflow

### Step 1: Identify Missing Games
```bash
npx tsx scripts/diagnose-missing-bbref-data.ts
```

### Step 2: Scrape Missing Games
```bash
# Start with Final games (they have complete data)
npx tsx scripts/batch-scrape-missing-bbref-games.ts --status Final --limit 50
```

### Step 3: Populate Player Stats
```bash
# After scraping, populate player stats
npx tsx scripts/populate-bbref-stats.ts --players-only
```

### Step 4: Aggregate Team Stats
```bash
# Then aggregate team stats
npx tsx scripts/populate-bbref-stats.ts --teams-only
```

### Step 5: Verify Progress
```bash
# Check coverage
npx tsx scripts/check-bbref-team-data.ts

# Or use web dashboard
# Visit: http://localhost:3000/admin/bbref-data-check
```

## Rate Limiting

The script includes built-in rate limiting:
- 4 seconds between requests (15 requests/minute)
- Automatic retries on failures
- Exponential backoff on rate limit errors

## Priority Order

1. **Final games** - Complete boxscores, ready to use
2. **Recent Final games** - Last 30 days for current analysis
3. **Historical Final games** - Fill in gaps for season stats
4. **Scheduled games** - Will populate as they finish

## Example Session

```bash
# 1. Check what's missing
npx tsx scripts/diagnose-missing-bbref-data.ts

# 2. Scrape 20 Final games
npx tsx scripts/batch-scrape-missing-bbref-games.ts --status Final --limit 20

# 3. Populate stats
npx tsx scripts/populate-bbref-stats.ts

# 4. Check progress
npx tsx scripts/check-bbref-team-data.ts
```

## Troubleshooting

**If scraping fails:**
- Check internet connection
- Verify Basketball Reference URLs are accessible
- Check rate limiting (may need to slow down)
- Review error messages for specific game issues

**If player stats don't populate:**
- Check `scraped_boxscores` table has data
- Verify `player_id` resolution (may need to run `resolve-missing-player-ids.ts`)
- Check `bbref_games` table has matching `bbref_game_id`

## Notes

- Scraping can take time (4 seconds per game minimum)
- Start with small batches (--limit 10-20) to test
- Focus on Final games first for best results
- Use web dashboard to track progress visually




















