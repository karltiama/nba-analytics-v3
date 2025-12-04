# Live Box Score Scraping Options

## Current Status

We've tested HTML scraping from NBA.com, but discovered that:

1. ✅ **NBA.com HTML pages are accessible** - We can fetch the HTML
2. ✅ **__NEXT_DATA__ script tag exists** - Contains page structure
3. ⚠️ **Box score data is loaded client-side** - Not in initial HTML, loaded via JavaScript after page load

## Options for Live Box Scores

### Option 1: Headless Browser (Recommended for Live Data)

**Tools:** Playwright or Puppeteer

**Pros:**
- Executes JavaScript, gets fully rendered page
- Can wait for data to load
- Most reliable for dynamic content

**Cons:**
- Slower (needs to render page)
- More resource intensive
- Requires browser automation

**Implementation:**
```typescript
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`https://www.nba.com/game/${awayAbbr}-vs-${homeAbbr}-${gameId}/box-score`);
await page.waitForSelector('[data-testid*="player"]', { timeout: 10000 });
const html = await page.content();
// Parse HTML with cheerio
```

### Option 2: Intercept API Calls

**Approach:** Monitor network requests to find the API endpoint that loads box score data

**Pros:**
- Fast (direct API call)
- Lightweight
- Can be called repeatedly for live updates

**Cons:**
- Need to reverse engineer the API
- May require authentication
- API structure may change

**How to find:**
1. Open browser DevTools → Network tab
2. Navigate to NBA.com box score page
3. Look for XHR/Fetch requests that return box score data
4. Copy the request URL and headers
5. Replicate in your scraper

### Option 3: ESPN Scraping (Alternative Source)

**URL Format:** `https://www.espn.com/nba/boxscore/_/gameId/{espnGameId}`

**Pros:**
- Alternative source if NBA.com fails
- May have different data structure
- Good for redundancy

**Cons:**
- Requires ESPN game ID (different from NBA Stats ID)
- Need to map NBA game IDs to ESPN game IDs
- Also uses client-side rendering

### Option 4: Basketball Reference (Final Games Only)

**Already Implemented:** ✅ `lambda/boxscore-scraper/index.ts`

**Pros:**
- Reliable for final games
- Already working in your codebase
- Good historical data

**Cons:**
- Only works for completed games
- Not live/real-time
- HTML structure may change

## Recommended Approach

### For Live/Real-time Box Scores:

1. **Use Playwright** to scrape NBA.com box score pages
   - Wait for JavaScript to load
   - Extract data from rendered page
   - Poll every 30-60 seconds for live games

2. **Fallback to Basketball Reference** for final games
   - Already implemented
   - More reliable for completed games

### Implementation Plan

1. **Create Playwright scraper:**
   ```bash
   npm install playwright
   ```

2. **Create Lambda function** that:
   - Gets today's games from database
   - For each live game, uses Playwright to scrape box score
   - Updates database with latest stats
   - Runs every 1-2 minutes during game time

3. **Schedule with EventBridge:**
   - Run every 2 minutes during NBA game hours (7 PM - 1 AM ET)
   - Only process games with status "Live" or "In Progress"

## Current Test Scripts

- ✅ `scripts/test-live-boxscores-html.ts` - HTML scraping (works but limited by client-side JS)
- ✅ `scripts/test-live-boxscores.ts` - NBA API (unreliable per user feedback)

## Next Steps

1. **Test Playwright approach** with a single game
2. **Create Lambda function** for automated scraping
3. **Set up EventBridge schedule** for live updates
4. **Add error handling** for games that haven't started yet

## Notes

- NBA.com box score pages require JavaScript execution
- Static HTML scraping won't work for live data
- Consider rate limiting and respectful scraping practices
- May need to handle CAPTCHAs or bot detection

