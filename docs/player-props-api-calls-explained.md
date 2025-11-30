# Player Props API Calls Explained

## How Player Props Work

**Yes, player props require multiple API calls - one per game.**

### API Call Breakdown

#### Team Odds (Single Call)
```
GET /v4/sports/basketball_nba/odds?markets=h2h,spreads,totals
```
- **1 API call** for ALL games
- Returns team odds (moneyline, spread, total) for all upcoming games
- ✅ Efficient - single call gets everything

#### Player Props (Multiple Calls - One Per Game)
```
GET /v4/sports/basketball_nba/events/{eventId}/odds?markets=player_points,player_rebounds,...
```
- **N API calls** (one per game)
- Each call fetches player props for ONE specific game
- ❌ Less efficient - requires separate call per game

### Why This Design?

According to the [Odds API documentation](https://the-odds-api.com/sports-odds-data/betting-markets.html#nba-ncaab-wnba-player-props-api):

> "Additional markets need to be accessed one event at a time using the new `/events/{eventId}/odds` endpoint."

**Reason:** Player props data is much larger than team odds, so the API requires per-event requests to avoid huge response payloads.

## Example: Today's Games

**Scenario:** 8 games scheduled today

### With Team Odds Only
- **API Calls:** 1
- **Credits:** ~3-5 credits
- **Time:** ~2 seconds

### With Team Odds + Player Props
- **API Calls:** 1 (team) + 8 (player props) = **9 total**
- **Credits:** ~27-45 credits (9 × 3-5)
- **Time:** ~10-15 seconds

## Monthly Credit Usage

### Team Odds Only
- 30 days × 1 call = **30 calls/month**
- Credits: **90-150/month** ✅

### Team Odds + Player Props
- 30 days × 1 call (team) = 30 calls
- ~10 games/day × 30 days = 300 calls (player props)
- **Total: 330 calls/month**
- Credits: **990-1,650/month** ❌ (exceeds 500 quota)

## Current Implementation

The Lambda function and test script both:
1. Make **1 call** for team odds (gets all games)
2. Loop through matched games
3. Make **1 call per game** for player props

**Code Example:**
```typescript
// Step 1: Single call for team odds
const allEvents = await fetchTeamOdds(); // 1 API call

// Step 2: Loop and fetch player props
for (const { event } of matchedGames) {
  const playerProps = await fetchPlayerProps(event.id); // N API calls (one per game)
}
```

## Optimization Strategies

### Option 1: Skip Player Props (Recommended for MVP)
- ✅ Stays within 500 credit quota
- ✅ Fast execution
- ✅ Simple implementation

### Option 2: Fetch Selectively
- Only fetch player props for primetime games
- Or fetch for specific players only
- Reduces API calls but adds complexity

### Option 3: Batch Processing
- Not possible - API doesn't support batch player props
- Must call `/events/{eventId}/odds` per game

### Option 4: Upgrade Plan
- If you need all player props, upgrade Odds API plan
- Higher tier plans have more credits

## Summary

**Question:** Do player props make multiple requests to the API?

**Answer:** Yes. Player props require **one API call per game**, while team odds only need **one call for all games**.

**Impact:**
- 8 games today = 9 total API calls (1 team + 8 player props)
- Monthly: ~330 API calls (vs 30 for team odds only)
- Credits: ~990-1,650/month (vs 90-150 for team odds only)

**Recommendation:** For MVP, stick with team odds only to stay within your 500 credit quota.

---

_Last updated: 2025-11-29_

