# Team Markets vs Player Props: API Response & Storage Explained

## Overview

We fetch **two different types of odds** from the Odds API:
1. **Team Markets** (moneyline, spread, total) - fetched in a single API call
2. **Player Props** (points, rebounds, assists, etc.) - fetched per-event (one call per game)

Both are stored in the same `markets` table, but use different fields depending on the market type.

---

## 1. Team Markets (Moneyline, Spread, Total)

### API Endpoint
```
GET /v4/sports/basketball_nba/odds
```

**Query Parameters:**
- `markets=h2h,spreads,totals` (team markets only)
- `regions=us`
- `oddsFormat=american`

### API Response Structure

```json
[
  {
    "id": "abc123def456",
    "sport_key": "basketball_nba",
    "sport_title": "NBA",
    "commence_time": "2025-01-15T19:00:00Z",
    "home_team": "Los Angeles Lakers",
    "away_team": "Boston Celtics",
    "bookmakers": [
      {
        "key": "draftkings",
        "title": "DraftKings",
        "last_update": "2025-01-15T10:31:00Z",
        "markets": [
          {
            "key": "h2h",  // ← Moneyline
            "outcomes": [
              {
                "name": "Los Angeles Lakers",
                "price": -145  // ← Odds
              },
              {
                "name": "Boston Celtics",
                "price": +125
              }
            ]
          },
          {
            "key": "spreads",  // ← Point Spread
            "outcomes": [
              {
                "name": "Los Angeles Lakers",
                "price": -110,
                "point": -3.5  // ← Spread line
              },
              {
                "name": "Boston Celtics",
                "price": -110,
                "point": +3.5
              }
            ]
          },
          {
            "key": "totals",  // ← Over/Under
            "outcomes": [
              {
                "name": "Over",
                "price": -110,
                "point": 225.5  // ← Total points line
              },
              {
                "name": "Under",
                "price": -110,
                "point": 225.5
              }
            ]
          }
        ]
      }
    ]
  }
]
```

### How We Store Team Markets

**Processing Logic:**
```typescript
// For each bookmaker in the event
for (const bookmaker of event.bookmakers) {
  // For each market (h2h, spreads, totals)
  for (const market of bookmaker.markets) {
    const marketType = mapMarketKeyToType(market.key);
    // h2h -> 'moneyline'
    // spreads -> 'spread'
    // totals -> 'total'
    
    // For each outcome in the market
    for (const outcome of market.outcomes) {
      // Determine side and line
      if (marketType === 'moneyline' || marketType === 'spread') {
        side = outcome.name === event.home_team ? 'home' : 'away';
        line = marketType === 'spread' ? outcome.point : null;
      } else if (marketType === 'total') {
        side = outcome.name.toLowerCase().includes('over') ? 'over' : 'under';
        line = outcome.point;  // Total points (e.g., 225.5)
      }
      
      // Insert into markets table
      insertMarket({
        gameId: 'bbref_202501151900_LAL_BOS',
        marketType: 'moneyline',  // or 'spread' or 'total'
        bookmaker: 'draftkings',
        snapshotType: 'pre_game',
        side: 'home',  // or 'away' or 'over' or 'under'
        line: -3.5,    // Spread value or total points (null for moneyline)
        odds: -145,    // American odds
        providerId: 'abc123def456',
        // player_id: null (not used for team markets)
        // stat_type: null (not used for team markets)
        // stat_line: null (not used for team markets)
      });
    }
  }
}
```

### Database Storage Example

**Team Markets in `markets` table:**

| id | game_id | market_type | bookmaker | side | line | odds | player_id | stat_type | stat_line |
|----|---------|-------------|-----------|------|------|------|-----------|-----------|-----------|
| 1 | `bbref_...` | `moneyline` | `draftkings` | `home` | `NULL` | `-145` | `NULL` | `NULL` | `NULL` |
| 2 | `bbref_...` | `moneyline` | `draftkings` | `away` | `NULL` | `+125` | `NULL` | `NULL` | `NULL` |
| 3 | `bbref_...` | `spread` | `draftkings` | `home` | `-3.5` | `-110` | `NULL` | `NULL` | `NULL` |
| 4 | `bbref_...` | `spread` | `draftkings` | `away` | `+3.5` | `-110` | `NULL` | `NULL` | `NULL` |
| 5 | `bbref_...` | `total` | `draftkings` | `over` | `225.5` | `-110` | `NULL` | `NULL` | `NULL` |
| 6 | `bbref_...` | `total` | `draftkings` | `under` | `225.5` | `-110` | `NULL` | `NULL` | `NULL` |

**Key Points:**
- ✅ `market_type`: `'moneyline'`, `'spread'`, or `'total'`
- ✅ `side`: `'home'`/`'away'` (moneyline/spread) or `'over'`/`'under'` (total)
- ✅ `line`: Spread value (spread) or total points (total) or `NULL` (moneyline)
- ✅ `player_id`, `stat_type`, `stat_line`: Always `NULL` for team markets

---

## 2. Player Props

### API Endpoint
```
GET /v4/sports/basketball_nba/events/{eventId}/odds
```

**Query Parameters:**
- `markets=player_points,player_rebounds,player_assists,player_threes,player_blocks,player_double_double,player_triple_double,player_first_basket`
- `regions=us`
- `oddsFormat=american`

**Note:** This requires a separate API call **per event** (per game). We call this after matching the event to a scheduled game.

### API Response Structure

```json
{
  "id": "abc123def456",
  "sport_key": "basketball_nba",
  "sport_title": "NBA",
  "commence_time": "2025-01-15T19:00:00Z",
  "home_team": "Los Angeles Lakers",
  "away_team": "Boston Celtics",
  "bookmakers": [
    {
      "key": "draftkings",
      "title": "DraftKings",
      "last_update": "2025-01-15T10:31:00Z",
      "markets": [
        {
          "key": "player_points",  // ← Player prop type
          "outcomes": [
            {
              "name": "LeBron James",  // ← Player name
              "description": "Over 25.5",  // ← Over/Under
              "point": 25.5,  // ← Stat line
              "price": -110  // ← Odds
            },
            {
              "name": "LeBron James",
              "description": "Under 25.5",
              "point": 25.5,
              "price": -110
            },
            {
              "name": "Jayson Tatum",
              "description": "Over 28.5",
              "point": 28.5,
              "price": -110
            },
            {
              "name": "Jayson Tatum",
              "description": "Under 28.5",
              "point": 28.5,
              "price": -110
            }
          ]
        },
        {
          "key": "player_rebounds",
          "outcomes": [
            {
              "name": "LeBron James",
              "description": "Over 7.5",
              "point": 7.5,
              "price": -110
            },
            {
              "name": "LeBron James",
              "description": "Under 7.5",
              "point": 7.5,
              "price": -110
            }
          ]
        },
        {
          "key": "player_double_double",  // ← Yes/No prop (no point value)
          "outcomes": [
            {
              "name": "LeBron James",
              "description": "Yes",  // ← Yes/No, not Over/Under
              "price": +150  // ← Odds for "Yes"
            },
            {
              "name": "LeBron James",
              "description": "No",
              "price": -180  // ← Odds for "No"
            }
          ]
        }
      ]
    }
  ]
}
```

### How We Store Player Props

**Processing Logic:**
```typescript
// For each bookmaker in the player props response
for (const bookmaker of playerPropsData.bookmakers) {
  // For each market (player_points, player_rebounds, etc.)
  for (const market of bookmaker.markets) {
    if (!market.key.startsWith('player_')) {
      continue;  // Skip non-player prop markets
    }
    
    const statType = getStatTypeFromMarketKey(market.key);
    // 'player_points' -> 'points'
    // 'player_rebounds' -> 'rebounds'
    // 'player_double_double' -> 'double_double'
    
    // For each outcome (each player's over/under or yes/no)
    for (const outcome of market.outcomes) {
      // Resolve player_id from player name
      const playerId = await resolvePlayerId(
        outcome.name,  // "LeBron James"
        homeTeamAbbr,  // "LAL"
        awayTeamAbbr   // "BOS"
      );
      
      if (!playerId) {
        skipped++;  // Player not found in database
        continue;
      }
      
      // Determine side and stat line
      const desc = outcome.description.toLowerCase();
      
      if (market.key.includes('double_double') || 
          market.key.includes('triple_double') || 
          market.key.includes('first_basket')) {
        // Yes/No props
        side = desc.includes('yes') ? 'yes' : 'no';
        statLine = null;  // No line for Yes/No bets
      } else {
        // Over/Under props
        side = desc.includes('over') ? 'over' : 'under';
        statLine = outcome.point;  // e.g., 25.5
      }
      
      // Insert into markets table
      insertMarket({
        gameId: 'bbref_202501151900_LAL_BOS',
        marketType: 'player_prop',
        bookmaker: 'draftkings',
        snapshotType: 'pre_game',
        side: 'over',  // or 'under' or 'yes' or 'no'
        line: null,     // Always null for player props (use stat_line instead)
        odds: -110,
        providerId: 'abc123def456',
        playerId: 'lebron-james-123',  // ← Resolved from player name
        statType: 'points',  // ← Extracted from market.key
        statLine: 25.5,      // ← Over/under line (null for Yes/No)
      });
    }
  }
}
```

### Database Storage Example

**Player Props in `markets` table:**

| id | game_id | market_type | bookmaker | side | line | odds | player_id | stat_type | stat_line |
|----|---------|-------------|-----------|------|------|------|-----------|-----------|-----------|
| 7 | `bbref_...` | `player_prop` | `draftkings` | `over` | `NULL` | `-110` | `lebron-james-123` | `points` | `25.5` |
| 8 | `bbref_...` | `player_prop` | `draftkings` | `under` | `NULL` | `-110` | `lebron-james-123` | `points` | `25.5` |
| 9 | `bbref_...` | `player_prop` | `draftkings` | `over` | `NULL` | `-110` | `lebron-james-123` | `rebounds` | `7.5` |
| 10 | `bbref_...` | `player_prop` | `draftkings` | `under` | `NULL` | `-110` | `lebron-james-123` | `rebounds` | `7.5` |
| 11 | `bbref_...` | `player_prop` | `draftkings` | `yes` | `NULL` | `+150` | `lebron-james-123` | `double_double` | `NULL` |
| 12 | `bbref_...` | `player_prop` | `draftkings` | `no` | `NULL` | `-180` | `lebron-james-123` | `double_double` | `NULL` |

**Key Points:**
- ✅ `market_type`: Always `'player_prop'`
- ✅ `side`: `'over'`/`'under'` (for stat props) or `'yes'`/`'no'` (for double_double, triple_double, first_basket)
- ✅ `line`: Always `NULL` for player props (use `stat_line` instead)
- ✅ `player_id`: Resolved from player name using fuzzy matching
- ✅ `stat_type`: Extracted from market key (`'points'`, `'rebounds'`, `'assists'`, etc.)
- ✅ `stat_line`: Over/under line (e.g., `25.5`) or `NULL` for Yes/No props

---

## 3. Key Differences Summary

| Aspect | Team Markets | Player Props |
|--------|--------------|--------------|
| **API Endpoint** | `/sports/basketball_nba/odds` (single call) | `/events/{eventId}/odds` (per-event call) |
| **Market Keys** | `h2h`, `spreads`, `totals` | `player_points`, `player_rebounds`, etc. |
| **Market Type** | `moneyline`, `spread`, `total` | `player_prop` |
| **Side Values** | `home`/`away` or `over`/`under` | `over`/`under` or `yes`/`no` |
| **Line Field** | Used for spread/total | Always `NULL` |
| **Stat Line Field** | Always `NULL` | Used for over/under line |
| **Player ID** | Always `NULL` | Required (resolved from name) |
| **Stat Type** | Always `NULL` | Required (`points`, `rebounds`, etc.) |
| **Outcomes** | Team names | Player names |
| **Processing** | Direct mapping | Requires player name → ID resolution |

---

## 4. Database Schema Constraints

### Team Markets Constraints
```sql
-- market_type must be one of: 'moneyline', 'spread', 'total'
-- side must be: 'home'/'away' (moneyline/spread) or 'over'/'under' (total)
-- player_id, stat_type, stat_line must be NULL
```

### Player Props Constraints
```sql
-- market_type must be 'player_prop'
-- side must be: 'over'/'under' (stat props) or 'yes'/'no' (double_double, etc.)
-- player_id and stat_type must NOT be NULL
-- line must be NULL (use stat_line instead)
```

**Schema Check:**
```sql
constraint markets_player_prop_check check (
  (market_type = 'player_prop' and player_id is not null and stat_type is not null) or
  (market_type != 'player_prop' and player_id is null)
)
```

---

## 5. Example: Complete Game Storage

**Game:** LAL vs BOS on 2025-01-15

### Team Markets (6 rows)
1. Moneyline: LAL (-145)
2. Moneyline: BOS (+125)
3. Spread: LAL -3.5 (-110)
4. Spread: BOS +3.5 (-110)
5. Total: Over 225.5 (-110)
6. Total: Under 225.5 (-110)

### Player Props (example: 2 players, 3 props each = 12 rows)
1. LeBron James: Over 25.5 points (-110)
2. LeBron James: Under 25.5 points (-110)
3. LeBron James: Over 7.5 rebounds (-110)
4. LeBron James: Under 7.5 rebounds (-110)
5. LeBron James: Yes double-double (+150)
6. LeBron James: No double-double (-180)
7. Jayson Tatum: Over 28.5 points (-110)
8. Jayson Tatum: Under 28.5 points (-110)
9. Jayson Tatum: Over 8.5 rebounds (-110)
10. Jayson Tatum: Under 8.5 rebounds (-110)
11. Jayson Tatum: Yes double-double (+120)
12. Jayson Tatum: No double-double (-140)

**Total: 18 rows** in `markets` table for this one game.

---

## 6. Querying Examples

### Get Team Odds for a Game
```sql
SELECT 
  market_type,
  side,
  line,
  odds,
  bookmaker
FROM markets
WHERE game_id = 'bbref_202501151900_LAL_BOS'
  AND market_type IN ('moneyline', 'spread', 'total')
  AND snapshot_type = 'pre_game'
ORDER BY market_type, side;
```

### Get Player Props for a Game
```sql
SELECT 
  p.full_name as player_name,
  m.stat_type,
  m.side,
  m.stat_line,
  m.odds,
  m.bookmaker
FROM markets m
JOIN players p ON m.player_id = p.player_id
WHERE m.game_id = 'bbref_202501151900_LAL_BOS'
  AND m.market_type = 'player_prop'
  AND m.snapshot_type = 'pre_game'
ORDER BY p.full_name, m.stat_type, m.side;
```

### Get Specific Player Prop (e.g., LeBron Points)
```sql
SELECT 
  side,
  stat_line,
  odds,
  bookmaker
FROM markets
WHERE game_id = 'bbref_202501151900_LAL_BOS'
  AND market_type = 'player_prop'
  AND player_id = 'lebron-james-123'
  AND stat_type = 'points'
  AND snapshot_type = 'pre_game';
```

---

## 7. Important Notes

### Player Name Resolution
- Player props require resolving player names to `player_id`
- We use fuzzy matching with team context (home/away teams)
- If a player can't be resolved, that prop is **skipped** (not stored)
- This is why you might see "X players skipped (unresolved)" in logs

### API Call Strategy
- **Team Odds**: 1 API call gets all games for the day
- **Player Props**: 1 API call per game (N calls for N games)
- Example: 10 games = 1 team odds call + 10 player prop calls = **11 total calls**

### Unique Constraints
- Pre-game and closing snapshots have a unique constraint
- This prevents duplicate odds for the same game/market/bookmaker/side
- Live/mid-game snapshots can have multiple rows (to track line movement)

### Bookmaker Priority
- We prioritize DraftKings (`draftkings`) if available
- If DraftKings not available, we use the first bookmaker in the response
- All bookmakers are stored, but we prefer DraftKings for queries

---

_Last updated: 2025-11-29_





