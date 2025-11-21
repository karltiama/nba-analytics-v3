# HTML Box Score Scraping

## Overview

We've implemented HTML box score scraping as a fallback method when the JSON API endpoints fail or are unavailable. This provides redundancy and may help fill in missing box scores.

## URL Format

NBA.com uses a predictable URL format for box score pages:

```
https://www.nba.com/game/{away-team}-vs-{home-team}-{gameId}/box-score
```

**Example:**
```
https://www.nba.com/game/det-vs-atl-0022500251/box-score
```

Where:
- `det` = Detroit Pistons (away team abbreviation, lowercase)
- `atl` = Atlanta Hawks (home team abbreviation, lowercase)
- `0022500251` = NBA Stats game ID

## Implementation

### Functions Added to `scrape-nba-com.ts`

1. **`getTeamAbbreviations(gameId: string)`**
   - Queries database to get team abbreviations for a game
   - Returns `{ homeAbbr: string, awayAbbr: string }` (lowercase)

2. **`fetchBoxScoreHTML(gameId: string)`**
   - Constructs HTML box score URL
   - Fetches HTML page with proper headers
   - Parses HTML using Cheerio
   - Attempts multiple extraction methods:
     - HTML tables with player stats
     - Embedded JSON data in `<script>` tags
     - `data-testid` attributes
   - Returns parsed data

3. **`fetchBoxScoreWithFallback(gameId: string)`**
   - Tries JSON API first (preferred)
   - Falls back to HTML scraping if JSON fails
   - Provides unified interface

## Usage

### Test HTML Scraping

```bash
# Test with a specific game ID
tsx scripts/test-html-boxscore.ts --game-id 0022500251

# Or test with full URL
tsx scripts/test-html-boxscore.ts --url https://www.nba.com/game/det-vs-atl-0022500251/box-score
```

### Use HTML Scraping Directly

```bash
tsx scripts/scrape-nba-com.ts --boxscore-html --game-id 0022500251
```

### Use Fallback (JSON → HTML)

The `fetchBoxScoreWithFallback()` function automatically tries JSON first, then HTML:

```typescript
import { fetchBoxScoreWithFallback } from './scrape-nba-com';

const boxScore = await fetchBoxScoreWithFallback('0022500251');
```

## HTML Parsing Strategy

The scraper uses a multi-step approach:

1. **Table Parsing**: Looks for `<table>` elements with player stats
   - Extracts headers from `<thead>` or first row
   - Parses player rows from `<tbody>` or subsequent rows
   - Filters rows that contain common stat columns (MIN, PTS, REB, AST)

2. **Embedded JSON**: Searches `<script>` tags for JSON data
   - Looks for `boxScore`, `playerStats`, or `gameData` keywords
   - Attempts to parse JSON objects

3. **Data Attributes**: Extracts `data-testid` attributes as fallback
   - Useful for modern React-based pages

## Current Status

✅ **Implemented:**
- URL construction from game ID
- HTML fetching with proper headers
- Basic HTML parsing (tables, scripts, data attributes)
- Rate limiting and error handling
- Test script for inspection

⚠️ **Needs Testing:**
- Actual page structure may differ from assumptions
- Table selectors may need refinement
- JSON extraction may need adjustment
- Player stat mapping needs verification

## Next Steps

1. **Test with Real Pages**: Run `test-html-boxscore.ts` on actual games to see structure
2. **Refine Parsing**: Adjust selectors based on actual HTML structure
3. **Map Stats**: Ensure extracted stats match our database schema
4. **Integrate**: Update `fetch-missing-boxscores.ts` to use HTML fallback
5. **Monitor**: Track success rate vs JSON API

## Integration with Existing Scripts

To integrate HTML scraping into the box score fetching workflow:

```typescript
// In fetch-missing-boxscores.ts or retry-missing-boxscores.ts
import { fetchBoxScoreWithFallback } from './scrape-nba-com';

// Replace fetchBoxScore() calls with:
const boxScoreData = await fetchBoxScoreWithFallback(nbaGameId);
```

## Rate Limiting

HTML scraping uses the same rate limiting as JSON API:
- `NBA_SCRAPE_DELAY_MS`: Delay between requests (default: 2000ms)
- `NBA_SCRAPE_MAX_PER_HOUR`: Max requests per hour (default: 1000)
- Jitter and exponential backoff included

## Advantages

1. **Redundancy**: Fallback when JSON API fails
2. **Different Availability**: HTML pages may be available when JSON isn't
3. **No Additional Cost**: Uses same free endpoints
4. **Same Rate Limits**: Respects NBA.com's limits

## Disadvantages

1. **Fragile**: HTML structure can change, breaking parsing
2. **More Complex**: HTML parsing is more involved than JSON
3. **Maintenance**: May need updates if NBA.com changes page structure
4. **Slower**: HTML parsing is slower than JSON parsing

## Testing Checklist

- [ ] Test with recent games (Final status)
- [ ] Test with older games (historical)
- [ ] Verify player stats extraction
- [ ] Check team stat totals
- [ ] Test error handling (404, 403, etc.)
- [ ] Verify rate limiting works
- [ ] Compare HTML vs JSON results

## References

- [NBA.com Box Score Example](https://www.nba.com/game/det-vs-atl-0022500251/box-score)
- Cheerio Documentation: https://cheerio.js.org/
- Rate Limiting Best Practices: See `scrape-nba-com.ts` comments




