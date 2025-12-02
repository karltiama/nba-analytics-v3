# Box Score and Roster Scraping Summary

This document provides an overview of how box scores and team rosters are scraped from Basketball Reference and NBA.com.

## Table of Contents

1. [Box Score Scraping](#box-score-scraping)
2. [Team Roster Scraping](#team-roster-scraping)
3. [Data Flow](#data-flow)
4. [Rate Limiting](#rate-limiting)

---

## Box Score Scraping

### Overview

Box scores are scraped from **Basketball Reference** (basketball-reference.com) using HTML parsing. The system supports two methods:

1. **HTML Table Parsing** (Primary method) - `scripts/scrape-basketball-reference.ts`
2. **CSV Export Parsing** (Alternative method) - `scripts/scrape-bbref-csv-boxscores.ts`

### HTML Table Parsing Method

**Script:** `scripts/scrape-basketball-reference.ts`

#### URL Format

Basketball Reference uses the following URL format for box scores:
```
https://www.basketball-reference.com/boxscores/YYYYMMDD0TEAM.html
```

**Example:**
- Date: November 18, 2025
- Home Team: Atlanta Hawks (ATL)
- URL: `https://www.basketball-reference.com/boxscores/202511180ATL.html`

**Important:** Dates must be in **Eastern Time (ET)** as Basketball Reference uses ET for game dates.

#### Process Flow

1. **Game Identification**
   - Input can be:
     - `--game-id`: Internal game ID (searches `bbref_schedule`, `bbref_games`, or `games` table)
     - `--game-date` + `--home-team`: Direct date and team specification
   - System resolves team abbreviations and game date from database

2. **Team Code Mapping**
   - NBA abbreviations (e.g., `BKN`) are mapped to Basketball Reference codes (e.g., `BRK`)
   - Mapping defined in `TEAM_CODE_MAP` constant

3. **URL Construction**
   - Constructs Basketball Reference URL using date and home team code
   - Date format: `YYYYMMDD` (e.g., `20251118`)

4. **HTML Fetching**
   - Uses `fetchWithRetry()` with rate limiting (4 second delay between requests)
   - Handles HTML comments (Basketball Reference sometimes wraps tables in comments)
   - Removes comment tags: `<!--` and `-->`

5. **Table Parsing**
   - Finds tables with IDs ending in `-game-basic` (e.g., `box-ATL-game-basic`)
   - Extracts team code from table ID using regex: `/box-([A-Z]{3})-game-basic/`
   - Parses table headers from `<thead>`
   - Extracts player rows from `<tbody>`

6. **Player Data Extraction**
   - For each player row:
     - Extracts player name from first `<th>` cell
     - Extracts stats from `<td>` cells (MP, FG, FGA, 3P, 3PA, FT, FTA, ORB, DRB, AST, STL, BLK, TOV, PF, PTS, +/-)
     - Determines if player started (first 5 players in "Starters" section)
     - Handles "Did Not Play" (DNP) cases
   - Skips "Team Totals" rows

7. **Player ID Resolution**
   - Attempts to match scraped player name to existing `player_id` in database
   - Matching strategies (in order):
     1. **Exact match**: `LOWER(full_name) = LOWER(scraped_name)`
     2. **Normalized match**: Removes accents and special characters
     3. **Fuzzy match**: Matches on last name only
     4. **Suffix handling**: Strips suffixes (Jr., Sr., III, etc.) and matches
     5. **Reverse suffix match**: Matches when DB has suffix but scraped name doesn't
   - If no match found, player is marked as "skipped" and stored with `player_id = NULL`

8. **Data Storage**
   - Raw scraped data stored in `scraped_boxscores` table
   - Includes:
     - `game_id` (bbref_game_id)
     - `player_id` (resolved or NULL)
     - `player_name` (as scraped)
     - All stat fields
     - `team_code` (Basketball Reference code)
     - `source` = `'basketball_reference'`
     - `started` (boolean)
     - `dnp_reason` (if player didn't play)

9. **Population to Final Tables**
   - `scripts/populate-bbref-stats.ts` processes `scraped_boxscores`:
     - Populates `bbref_player_game_stats` (individual player stats per game)
     - Aggregates to `bbref_team_game_stats` (team totals per game)
   - Only processes rows where `player_id IS NOT NULL` and `dnp_reason IS NULL`

### CSV Export Method

**Script:** `scripts/scrape-bbref-csv-boxscores.ts`

This method uses Basketball Reference's CSV export functionality as an alternative to HTML parsing.

#### Process

1. Constructs same URL format as HTML method
2. Fetches HTML page
3. Finds CSV data embedded in `<pre>` elements (Basketball Reference embeds CSV in page)
4. Parses CSV format (comma-separated values)
5. Processes and stores data similar to HTML method

#### Advantages

- Cleaner data structure (CSV vs HTML)
- Less prone to HTML parsing issues
- Easier to debug

---

## Team Roster Scraping

### Overview

Team rosters are scraped from **NBA.com** using the official NBA Stats API via the `nba_api` Python package.

**Script:** `scripts/seed_players_nba.py`

### Process Flow

1. **API Endpoint**
   - Uses `nba_api.stats.endpoints.commonteamroster.CommonTeamRoster`
   - Requires:
     - `team_id`: NBA Stats team ID (numeric)
     - `season`: Season string (e.g., `"2025-26"`)

2. **Team ID Resolution**
   - Resolves canonical team IDs via `provider_id_map` table
   - Maps NBA Stats team IDs to internal `team_id`
   - Uses `provider='nba'` filter

3. **Roster Fetching**
   - Calls NBA Stats API for each team/season combination
   - Rate limiting: 0.7 second delay between requests (configurable via `NBA_STATS_REQUEST_DELAY_SECONDS`)

4. **Data Validation**
   - Uses Pydantic models for validation:
     - `RosterPlayer`: Raw API payload model
     - `NormalizedPlayer`: Canonical database representation
   - Validates:
     - Player names (first/last)
     - Birth dates (handles multiple formats)
     - Positions, heights, weights
     - Jersey numbers
     - Roster status

5. **Data Normalization**
   - Converts NBA Stats format to internal format:
     - Handles name parsing (first/last name extraction)
     - Normalizes positions
     - Converts heights/weights
     - Maps roster status to `active` boolean

6. **Database Storage**
   - Upserts into two tables:
     - `players`: Core player information
     - `player_team_rosters`: Team-roster relationships
   - Uses transactions for data integrity
   - Stores raw payloads in `staging_events` for replay/debugging (if enabled)

7. **Roster Table Structure**
   - `player_team_rosters` includes:
     - `player_id` (FK to `players`)
     - `team_id` (FK to `teams`)
     - `season` (e.g., `"2025"`)
     - `jersey` (jersey number)
     - `active` (boolean - is player on active roster)
     - `created_at`, `updated_at` timestamps

### Usage

```bash
# Scrape rosters for all teams in 2025-26 season
python scripts/seed_players_nba.py

# Scrape specific team
NBA_STATS_TEAM_ID=1610612737 python scripts/seed_players_nba.py

# Custom season
NBA_STATS_SEASON=2024-25 python scripts/seed_players_nba.py
```

### Environment Variables

- `NBA_STATS_SEASON`: Target season (default: `"2025-26"`)
- `NBA_STATS_TEAM_ID`: Optional team ID override
- `NBA_STATS_REQUEST_DELAY_SECONDS`: Delay between requests (default: `0.7`)
- `NBA_STATS_STAGE_EVENTS`: Enable staging table (default: `true`)

---

## Data Flow

### Box Score Data Flow

```
Basketball Reference HTML
    ↓
scrape-basketball-reference.ts
    ↓
scraped_boxscores (raw scraped data)
    ↓
populate-bbref-stats.ts
    ↓
bbref_player_game_stats (individual player stats)
    ↓
bbref_team_game_stats (aggregated team stats)
```

### Roster Data Flow

```
NBA Stats API
    ↓
seed_players_nba.py
    ↓
players (core player data)
    ↓
player_team_rosters (team-roster relationships)
```

### Integration Points

1. **Player Matching**: Box score scraping uses `players` table to resolve player names to IDs
2. **Team Matching**: Both systems use `teams` table for team identification
3. **Roster Validation**: `scripts/list-roster-issues.ts` identifies players in box scores who aren't on active rosters

---

## Rate Limiting

### Basketball Reference

**Policy:** [Sports Reference Bot Traffic Policy](https://www.sports-reference.com/bot-traffic.html)

- **Limit**: 20 requests per minute maximum
- **Violation**: 24-hour IP ban
- **Our Default**: 15 requests/minute (4 second delay) - conservative to stay safe
- **Configurable**: `BBREF_SCRAPE_DELAY_MS` environment variable

**Features:**
- Per-minute rate limiting
- Per-hour rate limiting (safety check)
- Jitter/randomization added to delays
- Automatic retry with exponential backoff on 429/503 errors

### NBA Stats API

- **Default Delay**: 0.7 seconds between requests
- **Configurable**: `NBA_STATS_REQUEST_DELAY_SECONDS` environment variable
- **No official limit**: But respectful rate limiting is recommended

---

## Key Scripts Reference

### Box Score Scraping

- `scripts/scrape-basketball-reference.ts` - Main HTML scraping script
- `scripts/scrape-bbref-csv-boxscores.ts` - CSV export scraping script
- `scripts/populate-bbref-stats.ts` - Populates final stats tables from scraped data
- `scripts/batch-scrape-missing-bbref-games.ts` - Batch scraping for missing games
- `scripts/find-missing-team-games.ts` - Identifies games with missing box scores

### Roster Management

- `scripts/seed_players_nba.py` - Scrapes rosters from NBA Stats API
- `scripts/list-roster-issues.ts` - Identifies roster mismatches
- `scripts/fix-roster-issues.ts` - Automatically fixes roster issues

### Utilities

- `scripts/resolvePlayerId()` - Player name matching logic (in `scrape-basketball-reference.ts`)
- `scripts/check-skipped-players.ts` - Identifies players that couldn't be matched

---

## Common Issues and Solutions

### Issue: Player Not Matched During Scraping

**Symptoms:** Player appears in `scraped_boxscores` with `player_id = NULL`

**Solutions:**
1. Check if player exists in `players` table with different name format
2. Manually resolve using `resolvePlayerId()` logic
3. Update player name in database if needed
4. Re-scrape the game after fixing

### Issue: Roster Mismatch

**Symptoms:** Player in box score not on active roster for that season

**Solutions:**
1. Run `scripts/list-roster-issues.ts` to identify issues
2. Run `scripts/fix-roster-issues.ts --auto` to automatically add players to rosters
3. Verify player was traded/moved between teams

### Issue: Rate Limiting

**Symptoms:** 429 errors or IP ban from Basketball Reference

**Solutions:**
1. Increase `BBREF_SCRAPE_DELAY_MS` to 5000+ (5+ seconds)
2. Wait 24 hours if IP banned
3. Use VPN/proxy if necessary (be respectful)

---

## Best Practices

1. **Always use rate limiting** - Respect source website policies
2. **Handle errors gracefully** - Games may not exist (404), players may not match
3. **Store raw data** - Keep `scraped_boxscores` for debugging
4. **Validate data** - Check for missing games, skipped players, roster issues
5. **Monitor scraping** - Use `bbref-data-check` API to verify data completeness
6. **Resolve issues promptly** - Fix skipped players and roster mismatches

---

## Related Documentation

- `docs/bbref-csv-boxscore-scraping.md` - Detailed CSV scraping guide
- `docs/html-boxscore-scraping.md` - HTML scraping details
- `scripts/RESOLVING_UNRESOLVED_PLAYERS_GUIDE.md` - Player resolution guide
- `app/api/admin/bbref-data-check/route.ts` - Data quality check API

