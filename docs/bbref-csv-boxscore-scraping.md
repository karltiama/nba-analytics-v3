# Basketball Reference CSV Box Score Scraping

## Overview

This is a fresh approach to scraping box score data from Basketball Reference using their CSV export functionality. This provides a clean, structured way to collect box score data.

## How It Works

Basketball Reference provides CSV export links for each team's box score table on game pages. The CSV links are found via selectors like `#csv_box-HOU-game-basic` where `HOU` is the team code.

### URL Format

- **Box Score Page**: `https://www.basketball-reference.com/boxscores/YYYYMMDD0TEAM.html`
  - Example: `https://www.basketball-reference.com/boxscores/202510210OKC.html`
  
- **CSV Export**: `https://www.basketball-reference.com/boxscores/csv/boxscores/YYYYMMDD0TEAM.csv`
  - Example: `https://www.basketball-reference.com/boxscores/csv/boxscores/202510210OKC.csv`

## Database Schema

Data is stored in the `bbref_boxscores_csv` table, which includes:

- Game and team information
- Player names (with optional resolved player_id)
- All box score statistics (FG, 3P, FT, rebounds, assists, etc.)
- Raw CSV row data (for debugging/reference)
- Timestamps for tracking when data was scraped

## Usage

### Scrape a single game

```bash
# Using game_id
tsx scripts/scrape-bbref-csv-boxscores.ts --game-id 1842025102199

# Using bbref_game_id
tsx scripts/scrape-bbref-csv-boxscores.ts --bbref-game-id bbref_202510210000_HOU_OKC

# Dry run (preview without saving)
tsx scripts/scrape-bbref-csv-boxscores.ts --game-id 1842025102199 --dry-run
```

### Batch Processing

You can create a script to process multiple games:

```typescript
import { processCSVBoxScore } from './scripts/scrape-bbref-csv-boxscores';

const gameIds = ['1842025102199', '1842025102200', ...];

for (const gameId of gameIds) {
  await processCSVBoxScore(gameId);
  // Rate limiting is built-in (4 seconds between requests)
}
```

## Advantages

1. **Clean Data**: CSV format is structured and easier to parse than HTML
2. **Fresh Start**: New table (`bbref_boxscores_csv`) provides a clean slate
3. **Raw Data Storage**: Stores raw CSV rows for debugging/reference
4. **Player Resolution**: Attempts to resolve player names to player_ids
5. **Rate Limiting**: Built-in rate limiting (15 requests/minute)

## Data Flow

1. Script finds game information from `games` or `bbref_schedule` table
2. Constructs Basketball Reference box score URL
3. Scrapes HTML page to find CSV export links
4. Downloads and parses CSV files for each team
5. Stores data in `bbref_boxscores_csv` table

## Next Steps

After scraping CSV data, you can:

1. **Sync to main table**: Create a script to sync `bbref_boxscores_csv` → `player_game_stats`
2. **Resolve players**: Run player name resolution for unmatched players
3. **Validate data**: Compare CSV data with existing box scores for accuracy

## Example CSV Structure

Basketball Reference CSV files typically have columns like:

```
Player,MP,FG,FGA,FG%,3P,3PA,3P%,FT,FTA,FT%,ORB,DRB,TRB,AST,STL,BLK,TOV,PF,PTS,+/-,
```

The script handles various column name formats (case-insensitive, with/without special characters).


