# Odds Storage Strategy

This document outlines the strategy for storing odds data from the Odds API to enable historical analysis and real-time betting insights.

---

## Architecture Overview

Following the established ETL pattern:
1. **Fetch** raw odds from Odds API
2. **Store** raw payload in `staging_events` (for replay/debugging)
3. **Validate** with Zod schemas
4. **Normalize** and **Upsert** into `markets` table
5. **UI** reads from `markets` only (never calls Odds API directly)

---

## Database Schema

### `staging_events`
- Stores raw API payloads with source, kind, cursor, and timestamp
- Enables replay of failed processing
- Supports debugging and audit trails
- Indexed by source, kind, cursor, and fetched_at

### `markets`
- Normalized odds data linked to games
- Supports multiple market types: moneyline, spread, total, player props
- Tracks snapshots: pre-game, closing, live, mid-game
- Stores bookmaker, odds, lines, and metadata
- Unique constraint prevents duplicate pre-game/closing snapshots
- Allows multiple live snapshots for line movement tracking

---

## Storage Strategy

### 1. **Snapshot Types**

We store odds at different points in time:

- **`pre_game`**: Initial odds when game is scheduled (snapshotted daily at 09:00 ET)
- **`closing`**: Final odds before game starts (snapshotted at game start time - 5 minutes)
- **`live`**: Real-time odds during game (optional, for line movement tracking)
- **`mid_game`**: Odds at halftime or other key moments (optional)

### 2. **Market Types**

#### Game-Level Markets
- **Moneyline**: Home/away win odds
- **Spread**: Point spread with odds
- **Total**: Over/under with odds

#### Player Props
- **Points**: Over/under player point totals
- **Rebounds**: Over/under rebound totals
- **Assists**: Over/under assist totals
- **Other**: Steals, blocks, threes, etc.

### 3. **Historical Tracking**

**Key Insight**: Store odds BEFORE you need them for historical analysis.

**Strategy**:
1. **Daily ETL (09:00 ET)**: Fetch and store pre-game odds for all scheduled games
2. **Pre-Game Snapshot (5 min before start)**: Store closing odds
3. **Post-Game Analysis**: Compare closing odds vs. actual results

This allows you to:
- Track line movement over time
- Calculate closing line value (CLV)
- Analyze bookmaker accuracy
- Build historical odds databases

---

## ETL Flow

### Daily Odds Ingestion (EventBridge → Lambda)

```typescript
// Pseudo-code flow
1. EventBridge triggers Lambda at 09:00 ET daily
2. Lambda fetches today's games from bbref_schedule
3. For each game:
   a. Fetch odds from Odds API
   b. Store raw payload in staging_events
   c. Validate with Zod schemas
   d. Normalize and upsert into markets (snapshot_type='pre_game')
4. Log errors but continue processing
5. Mark staging_events as processed
```

### Closing Odds Snapshot

```typescript
// Triggered 5 minutes before each game start
1. EventBridge triggers Lambda based on game start_time
2. Fetch latest odds from Odds API
3. Store as snapshot_type='closing'
4. Update existing pre_game odds if needed
```

---

## Data Normalization

### Odds API Response Structure

Odds API returns:
```json
{
  "sport_key": "basketball_nba",
  "sport_title": "NBA",
  "commence_time": "2025-01-15T19:00:00Z",
  "home_team": "Los Angeles Lakers",
  "away_team": "Boston Celtics",
  "bookmakers": [
    {
      "key": "draftkings",
      "title": "DraftKings",
      "markets": [
        {
          "key": "h2h",  // moneyline
          "outcomes": [
            { "name": "Los Angeles Lakers", "price": -150 },
            { "name": "Boston Celtics", "price": +130 }
          ]
        },
        {
          "key": "spreads",
          "outcomes": [
            { "name": "Los Angeles Lakers", "point": -3.5, "price": -110 },
            { "name": "Boston Celtics", "point": +3.5, "price": -110 }
          ]
        },
        {
          "key": "totals",
          "outcomes": [
            { "name": "Over", "point": 225.5, "price": -110 },
            { "name": "Under", "point": 225.5, "price": -110 }
          ]
        }
      ]
    }
  ]
}
```

### Normalization Steps

1. **Map Teams**: Use `provider_id_map` to match Odds API team names to internal `team_id`
2. **Map Games**: Match Odds API `commence_time` to `games.game_id` via `bbref_schedule`
3. **Extract Markets**: Parse bookmakers → markets → outcomes
4. **Store Each Market**: One row per market/outcome/bookmaker combination

### Zod Validation

```typescript
// Example schema
const OddsApiResponseSchema = z.object({
  sport_key: z.string(),
  commence_time: z.string().datetime(),
  home_team: z.string(),
  away_team: z.string(),
  bookmakers: z.array(BookmakerSchema),
});

const BookmakerSchema = z.object({
  key: z.string(),
  title: z.string(),
  markets: z.array(MarketSchema),
});

const MarketSchema = z.object({
  key: z.enum(['h2h', 'spreads', 'totals', 'player_points', ...]),
  outcomes: z.array(OutcomeSchema),
});
```

---

## Querying Strategy

### For UI (Betting Dashboard)

```sql
-- Get latest pre-game odds for today's games
SELECT 
  m.game_id,
  m.market_type,
  m.bookmaker,
  m.side,
  m.line,
  m.odds
FROM markets m
JOIN games g ON m.game_id = g.game_id
WHERE g.game_date = CURRENT_DATE
  AND m.snapshot_type = 'pre_game'
  AND m.market_type IN ('moneyline', 'spread', 'total')
ORDER BY m.game_id, m.market_type, m.bookmaker;
```

### For Historical Analysis

```sql
-- Compare pre-game vs closing odds (line movement)
SELECT 
  g.game_id,
  m_pre.market_type,
  m_pre.line as pre_game_line,
  m_closing.line as closing_line,
  m_pre.odds as pre_game_odds,
  m_closing.odds as closing_odds
FROM games g
JOIN markets m_pre ON g.game_id = m_pre.game_id AND m_pre.snapshot_type = 'pre_game'
JOIN markets m_closing ON g.game_id = m_closing.game_id 
  AND m_closing.snapshot_type = 'closing'
  AND m_pre.market_type = m_closing.market_type
  AND m_pre.bookmaker = m_closing.bookmaker
WHERE g.status = 'Final';
```

---

## Best Practices

### ✅ Do

1. **Store raw payloads first** in `staging_events` before processing
2. **Use idempotent UPSERTs** so re-runs don't duplicate data
3. **Validate with Zod** and log failures without crashing
4. **Store multiple snapshots** (pre-game, closing) for historical analysis
5. **Index hot queries** (game_id, market_type, snapshot_type)
6. **Rate limit API calls** (1 req/sec recommended)
7. **Handle missing games gracefully** (odds may not exist for all games)

### ❌ Don't

1. **Don't call Odds API from UI** - always read from `markets` table
2. **Don't compute odds in UI** - precompute and store
3. **Don't overwrite historical snapshots** - use snapshot_type to track time
4. **Don't skip validation** - always validate with Zod before insert
5. **Don't store odds without game mapping** - ensure game_id exists first

---

## Implementation Checklist

- [ ] Create `staging_events` table
- [ ] Create `markets` table
- [ ] Create Zod schemas for Odds API validation
- [ ] Create Lambda function for daily odds ingestion
- [ ] Set up EventBridge schedule (09:00 ET daily)
- [ ] Create closing odds snapshot Lambda (triggered by game start)
- [ ] Update `provider_id_map` with Odds API team mappings
- [ ] Update betting API routes to read from `markets` table
- [ ] Test with a single game, then scale to all games
- [ ] Monitor CloudWatch logs for errors

---

## Next Steps

1. **Start with pre-game odds only** (simplest)
2. **Add closing odds** once pre-game works
3. **Add player props** after game-level markets are stable
4. **Consider live odds** only if needed for real-time features

---

_Last updated: 2025-01-15_

