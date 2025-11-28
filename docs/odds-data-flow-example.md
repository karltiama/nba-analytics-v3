# Odds Data Flow: Complete Example

This document shows a complete example of how odds data flows from the Odds API through our system.

---

## Step 1: Fetch from Odds API

**Request:**
```bash
GET https://api.the-odds-api.com/v4/sports/basketball_nba/odds?apiKey=YOUR_KEY&regions=us&markets=h2h,spreads,totals
```

**Response:**
```json
[
  {
    "id": "abc123def456",
    "sport_key": "basketball_nba",
    "commence_time": "2025-01-15T19:00:00Z",
    "home_team": "Los Angeles Lakers",
    "away_team": "Boston Celtics",
    "bookmakers": [
      {
        "key": "draftkings",
        "title": "DraftKings",
        "last_update": "2025-01-15T10:30:00Z",
        "markets": [
          {
            "key": "h2h",
            "outcomes": [
              {"name": "Los Angeles Lakers", "price": -150},
              {"name": "Boston Celtics", "price": +130}
            ]
          },
          {
            "key": "spreads",
            "outcomes": [
              {"name": "Los Angeles Lakers", "point": -3.5, "price": -110},
              {"name": "Boston Celtics", "point": +3.5, "price": -110}
            ]
          },
          {
            "key": "totals",
            "outcomes": [
              {"name": "Over", "point": 225.5, "price": -110},
              {"name": "Under", "point": 225.5, "price": -110}
            ]
          }
        ]
      },
      {
        "key": "fanduel",
        "title": "FanDuel",
        "markets": [
          {
            "key": "h2h",
            "outcomes": [
              {"name": "Los Angeles Lakers", "price": -145},
              {"name": "Boston Celtics", "price": +125}
            ]
          }
        ]
      }
    ]
  }
]
```

---

## Step 2: Store Raw Payload in `staging_events`

**SQL Insert:**
```sql
INSERT INTO staging_events (source, kind, cursor, payload, fetched_at)
VALUES (
  'oddsapi',
  'odds',
  '2025-01-15',  -- Date cursor for replay
  '{"id": "abc123def456", "sport_key": "basketball_nba", ...}'::jsonb,
  '2025-01-15T10:30:00Z'::timestamptz
);
```

**Result:**
- Raw JSON stored for debugging/replay
- `processed = false` (not yet normalized)
- Can replay if processing fails

---

## Step 3: Map Teams to Internal IDs

**Lookup:**
```sql
-- Find internal team_id for "Los Angeles Lakers"
SELECT team_id FROM teams WHERE full_name = 'Los Angeles Lakers';
-- Returns: 'LAL'

-- Find internal team_id for "Boston Celtics"
SELECT team_id FROM teams WHERE full_name = 'Boston Celtics';
-- Returns: 'BOS'
```

**Note:** You may need to use `provider_id_map` if Odds API uses different team names:
```sql
-- Check if we have a mapping
SELECT internal_id FROM provider_id_map 
WHERE entity_type = 'team' 
  AND provider = 'oddsapi' 
  AND provider_id = 'Los Angeles Lakers';
```

---

## Step 4: Map Event to Game ID

**Lookup:**
```sql
-- Find game_id by matching teams and start_time
SELECT game_id FROM games g
JOIN teams ht ON g.home_team_id = ht.team_id
JOIN teams at ON g.away_team_id = at.team_id
WHERE ht.abbreviation = 'LAL'
  AND at.abbreviation = 'BOS'
  AND g.start_time = '2025-01-15T19:00:00Z'::timestamptz;
-- Returns: 'bbref_202501151900_LAL_BOS'
```

**Alternative:** Use `bbref_schedule`:
```sql
SELECT canonical_game_id FROM bbref_schedule
WHERE home_team_abbr = 'LAL'
  AND away_team_abbr = 'BOS'
  AND game_date = '2025-01-15'::date;
```

---

## Step 5: Normalize and Insert into `markets`

### 5a. DraftKings Moneyline

**Home Team (Lakers):**
```sql
INSERT INTO markets (
  game_id, market_type, bookmaker, snapshot_type, side, line, odds, provider_id, fetched_at
) VALUES (
  'bbref_202501151900_LAL_BOS',
  'moneyline',  -- from market.key = 'h2h'
  'draftkings',  -- from bookmaker.key
  'pre_game',
  'home',  -- Lakers is home team
  NULL,  -- No line for moneyline
  -150,  -- from outcome.price
  'abc123def456',  -- from event.id
  '2025-01-15T10:30:00Z'::timestamptz
)
ON CONFLICT ON CONSTRAINT markets_unique_snapshot_idx
DO UPDATE SET
  odds = EXCLUDED.odds,
  updated_at = NOW();
```

**Away Team (Celtics):**
```sql
INSERT INTO markets (
  game_id, market_type, bookmaker, snapshot_type, side, line, odds, provider_id, fetched_at
) VALUES (
  'bbref_202501151900_LAL_BOS',
  'moneyline',
  'draftkings',
  'pre_game',
  'away',  -- Celtics is away team
  NULL,
  +130,
  'abc123def456',
  '2025-01-15T10:30:00Z'::timestamptz
)
ON CONFLICT ON CONSTRAINT markets_unique_snapshot_idx
DO UPDATE SET
  odds = EXCLUDED.odds,
  updated_at = NOW();
```

### 5b. DraftKings Spread

**Home Team Spread:**
```sql
INSERT INTO markets (
  game_id, market_type, bookmaker, snapshot_type, side, line, odds, provider_id, fetched_at
) VALUES (
  'bbref_202501151900_LAL_BOS',
  'spread',  -- from market.key = 'spreads'
  'draftkings',
  'pre_game',
  'home',
  -3.5,  -- from outcome.point
  -110,  -- from outcome.price
  'abc123def456',
  '2025-01-15T10:30:00Z'::timestamptz
)
ON CONFLICT ON CONSTRAINT markets_unique_snapshot_idx
DO UPDATE SET
  line = EXCLUDED.line,
  odds = EXCLUDED.odds,
  updated_at = NOW();
```

**Away Team Spread:**
```sql
INSERT INTO markets (
  game_id, market_type, bookmaker, snapshot_type, side, line, odds, provider_id, fetched_at
) VALUES (
  'bbref_202501151900_LAL_BOS',
  'spread',
  'draftkings',
  'pre_game',
  'away',
  +3.5,
  -110,
  'abc123def456',
  '2025-01-15T10:30:00Z'::timestamptz
)
ON CONFLICT ON CONSTRAINT markets_unique_snapshot_idx
DO UPDATE SET
  line = EXCLUDED.line,
  odds = EXCLUDED.odds,
  updated_at = NOW();
```

### 5c. DraftKings Total

**Over:**
```sql
INSERT INTO markets (
  game_id, market_type, bookmaker, snapshot_type, side, line, odds, provider_id, fetched_at
) VALUES (
  'bbref_202501151900_LAL_BOS',
  'total',  -- from market.key = 'totals'
  'draftkings',
  'pre_game',
  'over',  -- from outcome.name
  225.5,  -- from outcome.point
  -110,
  'abc123def456',
  '2025-01-15T10:30:00Z'::timestamptz
)
ON CONFLICT ON CONSTRAINT markets_unique_snapshot_idx
DO UPDATE SET
  line = EXCLUDED.line,
  odds = EXCLUDED.odds,
  updated_at = NOW();
```

**Under:**
```sql
INSERT INTO markets (
  game_id, market_type, bookmaker, snapshot_type, side, line, odds, provider_id, fetched_at
) VALUES (
  'bbref_202501151900_LAL_BOS',
  'total',
  'draftkings',
  'pre_game',
  'under',
  225.5,  -- same line for both over/under
  -110,
  'abc123def456',
  '2025-01-15T10:30:00Z'::timestamptz
)
ON CONFLICT ON CONSTRAINT markets_unique_snapshot_idx
DO UPDATE SET
  line = EXCLUDED.line,
  odds = EXCLUDED.odds,
  updated_at = NOW();
```

### 5d. FanDuel Moneyline (Different Bookmaker)

**Home Team:**
```sql
INSERT INTO markets (
  game_id, market_type, bookmaker, snapshot_type, side, line, odds, provider_id, fetched_at
) VALUES (
  'bbref_202501151900_LAL_BOS',
  'moneyline',
  'fanduel',  -- Different bookmaker
  'pre_game',
  'home',
  NULL,
  -145,  -- Different odds than DraftKings
  'abc123def456',
  '2025-01-15T10:30:00Z'::timestamptz
)
ON CONFLICT ON CONSTRAINT markets_unique_snapshot_idx
DO UPDATE SET
  odds = EXCLUDED.odds,
  updated_at = NOW();
```

**Away Team:**
```sql
INSERT INTO markets (
  game_id, market_type, bookmaker, snapshot_type, side, line, odds, provider_id, fetched_at
) VALUES (
  'bbref_202501151900_LAL_BOS',
  'moneyline',
  'fanduel',
  'pre_game',
  'away',
  NULL,
  +125,
  'abc123def456',
  '2025-01-15T10:30:00Z'::timestamptz
)
ON CONFLICT ON CONSTRAINT markets_unique_snapshot_idx
DO UPDATE SET
  odds = EXCLUDED.odds,
  updated_at = NOW();
```

---

## Step 6: Mark Staging Event as Processed

```sql
UPDATE staging_events
SET processed = true,
    processed_at = NOW()
WHERE id = <staging_event_id>;
```

---

## Result: Database State

After processing, the `markets` table contains:

| id | game_id | market_type | bookmaker | snapshot_type | side | line | odds | provider_id |
|----|---------|-------------|-----------|---------------|------|------|------|-------------|
| 1 | bbref_... | moneyline | draftkings | pre_game | home | NULL | -150 | abc123... |
| 2 | bbref_... | moneyline | draftkings | pre_game | away | NULL | +130 | abc123... |
| 3 | bbref... | spread | draftkings | pre_game | home | -3.5 | -110 | abc123... |
| 4 | bbref... | spread | draftkings | pre_game | away | +3.5 | -110 | abc123... |
| 5 | bbref... | total | draftkings | pre_game | over | 225.5 | -110 | abc123... |
| 6 | bbref... | total | draftkings | pre_game | under | 225.5 | -110 | abc123... |
| 7 | bbref... | moneyline | fanduel | pre_game | home | NULL | -145 | abc123... |
| 8 | bbref... | moneyline | fanduel | pre_game | away | NULL | +125 | abc123... |

**Total: 8 rows** from 1 API response (2 bookmakers × 3-4 outcomes each)

---

## Step 7: Query for UI

**Get all odds for a game:**
```sql
SELECT 
  market_type,
  bookmaker,
  side,
  line,
  odds
FROM markets
WHERE game_id = 'bbref_202501151900_LAL_BOS'
  AND snapshot_type = 'pre_game'
ORDER BY market_type, bookmaker, side;
```

**Result:**
```json
{
  "moneyline": {
    "draftkings": {
      "home": { "odds": -150 },
      "away": { "odds": +130 }
    },
    "fanduel": {
      "home": { "odds": -145 },
      "away": { "odds": +125 }
    }
  },
  "spread": {
    "draftkings": {
      "home": { "line": -3.5, "odds": -110 },
      "away": { "line": +3.5, "odds": -110 }
    }
  },
  "total": {
    "draftkings": {
      "over": { "line": 225.5, "odds": -110 },
      "under": { "line": 225.5, "odds": -110 }
    }
  }
}
```

---

## Key Takeaways

1. **One API response → Multiple database rows**
   - Each bookmaker × market × outcome = separate row
   - Example: 1 event × 2 books × 3 markets × 2 outcomes = 12 rows

2. **UPSERT pattern prevents duplicates**
   - Re-running the ETL won't create duplicate rows
   - Updates existing rows if odds change

3. **Staging table enables replay**
   - If processing fails, can re-process from `staging_events`
   - Raw payloads preserved for debugging

4. **Snapshot types track history**
   - `pre_game`: Initial odds
   - `closing`: Final odds before game
   - Compare to track line movement

---

_Last updated: 2025-01-15_

