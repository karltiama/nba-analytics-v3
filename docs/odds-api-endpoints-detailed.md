# Odds API Endpoints & SQL Schema Deep Dive

This document provides detailed information about the Odds API endpoints we'll use and how the SQL schemas are structured to store the data.

---

## Odds API Endpoints

### 1. **Get Odds for NBA Games** (Primary Endpoint)

**Endpoint:** `GET /v4/sports/basketball_nba/odds`

**Base URL:** `https://api.the-odds-api.com/v4/sports/basketball_nba/odds`

**Query Parameters:**
- `apiKey` (required): Your API key
- `regions` (optional): Comma-separated regions (default: `us`) - e.g., `us,uk,au`
- `markets` (optional): Comma-separated markets (default: `h2h,spreads,totals`) - e.g., `h2h,spreads,totals,player_points`
- `oddsFormat` (optional): `american` (default) or `decimal`
- `dateFormat` (optional): `iso` (default) or `unix`

**Example Request:**
```bash
curl "https://api.the-odds-api.com/v4/sports/basketball_nba/odds?apiKey=YOUR_KEY&regions=us&markets=h2h,spreads,totals&oddsFormat=american&dateFormat=iso"
```

**Response Structure:**
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
        "last_update": "2025-01-15T10:30:00Z",
        "markets": [
          {
            "key": "h2h",
            "last_update": "2025-01-15T10:30:00Z",
            "outcomes": [
              {
                "name": "Los Angeles Lakers",
                "price": -150
              },
              {
                "name": "Boston Celtics",
                "price": +130
              }
            ]
          },
          {
            "key": "spreads",
            "last_update": "2025-01-15T10:30:00Z",
            "outcomes": [
              {
                "name": "Los Angeles Lakers",
                "point": -3.5,
                "price": -110
              },
              {
                "name": "Boston Celtics",
                "point": +3.5,
                "price": -110
              }
            ]
          },
          {
            "key": "totals",
            "last_update": "2025-01-15T10:30:00Z",
            "outcomes": [
              {
                "name": "Over",
                "point": 225.5,
                "price": -110
              },
              {
                "name": "Under",
                "point": 225.5,
                "price": -110
              }
            ]
          }
        ]
      },
      {
        "key": "fanduel",
        "title": "FanDuel",
        "last_update": "2025-01-15T10:31:00Z",
        "markets": [
          {
            "key": "h2h",
            "outcomes": [
              {
                "name": "Los Angeles Lakers",
                "price": -145
              },
              {
                "name": "Boston Celtics",
                "price": +125
              }
            ]
          }
        ]
      }
    ]
  }
]
```

### 2. **Get Historical Odds** (For Backfilling)

**Endpoint:** `GET /v4/historical/sports/basketball_nba/events/{eventId}/odds`

**Use Case:** Fetch odds at a specific timestamp (e.g., closing odds)

**Example Request:**
```bash
curl "https://api.the-odds-api.com/v4/historical/sports/basketball_nba/events/abc123def456/odds?apiKey=YOUR_KEY&date=2025-01-15T18:55:00Z"
```

**Response:** Same structure as above, but represents odds at that specific timestamp.

### 3. **Get Player Props** (If Available)

**Endpoint:** `GET /v4/sports/basketball_nba/odds`

**Query Parameters:** Add `player_points`, `player_rebounds`, etc. to `markets` parameter

**Example Request:**
```bash
curl "https://api.the-odds-api.com/v4/sports/basketball_nba/odds?apiKey=YOUR_KEY&markets=player_points,player_rebounds,player_assists"
```

**Response Structure (Player Props):**
```json
{
  "bookmakers": [
    {
      "key": "draftkings",
      "markets": [
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
      ]
    }
  ]
}
```

---

## SQL Schema Deep Dive

### `staging_events` Table

**Purpose:** Store raw API responses before processing. Enables replay, debugging, and audit trails.

#### Field Breakdown

```sql
create table if not exists staging_events (
  id            bigserial primary key,  -- Auto-incrementing ID
  source        text not null,          -- 'oddsapi' | 'bdl' | 'nba'
  kind          text not null,          -- 'odds' | 'boxscore' | 'schedule'
  cursor        text,                   -- Date, game_id, or identifier for replay
  payload       jsonb not null,         -- Full raw API response
  fetched_at    timestamptz not null default now(),  -- When we fetched from API
  created_at    timestamptz not null default now(),  -- When row was inserted
  processed     boolean not null default false,      -- Has this been processed?
  processed_at  timestamptz,                        -- When processing completed
  error_message text                                 -- Error if processing failed
);
```

**Example Insert:**
```sql
INSERT INTO staging_events (source, kind, cursor, payload, fetched_at)
VALUES (
  'oddsapi',
  'odds',
  '2025-01-15',  -- Date cursor
  '{"id": "abc123", "sport_key": "basketball_nba", ...}'::jsonb,
  NOW()
);
```

**Why This Structure:**
- `source`: Track which API the data came from
- `kind`: Categorize the type of data (odds, boxscore, etc.)
- `cursor`: Enables replaying specific dates/games if processing fails
- `payload`: Full JSON response stored as-is for debugging
- `processed` flag: Track which events have been normalized into `markets`
- `error_message`: Log validation/processing errors without losing the raw data

#### Indexes Explained

```sql
-- Composite index for filtering by source and kind
create index staging_events_source_kind_idx on staging_events (source, kind);
-- Query: SELECT * FROM staging_events WHERE source = 'oddsapi' AND kind = 'odds'

-- Index for cursor-based replay
create index staging_events_cursor_idx on staging_events (cursor) where cursor is not null;
-- Query: SELECT * FROM staging_events WHERE cursor = '2025-01-15' AND processed = false

-- Index for time-based queries
create index staging_events_fetched_at_idx on staging_events (fetched_at);
-- Query: SELECT * FROM staging_events WHERE fetched_at > NOW() - INTERVAL '7 days'

-- Partial index for unprocessed events (smaller, faster)
create index staging_events_processed_idx on staging_events (processed, fetched_at) where not processed;
-- Query: SELECT * FROM staging_events WHERE processed = false ORDER BY fetched_at
```

---

### `markets` Table

**Purpose:** Store normalized, queryable odds data linked to games.

#### Field Breakdown

```sql
create table if not exists markets (
  -- Primary key
  id                bigserial primary key,
  
  -- Foreign key to games table
  game_id           text not null references games(game_id) on delete cascade,
  
  -- Market classification
  market_type       text not null,                    -- 'moneyline' | 'spread' | 'total' | 'player_prop'
  bookmaker         text not null,                    -- 'draftkings' | 'fanduel' | 'betmgm'
  snapshot_type     text not null default 'pre_game', -- 'pre_game' | 'closing' | 'live' | 'mid_game'
  
  -- Market details (varies by market_type)
  side              text,                             -- 'home' | 'away' | 'over' | 'under'
  line              numeric,                          -- Spread value, total points, or null for moneyline
  odds              integer not null,                 -- American odds (e.g., -110, +150)
  
  -- Player props (only for market_type = 'player_prop')
  player_id         text references players(player_id),
  stat_type         text,                             -- 'points' | 'rebounds' | 'assists'
  stat_line         numeric,                          -- Over/under line (e.g., 25.5 points)
  
  -- Metadata
  provider_id       text,                             -- Odds API event ID
  raw_data          jsonb,                            -- Full market object for debugging
  fetched_at        timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
```

#### Field-by-Field Explanation

**`id` (bigserial)**
- Auto-incrementing primary key
- Used for internal references and joins

**`game_id` (text, FK to games)**
- Links odds to a specific game
- Uses `on delete cascade` so if game is deleted, odds are too
- Example: `'bbref_202501151900_LAL_BOS'`

**`market_type` (text, NOT NULL)**
- Categorizes the type of bet
- Values: `'moneyline'`, `'spread'`, `'total'`, `'player_prop'`
- Maps from Odds API `market.key`:
  - `'h2h'` → `'moneyline'`
  - `'spreads'` → `'spread'`
  - `'totals'` → `'total'`
  - `'player_points'` → `'player_prop'`

**`bookmaker` (text, NOT NULL)**
- Which sportsbook the odds are from
- Maps from Odds API `bookmaker.key`:
  - `'draftkings'`, `'fanduel'`, `'betmgm'`, etc.

**`snapshot_type` (text, default 'pre_game')**
- When the odds were captured
- `'pre_game'`: Initial odds (daily snapshot)
- `'closing'`: Final odds before game starts
- `'live'`: Real-time during game (optional)
- `'mid_game'`: Halftime or key moments (optional)

**`side` (text, nullable)**
- Which side of the bet
- For moneyline/spread: `'home'` or `'away'`
- For totals/props: `'over'` or `'under'`
- Nullable because it's not needed for all market types

**`line` (numeric, nullable)**
- The betting line value
- For spreads: `-3.5`, `+3.5`
- For totals: `225.5`
- For moneyline: `NULL` (no line, just odds)
- For player props: stored in `stat_line` instead

**`odds` (integer, NOT NULL)**
- American odds format
- Examples: `-110`, `+150`, `-200`
- Always stored as integer (not decimal)

**`player_id` (text, FK to players, nullable)**
- Only used for `market_type = 'player_prop'`
- Links to `players.player_id`
- Example: `'lebron_james_123'`

**`stat_type` (text, nullable)**
- Only for player props
- Values: `'points'`, `'rebounds'`, `'assists'`, `'steals'`, etc.
- Maps from Odds API market key: `'player_points'` → `'points'`

**`stat_line` (numeric, nullable)**
- Only for player props
- The over/under line (e.g., `25.5` for points)
- Maps from Odds API `outcome.point`

**`provider_id` (text, nullable)**
- Odds API event ID for reference
- Example: `'abc123def456'`
- Useful for debugging and linking back to API

**`raw_data` (jsonb, nullable)**
- Full market object from API
- Stored for debugging/reference
- Can be queried with JSONB operators

**Timestamps:**
- `fetched_at`: When we got the data from API
- `created_at`: When row was inserted
- `updated_at`: Updated on UPSERT

#### Constraints Explained

```sql
-- Ensure market_type is one of the allowed values
constraint markets_market_type_check check (
  market_type in ('moneyline', 'spread', 'total', 'player_prop')
);

-- Ensure snapshot_type is valid
constraint markets_snapshot_type_check check (
  snapshot_type in ('pre_game', 'closing', 'live', 'mid_game')
);

-- Ensure side matches market_type
constraint markets_side_check check (
  (market_type in ('moneyline', 'spread') and side in ('home', 'away')) or
  (market_type = 'total' and side in ('over', 'under')) or
  (market_type = 'player_prop' and side in ('over', 'under')) or
  side is null
);
-- This ensures:
-- - Moneyline/spread must have 'home' or 'away'
-- - Totals/props must have 'over' or 'under'
-- - Or side can be null (for edge cases)

-- Ensure player props have required fields
constraint markets_player_prop_check check (
  (market_type = 'player_prop' and player_id is not null and stat_type is not null) or
  (market_type != 'player_prop' and player_id is null)
);
-- This ensures:
-- - If it's a player prop, player_id and stat_type must be set
-- - If it's NOT a player prop, player_id must be null
```

#### Indexes Explained

```sql
-- Fast lookup by game
create index markets_game_id_idx on markets (game_id);
-- Query: SELECT * FROM markets WHERE game_id = 'bbref_202501151900_LAL_BOS'

-- Composite index for common query pattern
create index markets_game_market_idx on markets (game_id, market_type, snapshot_type);
-- Query: SELECT * FROM markets 
--        WHERE game_id = '...' AND market_type = 'moneyline' AND snapshot_type = 'pre_game'

-- Partial index for player props (only indexes rows where market_type = 'player_prop')
create index markets_player_prop_idx on markets (player_id, stat_type, snapshot_type) 
  where market_type = 'player_prop';
-- Query: SELECT * FROM markets 
--        WHERE player_id = 'lebron_james_123' AND stat_type = 'points' AND market_type = 'player_prop'
-- Note: Partial indexes are smaller and faster since they only index relevant rows

-- Index for bookmaker queries
create index markets_bookmaker_idx on markets (bookmaker, fetched_at);
-- Query: SELECT * FROM markets WHERE bookmaker = 'draftkings' ORDER BY fetched_at DESC

-- Index for time-based queries
create index markets_fetched_at_idx on markets (fetched_at);
-- Query: SELECT * FROM markets WHERE fetched_at > NOW() - INTERVAL '24 hours'
```

#### Unique Constraint Explained

```sql
create unique index markets_unique_snapshot_idx on markets (
  game_id, 
  market_type, 
  bookmaker, 
  snapshot_type,
  coalesce(side, ''),
  coalesce(player_id, ''),
  coalesce(stat_type, '')
) where snapshot_type in ('pre_game', 'closing');
```

**Purpose:** Prevent duplicate pre-game/closing snapshots while allowing multiple live snapshots.

**How it works:**
- `coalesce(side, '')`: Converts NULL to empty string for unique constraint
- Only applies to `pre_game` and `closing` (partial index)
- Allows multiple `live` snapshots for line movement tracking

**Example:**
```sql
-- This will succeed (first insert)
INSERT INTO markets (game_id, market_type, bookmaker, snapshot_type, side, odds)
VALUES ('game1', 'moneyline', 'draftkings', 'pre_game', 'home', -150);

-- This will fail (duplicate)
INSERT INTO markets (game_id, market_type, bookmaker, snapshot_type, side, odds)
VALUES ('game1', 'moneyline', 'draftkings', 'pre_game', 'home', -145);
-- Error: duplicate key value violates unique constraint

-- This will succeed (different snapshot_type)
INSERT INTO markets (game_id, market_type, bookmaker, snapshot_type, side, odds)
VALUES ('game1', 'moneyline', 'draftkings', 'closing', 'home', -145);
```

---

## Data Mapping: API Response → SQL Schema

### Example: Moneyline Market

**API Response:**
```json
{
  "id": "abc123",
  "commence_time": "2025-01-15T19:00:00Z",
  "home_team": "Los Angeles Lakers",
  "away_team": "Boston Celtics",
  "bookmakers": [
    {
      "key": "draftkings",
      "markets": [
        {
          "key": "h2h",
          "outcomes": [
            {"name": "Los Angeles Lakers", "price": -150},
            {"name": "Boston Celtics", "price": +130}
          ]
        }
      ]
    }
  ]
}
```

**SQL Inserts:**
```sql
-- First, map game (assuming game_id = 'bbref_202501151900_LAL_BOS')
-- Home team moneyline
INSERT INTO markets (
  game_id, market_type, bookmaker, snapshot_type, side, odds, provider_id, raw_data, fetched_at
) VALUES (
  'bbref_202501151900_LAL_BOS',
  'moneyline',  -- from market.key = 'h2h'
  'draftkings',  -- from bookmaker.key
  'pre_game',
  'home',  -- determined by matching team name to game.home_team_id
  -150,  -- from outcome.price
  'abc123',  -- from event.id
  '{"key": "h2h", "outcomes": [...]}'::jsonb,  -- full market object
  NOW()
);

-- Away team moneyline
INSERT INTO markets (
  game_id, market_type, bookmaker, snapshot_type, side, odds, provider_id, raw_data, fetched_at
) VALUES (
  'bbref_202501151900_LAL_BOS',
  'moneyline',
  'draftkings',
  'pre_game',
  'away',  -- Boston Celtics is away team
  +130,
  'abc123',
  '{"key": "h2h", "outcomes": [...]}'::jsonb,
  NOW()
);
```

### Example: Spread Market

**API Response:**
```json
{
  "key": "spreads",
  "outcomes": [
    {"name": "Los Angeles Lakers", "point": -3.5, "price": -110},
    {"name": "Boston Celtics", "point": +3.5, "price": -110}
  ]
}
```

**SQL Inserts:**
```sql
-- Home team spread
INSERT INTO markets (
  game_id, market_type, bookmaker, snapshot_type, side, line, odds, provider_id
) VALUES (
  'bbref_202501151900_LAL_BOS',
  'spread',  -- from market.key = 'spreads'
  'draftkings',
  'pre_game',
  'home',
  -3.5,  -- from outcome.point
  -110,  -- from outcome.price
  'abc123'
);

-- Away team spread
INSERT INTO markets (
  game_id, market_type, bookmaker, snapshot_type, side, line, odds, provider_id
) VALUES (
  'bbref_202501151900_LAL_BOS',
  'spread',
  'draftkings',
  'pre_game',
  'away',
  +3.5,
  -110,
  'abc123'
);
```

### Example: Total (Over/Under)

**API Response:**
```json
{
  "key": "totals",
  "outcomes": [
    {"name": "Over", "point": 225.5, "price": -110},
    {"name": "Under", "point": 225.5, "price": -110}
  ]
}
```

**SQL Inserts:**
```sql
-- Over
INSERT INTO markets (
  game_id, market_type, bookmaker, snapshot_type, side, line, odds, provider_id
) VALUES (
  'bbref_202501151900_LAL_BOS',
  'total',  -- from market.key = 'totals'
  'draftkings',
  'pre_game',
  'over',  -- from outcome.name
  225.5,  -- from outcome.point
  -110,
  'abc123'
);

-- Under
INSERT INTO markets (
  game_id, market_type, bookmaker, snapshot_type, side, line, odds, provider_id
) VALUES (
  'bbref_202501151900_LAL_BOS',
  'total',
  'draftkings',
  'pre_game',
  'under',
  225.5,  -- same line for both over/under
  -110,
  'abc123'
);
```

### Example: Player Prop

**API Response:**
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

**SQL Inserts:**
```sql
-- Over prop (assuming player_id = 'lebron_james_123')
INSERT INTO markets (
  game_id, market_type, bookmaker, snapshot_type, side, player_id, stat_type, stat_line, odds, provider_id
) VALUES (
  'bbref_202501151900_LAL_BOS',
  'player_prop',  -- from market.key = 'player_points'
  'draftkings',
  'pre_game',
  'over',  -- from outcome.description
  'lebron_james_123',  -- resolved from outcome.name
  'points',  -- from market.key = 'player_points'
  25.5,  -- from outcome.point (stored in stat_line, not line)
  -110,
  'abc123'
);

-- Under prop
INSERT INTO markets (
  game_id, market_type, bookmaker, snapshot_type, side, player_id, stat_type, stat_line, odds, provider_id
) VALUES (
  'bbref_202501151900_LAL_BOS',
  'player_prop',
  'draftkings',
  'pre_game',
  'under',
  'lebron_james_123',
  'points',
  25.5,
  -110,
  'abc123'
);
```

---

## Common SQL Queries

### 1. Get Latest Pre-Game Odds for Today's Games

```sql
SELECT 
  g.game_id,
  g.start_time,
  ht.abbreviation as home_team,
  at.abbreviation as away_team,
  m.market_type,
  m.bookmaker,
  m.side,
  m.line,
  m.odds
FROM games g
JOIN teams ht ON g.home_team_id = ht.team_id
JOIN teams at ON g.away_team_id = at.team_id
JOIN markets m ON g.game_id = m.game_id
WHERE g.game_date = CURRENT_DATE
  AND m.snapshot_type = 'pre_game'
  AND m.market_type IN ('moneyline', 'spread', 'total')
ORDER BY g.start_time, m.market_type, m.bookmaker;
```

### 2. Compare Pre-Game vs Closing Odds (Line Movement)

```sql
SELECT 
  g.game_id,
  ht.abbreviation || ' vs ' || at.abbreviation as matchup,
  m_pre.market_type,
  m_pre.bookmaker,
  m_pre.side,
  m_pre.line as pre_game_line,
  m_pre.odds as pre_game_odds,
  m_closing.line as closing_line,
  m_closing.odds as closing_odds,
  -- Calculate line movement
  (m_closing.line - m_pre.line) as line_movement,
  (m_closing.odds - m_pre.odds) as odds_movement
FROM games g
JOIN teams ht ON g.home_team_id = ht.team_id
JOIN teams at ON g.away_team_id = at.team_id
JOIN markets m_pre ON g.game_id = m_pre.game_id 
  AND m_pre.snapshot_type = 'pre_game'
JOIN markets m_closing ON g.game_id = m_closing.game_id 
  AND m_closing.snapshot_type = 'closing'
  AND m_pre.market_type = m_closing.market_type
  AND m_pre.bookmaker = m_closing.bookmaker
  AND m_pre.side = m_closing.side
WHERE g.status = 'Final'
  AND m_pre.market_type = 'spread';  -- or 'total', 'moneyline'
```

### 3. Get Best Odds Across All Books

```sql
-- For moneyline (highest positive odds or lowest negative odds)
SELECT 
  g.game_id,
  m.side,
  m.bookmaker,
  m.odds,
  ROW_NUMBER() OVER (
    PARTITION BY g.game_id, m.side 
    ORDER BY 
      CASE WHEN m.odds > 0 THEN m.odds END DESC,
      CASE WHEN m.odds < 0 THEN m.odds END ASC
  ) as rank
FROM games g
JOIN markets m ON g.game_id = m.game_id
WHERE g.game_date = CURRENT_DATE
  AND m.market_type = 'moneyline'
  AND m.snapshot_type = 'pre_game'
QUALIFY rank = 1;  -- PostgreSQL 12+ syntax, or use CTE
```

### 4. Get Player Props for a Specific Game

```sql
SELECT 
  p.full_name,
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

### 5. UPSERT Pattern (Idempotent Insert)

```sql
-- Insert or update if exists (based on unique constraint)
INSERT INTO markets (
  game_id, market_type, bookmaker, snapshot_type, side, line, odds, provider_id, fetched_at
)
VALUES (
  'bbref_202501151900_LAL_BOS',
  'moneyline',
  'draftkings',
  'pre_game',
  'home',
  NULL,
  -150,
  'abc123',
  NOW()
)
ON CONFLICT ON CONSTRAINT markets_unique_snapshot_idx
DO UPDATE SET
  odds = EXCLUDED.odds,
  line = EXCLUDED.line,
  updated_at = NOW(),
  fetched_at = EXCLUDED.fetched_at;
```

---

## Summary

**API Endpoints:**
- Primary: `GET /v4/sports/basketball_nba/odds` (current odds)
- Historical: `GET /v4/historical/sports/basketball_nba/events/{eventId}/odds` (past odds)

**Storage Strategy:**
1. Store raw API response in `staging_events`
2. Validate with Zod
3. Normalize and insert into `markets` (one row per market/outcome/bookmaker)
4. Use UPSERT to handle re-runs idempotently

**Key Schema Features:**
- `staging_events`: Raw payloads for replay/debugging
- `markets`: Normalized, queryable odds with snapshot tracking
- Unique constraints prevent duplicate pre-game/closing snapshots
- Partial indexes optimize player prop queries
- Foreign keys ensure data integrity

---

_Last updated: 2025-01-15_

