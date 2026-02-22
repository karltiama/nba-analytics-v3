# Live Box Score Scraping - How It Works

## Overview

We've successfully implemented a **Playwright-based scraper** that fetches live box scores from NBA.com by executing JavaScript in a headless browser. This approach is necessary because NBA.com loads box score data dynamically via client-side JavaScript, which means static HTML scraping doesn't work.

## Why Playwright?

NBA.com uses **Next.js** with client-side rendering, meaning:
- Initial HTML doesn't contain box score data
- Data is loaded via JavaScript after page load
- Static HTML scraping (like Cheerio) can't access this data
- **Playwright** executes JavaScript and gets fully rendered content

## How It Works

### 1. **Page Loading**
```
Script → Playwright Browser → NBA.com URL → Fully Rendered Page
```

The scraper:
- Launches a headless Chromium browser
- Navigates to: `https://www.nba.com/game/{away}-vs-{home}-{gameId}/box-score#box-score`
- Waits for page to load and JavaScript to execute
- Waits for box score content to appear (tables, selectors)

### 2. **Data Extraction Methods**

The scraper uses **two methods** to extract data (tries both):

#### Method 1: JSON Data from `__NEXT_DATA__` (Preferred)
- NBA.com embeds game data in a `<script id="__NEXT_DATA__">` tag
- Contains structured JSON with:
  - `pageProps.game` - Game metadata, status, teams
  - `pageProps.game.homeTeamPlayers` - Home team player list
  - `pageProps.game.awayTeamPlayers` - Away team player list
  - `pageProps.game.boxScore` - Box score data (if available)

**Advantages:**
- Structured, clean data
- Includes game status, period, clock
- Team information included

**Limitations:**
- Player objects may not have stats until game starts
- Structure may vary by game state

#### Method 2: HTML Table Parsing (Fallback)
- Parses rendered HTML tables on the page
- Extracts player stats from table rows
- Identifies columns: Player, MIN, PTS, REB, AST, FG, 3PT, FT

**Advantages:**
- Works even when JSON structure is incomplete
- Gets live stats as they appear on page
- More reliable for in-progress games

**Limitations:**
- Player names may need cleaning (duplicates, formatting)
- Team identification requires context

### 3. **Data Processing**

Once data is extracted:

1. **Player Stats Normalization**
   - Maps different field name formats (PTS vs points, MIN vs minutes)
   - Cleans player names (removes duplicates)
   - Groups players by team

2. **Display Formatting**
   - Formats minutes as "MM:SS"
   - Formats field goals as "MADE-ATTEMPTED"
   - Sorts players by points (descending)
   - Displays top 10 players per team

## Technical Details

### URL Format
```
https://www.nba.com/game/{awayAbbr}-vs-{homeAbbr}-{gameId}/box-score#box-score
```

**Example:**
```
https://www.nba.com/game/por-vs-cle-0022500324/box-score#box-score
```

Where:
- `por` = Portland Trail Blazers (away, lowercase)
- `cle` = Cleveland Cavaliers (home, lowercase)
- `0022500324` = NBA Stats game ID

### Game ID Formats

The scraper handles two game ID formats:
1. **NBA Stats IDs**: `0022500324` (starts with `002`)
2. **BallDontLie IDs**: `18447143` (starts with `184`)

Both work with the same URL format.

### Wait Strategy

The scraper uses multiple wait strategies:
1. **Initial Load**: `domcontentloaded` (faster, less strict)
2. **Network Idle**: Waits for network activity to settle
3. **Selector Wait**: Waits for specific elements (tables, player stats)
4. **Timeout**: 60 seconds max wait time

### Error Handling

- **Network Timeouts**: Continues even if network idle times out
- **Missing Selectors**: Falls back to HTML parsing
- **No Stats Yet**: Detects if game hasn't started
- **404 Errors**: Detects if game page doesn't exist

## Usage

### Test Single Game
```bash
tsx scripts/test-live-boxscores-playwright.ts --game-id 0022500324
```

### Test Today's Games
```bash
tsx scripts/test-live-boxscores-playwright.ts
```

### Output Example
```
🏀 Testing Live Box Scores via Playwright

🚀 Launching browser...
✅ Browser launched

Testing game: 0022500324
Teams: POR @ CLE

🌐 Loading page with Playwright: https://www.nba.com/game/por-vs-cle-0022500324/box-score#box-score
✅ Found selector: table
Page title: Portland Trail Blazers vs Cleveland Cavaliers Dec 3, 2025 Box Scores | NBA.com
✅ Found game object in pageProps
Game status: Q2 3:33
✅ Extracted 20 player stats from HTML tables

============================================================
Box Score: POR @ CLE
Game ID: 0022500324
Source: playwright_html
============================================================

CLE (10 players):
   Player                MIN     PTS   REB   AST   FG        3PT       FT
   --------------------------------------------------------------------------------
   Evan Mobley           12:17   16    2     1     6-9       50.0      2-2
   Donovan Mitchell      13:15   14    1     3     6-11      33.3      0-0
   ...
```

## Data Extracted

### Player Stats
- **Name**: Player full name
- **Minutes**: Time played (MM:SS format)
- **Points**: Total points scored
- **Rebounds**: Total rebounds
- **Assists**: Total assists
- **Field Goals**: Made-Attempted (e.g., "6-9")
- **Three Pointers**: Made-Attempted (e.g., "4-8")
- **Free Throws**: Made-Attempted (e.g., "2-2")

### Game Information
- **Game Status**: Period and time (e.g., "Q2 3:33")
- **Team Abbreviations**: Home and away team codes
- **Game ID**: NBA Stats or BallDontLie game ID

## Current Limitations

1. **Player Name Cleaning**: Names sometimes have duplicates (e.g., "Evan MobleyE. MobleyC")
2. **Team Identification**: HTML table parsing doesn't always identify which team a player belongs to
3. **Performance**: Playwright is slower than static scraping (5-10 seconds per game)
4. **Resource Usage**: Requires browser binary (~170MB download)

## Future Improvements

1. **Better Name Parsing**: Clean up duplicate names in player data
2. **Team Context**: Use table context or JSON data to identify teams
3. **Lambda Function**: Create AWS Lambda version for automated polling
4. **Database Storage**: Save extracted stats to Supabase
5. **Polling Schedule**: Set up EventBridge to poll every 1-2 minutes during games
6. **Error Recovery**: Better handling of games that haven't started yet

## Comparison: Playwright vs Static Scraping

| Feature | Static HTML (Cheerio) | Playwright |
|---------|----------------------|------------|
| **JavaScript Execution** | ❌ No | ✅ Yes |
| **Speed** | ⚡ Fast (1-2s) | 🐢 Slower (5-10s) |
| **Live Data** | ❌ No | ✅ Yes |
| **Reliability** | ⚠️ Limited | ✅ High |
| **Resource Usage** | 💚 Light | 🟡 Medium |

## Files

- **Script**: `scripts/test-live-boxscores-playwright.ts`
- **Documentation**: `docs/live-boxscore-scraping-options.md`
- **Dependencies**: `playwright` (npm package)

## Dependencies

```json
{
  "playwright": "^1.x.x"
}
```

**Installation:**
```bash
npm install playwright
npx playwright install chromium
```

## Next Steps

1. ✅ **Scraper Working** - Successfully extracts live box scores
2. ⏳ **Clean Player Names** - Improve name parsing
3. ⏳ **Lambda Function** - Create AWS Lambda version
4. ⏳ **Database Integration** - Save to Supabase
5. ⏳ **Automated Polling** - Set up EventBridge schedule

---

**Last Updated**: December 3, 2025  
**Status**: ✅ Working - Successfully extracting live box scores from NBA.com





