# Player Props API Findings

## Critical Discovery

**Player props are NOT available via the main `/sports/basketball_nba/odds` endpoint.**

According to the [Odds API documentation](https://the-odds-api.com/sports-odds-data/betting-markets.html#nba-ncaab-wnba-player-props-api), player props must be fetched using the `/events/{eventId}/odds` endpoint, which requires:

1. **First call:** `/sports/basketball_nba/odds` to get events (team odds)
2. **Second call (per event):** `/events/{eventId}/odds` to get player props for that specific event

## Impact on Credit Usage

### Current Plan (Team Odds Only)
- 1 API call per day = 30 calls/month
- **Credits: 90-150/month** ✅

### With Player Props (Per-Event Calls)
- 1 call for team odds + N calls for player props (N = number of games)
- Example: 10 games/day = 1 + 10 = 11 calls/day
- **Credits: 330-550/month** ⚠️ (may exceed 500 quota)

### Recommendation
**For MVP: Skip player props or fetch selectively**

Options:
1. **Skip player props** (simplest, stays within quota)
2. **Fetch player props for select games** (e.g., primetime games only)
3. **Fetch player props for select players** (requires additional logic)
4. **Upgrade Odds API plan** (if you need all player props)

## Available Player Props

### Over/Under Markets (have `point` value)
- ✅ `player_points` - Points scored
- ✅ `player_rebounds` - Rebounds
- ✅ `player_assists` - Assists
- ✅ `player_threes` - Three-pointers made
- ✅ `player_blocks` - Blocks
- ❌ `player_steals` - Not found in test (may not be available)
- ❌ `player_turnovers` - Not found in test (may not be available)

### Yes/No Markets (no `point` value, just odds)
- ✅ `player_double_double` - Player to record a double-double
- ✅ `player_triple_double` - Player to record a triple-double
- ✅ `player_first_basket` - Player to score first basket

## Schema Updates Required

### ✅ Already Updated
- `side` field constraint now allows `'yes' | 'no'` for player props
- `stat_line` can be NULL for Yes/No bets
- `stat_type` is TEXT (can store any value)

### Schema Status
```sql
-- Updated constraint allows:
(market_type = 'player_prop' and side in ('over', 'under', 'yes', 'no'))
```

## API Response Structure

### Over/Under Player Prop Example
```json
{
  "key": "player_points",
  "outcomes": [
    {
      "name": "LeBron James",
      "description": "Over 25.5",
      "point": 25.5,
      "price": -110
    },
    {
      "name": "LeBron James",
      "description": "Under 25.5",
      "point": 25.5,
      "price": -110
    }
  ]
}
```

### Yes/No Player Prop Example
```json
{
  "key": "player_double_double",
  "outcomes": [
    {
      "name": "Rudy Gobert",
      "description": "Rudy Gobert",
      "point": null,  // No point value for Yes/No bets
      "price": 135   // Odds for "Yes"
    }
  ]
}
```

**Note:** Yes/No bets may only have one outcome (the "Yes" option), or may have separate "Yes" and "No" outcomes depending on the bookmaker.

## Implementation Strategy

### Option 1: Skip Player Props (Recommended for MVP)
- ✅ Simplest implementation
- ✅ Stays well within 500 credit quota
- ✅ Can add later when needed

### Option 2: Fetch Player Props for All Games
- ⚠️ Requires N+1 API calls (1 for team odds + N for player props)
- ⚠️ May exceed 500 credit quota
- ⚠️ More complex implementation

### Option 3: Fetch Player Props Selectively
- ✅ Fetch player props only for primetime games
- ✅ Or fetch player props only for specific players
- ✅ More complex but stays within quota

## Code Changes Required

If implementing player props:

1. **Update Lambda function:**
   - After fetching team odds, loop through events
   - For each event, call `/events/{eventId}/odds` with player prop markets
   - Process player props similar to team markets

2. **Handle Yes/No bets:**
   - Check if `outcome.point` is null
   - Set `side` to `'yes'` or `'no'` based on outcome description
   - Set `stat_line` to NULL

3. **Update market processing:**
   - Map market keys to stat types
   - Handle special cases (double_double, triple_double, first_basket)

## Test Results

**Date:** 2025-11-29  
**Games Tested:** 1 (Boston Celtics @ Minnesota Timberwolves)  
**Bookmakers with Props:** 6 (fanduel, betonlineag, draftkings, betmgm, bovada, betrivers)

**Player Props Found:**
- ✅ player_points
- ✅ player_rebounds
- ✅ player_assists
- ✅ player_threes
- ✅ player_blocks
- ✅ player_double_double (Yes/No)
- ✅ player_triple_double (Yes/No)
- ✅ player_first_basket (Yes/No)
- ❌ player_steals (not found)
- ❌ player_turnovers (not found)

## Next Steps

1. ✅ **Schema updated** to support Yes/No bets
2. ⏳ **Decide on strategy:** Skip player props or implement selectively
3. ⏳ **If implementing:** Update Lambda function to make per-event calls
4. ⏳ **Test credit usage** with actual implementation

---

_Last updated: 2025-11-29_

