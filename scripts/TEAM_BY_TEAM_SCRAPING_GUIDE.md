# Team-by-Team Box Score Scraping Guide

Both batch scraping scripts now support filtering by team abbreviation, allowing you to scrape box scores for specific teams.

## Available Scripts

### 1. `batch-scrape-missing-bbref-games.ts` ✅ **RECOMMENDED**

Scrapes games from the `bbref_games` table that are missing player stats.

**Usage with team filter:**
```bash
# Scrape all missing Cleveland games
tsx scripts/batch-scrape-missing-bbref-games.ts --team CLE

# Scrape Cleveland games with date range
tsx scripts/batch-scrape-missing-bbref-games.ts --team CLE --start-date 2025-10-21 --end-date 2025-11-17

# Scrape Cleveland games, limit to 20 games
tsx scripts/batch-scrape-missing-bbref-games.ts --team CLE --limit 20

# Scrape only Final Cleveland games
tsx scripts/batch-scrape-missing-bbref-games.ts --team CLE --status Final

# Dry run to preview
tsx scripts/batch-scrape-missing-bbref-games.ts --team CLE --dry-run
```

### 2. `backfill-boxscores-bbref.ts` ✅ **NOW SUPPORTS TEAM FILTERING**

Finds games from the `games` table that are missing box scores.

**Usage with team filter:**
```bash
# Backfill all missing Cleveland games up to yesterday
tsx scripts/backfill-boxscores-bbref.ts --team CLE

# Backfill Cleveland games with date range
tsx scripts/backfill-boxscores-bbref.ts --team CLE --start-date 2025-10-21 --end-date 2025-11-17

# Backfill Cleveland games, limit to 50 games
tsx scripts/backfill-boxscores-bbref.ts --team CLE --max-games 50

# Dry run to preview
tsx scripts/backfill-boxscores-bbref.ts --team CLE --dry-run
```

## Team Abbreviations

Use **NBA team abbreviations** (3-letter codes):

| Team | Abbreviation | Team | Abbreviation |
|------|-------------|------|-------------|
| Atlanta Hawks | `ATL` | Milwaukee Bucks | `MIL` |
| Boston Celtics | `BOS` | Minnesota Timberwolves | `MIN` |
| Brooklyn Nets | `BKN` | New Orleans Pelicans | `NOP` |
| Charlotte Hornets | `CHA` | New York Knicks | `NYK` |
| Chicago Bulls | `CHI` | Oklahoma City Thunder | `OKC` |
| Cleveland Cavaliers | `CLE` | Orlando Magic | `ORL` |
| Dallas Mavericks | `DAL` | Philadelphia 76ers | `PHI` |
| Denver Nuggets | `DEN` | Phoenix Suns | `PHX` |
| Detroit Pistons | `DET` | Portland Trail Blazers | `POR` |
| Golden State Warriors | `GSW` | Sacramento Kings | `SAC` |
| Houston Rockets | `HOU` | San Antonio Spurs | `SAS` |
| Indiana Pacers | `IND` | Toronto Raptors | `TOR` |
| LA Clippers | `LAC` | Utah Jazz | `UTA` |
| LA Lakers | `LAL` | Washington Wizards | `WAS` |
| Memphis Grizzlies | `MEM` | | |
| Miami Heat | `MIA` | | |

**Note:** The scripts will find games where the team is either home OR away.

## Examples

### Example 1: Scrape all missing Cleveland games
```bash
tsx scripts/batch-scrape-missing-bbref-games.ts --team CLE
```

### Example 2: Scrape Cleveland games from a specific date range
```bash
tsx scripts/batch-scrape-missing-bbref-games.ts --team CLE --start-date 2025-10-21 --end-date 2025-11-17
```

### Example 3: Preview what would be scraped (dry run)
```bash
tsx scripts/batch-scrape-missing-bbref-games.ts --team CLE --dry-run
```

### Example 4: Scrape multiple teams (run separately)
```bash
# Scrape Cleveland
tsx scripts/batch-scrape-missing-bbref-games.ts --team CLE

# Scrape Lakers
tsx scripts/batch-scrape-missing-bbref-games.ts --team LAL

# Scrape Warriors
tsx scripts/batch-scrape-missing-bbref-games.ts --team GSW
```

## Performance

- **Speed:** ~5-10 seconds per game (HTML scraper)
- **Rate Limit:** 15 requests/minute (4 second delay between games)
- **Team Filter:** Finds games where team is home OR away

## Which Script to Use?

### Use `batch-scrape-missing-bbref-games.ts` if:
- ✅ You want to scrape games from `bbref_games` table
- ✅ Games are already in `bbref_games` but missing player stats
- ✅ You want more filtering options (status, date range, limit)

### Use `backfill-boxscores-bbref.ts` if:
- ✅ You want to scrape games from `games` table
- ✅ Games exist in `games` but don't have box scores yet
- ✅ You want to backfill historical games

## Tips

1. **Always use `--dry-run` first** to preview what will be scraped
2. **Use date ranges** to limit scope when testing
3. **Check rate limits** - Basketball Reference allows 15 requests/minute
4. **Monitor progress** - Scripts show progress every 10 games

## Troubleshooting

### No games found?
- Check that the team abbreviation is correct (use uppercase, e.g., `CLE` not `cle`)
- Verify games exist in the database for that team
- Try without `--team` filter to see all missing games

### Rate limit errors?
- Scripts automatically handle rate limiting
- If you see rate limit errors, wait a few minutes and try again
- Basketball Reference allows 20 requests/minute, scripts use 15 to be safe

### Games not scraping?
- Check that games are marked as "Final" or have scores
- Verify the game exists on Basketball Reference
- Some games may not be available immediately after completion








