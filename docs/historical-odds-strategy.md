# Historical Odds Strategy & Best Practices

This document outlines strategies for building a comprehensive historical odds database and best practices for data collection, storage, and analysis.

---

## Overview

Since we're not getting live odds, we'll build historical odds through strategic snapshots at key moments. This enables:
- **Line movement analysis**: Track how odds change over time
- **Closing line value (CLV)**: Compare closing odds vs. actual results
- **Bookmaker accuracy**: Analyze which books are most accurate
- **Market efficiency**: Study how quickly markets adjust
- **Historical trends**: Identify patterns in odds movements

---

## Snapshot Strategy

### 1. **Pre-Game Snapshot (Initial Line)**

**When:** Daily at 09:00 ET (or when odds first become available)

**Purpose:** Capture the opening line for each game

**Implementation:**
- Run ETL daily at 09:00 ET via EventBridge
- Fetch odds for all scheduled games
- Store as `snapshot_type = 'pre_game'`

**Value:**
- Baseline for line movement analysis
- Compare opening vs. closing lines
- Track how early markets differ from closing markets

### 2. **Closing Line Snapshot (Final Pre-Game)**

**When:** 5 minutes before game start time

**Purpose:** Capture the final odds before the game begins

**Implementation:**
- EventBridge triggers Lambda 5 minutes before each game's `start_time`
- Fetch latest odds from Odds API
- Store as `snapshot_type = 'closing'`

**Value:**
- **Most important snapshot** - represents market consensus
- Used for CLV (Closing Line Value) calculations
- Best predictor of actual outcomes
- Industry standard for evaluating bet quality

### 3. **Mid-Day Snapshot (Optional)**

**When:** 12:00 PM ET (noon)

**Purpose:** Track line movement during the day

**Implementation:**
- Optional snapshot to track movement
- Store as `snapshot_type = 'mid_day'` or use `live` type

**Value:**
- See how lines move during the day
- Identify sharp money vs. public money patterns
- Track injury/news impact on lines

### 4. **Post-Game Analysis Snapshot**

**When:** After game completion

**Purpose:** Store final scores and calculate CLV

**Implementation:**
- Not a new odds fetch, but a calculation step
- Compare closing odds vs. actual results
- Calculate CLV for each market

**Value:**
- Measure bet quality (CLV)
- Analyze bookmaker accuracy
- Build historical performance database

---

## Data Collection Best Practices

### 1. **Consistency is Key**

**Rule:** Always use the same bookmaker for historical comparisons

**Implementation:**
- Default to DraftKings for all snapshots
- Store bookmaker in `bookmaker` field
- Allow fallback to other books if DraftKings unavailable

**Why:**
- Different books have different lines
- Mixing books creates noise in historical analysis
- Consistent bookmaker = cleaner data

### 2. **Capture All Market Types**

**Markets to Store:**
- Moneyline (home/away)
- Spread (home/away)
- Total (over/under)
- Player props (if available)

**Implementation:**
- Store all markets in same snapshot
- Use same `fetched_at` timestamp for all markets in a snapshot
- Ensures all markets are from the same moment in time

### 3. **Handle Missing Data Gracefully**

**Scenarios:**
- Game doesn't have odds yet
- Bookmaker doesn't offer a market
- Odds API returns partial data

**Best Practices:**
- Don't skip the snapshot - store what you have
- Log missing markets for debugging
- Use NULL values (not zeros) for missing odds
- Track data completeness percentage

### 4. **Idempotent Snapshots**

**Rule:** Re-running a snapshot shouldn't create duplicates

**Implementation:**
- Use unique constraint on `(game_id, market_type, bookmaker, snapshot_type, side)`
- UPSERT pattern for pre-game/closing snapshots
- Allow multiple live snapshots for movement tracking

**Why:**
- Safe to re-run failed jobs
- No duplicate data
- Clean historical record

---

## Historical Analysis Use Cases

### 1. **Closing Line Value (CLV)**

**Definition:** The difference between the odds you bet at vs. closing odds

**Calculation:**
```
CLV = (Closing Odds - Your Odds) / |Your Odds|
```

**Example:**
- You bet Lakers -3.5 at -110
- Closing line: Lakers -4.5 at -110
- CLV = Positive (you got better odds)

**Storage:**
- Store CLV in a separate table or calculated field
- Track CLV over time to measure bet quality

### 2. **Line Movement Analysis**

**Track:**
- How much lines move from opening to closing
- Direction of movement (favorite getting more/less favored)
- Speed of movement (when did the line move?)

**Query Example:**
```sql
SELECT 
  g.game_id,
  m_pre.line as opening_line,
  m_closing.line as closing_line,
  (m_closing.line - m_pre.line) as line_movement,
  m_pre.odds as opening_odds,
  m_closing.odds as closing_odds
FROM games g
JOIN markets m_pre ON g.game_id = m_pre.game_id 
  AND m_pre.snapshot_type = 'pre_game'
JOIN markets m_closing ON g.game_id = m_closing.game_id 
  AND m_closing.snapshot_type = 'closing'
WHERE m_pre.market_type = 'spread'
  AND m_pre.bookmaker = 'draftkings'
  AND m_closing.bookmaker = 'draftkings'
```

### 3. **Bookmaker Accuracy**

**Measure:**
- How often closing line matches actual result
- Which bookmaker's closing lines are most accurate
- Market efficiency over time

**Metrics:**
- Hit rate: % of games where closing favorite won
- Spread accuracy: Average difference between closing spread and actual margin
- Total accuracy: Average difference between closing total and actual total

### 4. **Sharp vs. Public Money**

**Indicators:**
- Line moves against public betting (sharp money)
- Line moves with public betting (public money)
- Reverse line movement (RLM) - line moves opposite of public

**Analysis:**
- Track line movement direction
- Compare to public betting percentages (if available)
- Identify sharp betting patterns

---

## Implementation Recommendations

### 1. **Daily Pre-Game Snapshot**

**Schedule:** EventBridge cron: `cron(5 9 * * ? *)` (09:05 ET daily)

**Lambda Function:**
```typescript
// Pseudo-code
1. Get today's scheduled games from bbref_schedule
2. For each game:
   a. Fetch odds from Odds API
   b. Store in staging_events
   c. Normalize and upsert into markets (snapshot_type='pre_game')
3. Log summary (games processed, markets stored, errors)
```

### 2. **Closing Line Snapshot**

**Schedule:** EventBridge rule per game (triggered 5 min before start_time)

**Lambda Function:**
```typescript
// Pseudo-code
1. Receive game_id and start_time from EventBridge
2. Fetch latest odds from Odds API
3. Store as snapshot_type='closing'
4. Update existing pre_game odds if needed
```

**Alternative:** Batch approach - run every 15 minutes, check for games starting in next 5 minutes

### 3. **Data Quality Monitoring**

**Track:**
- % of games with complete odds (all 3 market types)
- % of games with closing odds captured
- Average time between pre-game and closing snapshots
- Missing data alerts

**Query:**
```sql
-- Games missing closing odds
SELECT 
  g.game_id,
  g.start_time,
  COUNT(DISTINCT m.market_type) FILTER (WHERE m.snapshot_type = 'pre_game') as pre_game_markets,
  COUNT(DISTINCT m.market_type) FILTER (WHERE m.snapshot_type = 'closing') as closing_markets
FROM games g
LEFT JOIN markets m ON g.game_id = m.game_id
WHERE g.start_time < NOW()
  AND g.start_time > NOW() - INTERVAL '7 days'
GROUP BY g.game_id, g.start_time
HAVING COUNT(DISTINCT m.market_type) FILTER (WHERE m.snapshot_type = 'closing') < 3
```

### 4. **Historical Aggregation Tables**

**Create Materialized Views:**
- `odds_line_movement`: Pre-game vs. closing comparisons
- `odds_clv_analysis`: CLV calculations per game
- `bookmaker_accuracy`: Accuracy metrics per bookmaker

**Refresh:** Daily after games complete

---

## Best Practices Summary

### ✅ Do

1. **Capture closing odds** - Most important snapshot
2. **Use consistent bookmaker** - DraftKings default, fallback if needed
3. **Store all market types** - Moneyline, spread, total
4. **Track timestamps** - `fetched_at` for all markets in snapshot
5. **Handle missing data** - Use NULL, don't skip snapshots
6. **Idempotent operations** - Safe to re-run
7. **Monitor data quality** - Track completeness, alert on issues
8. **Calculate CLV** - Store post-game analysis
9. **Index for queries** - Fast lookups by game_id, snapshot_type, fetched_at
10. **Log everything** - Staging events for debugging

### ❌ Don't

1. **Don't mix bookmakers** - Inconsistent historical data
2. **Don't skip closing odds** - Most valuable snapshot
3. **Don't use zeros for missing data** - Use NULL
4. **Don't overwrite historical snapshots** - Use snapshot_type
5. **Don't calculate in UI** - Precompute and store
6. **Don't ignore data quality** - Monitor and fix issues
7. **Don't store live odds** - Not needed for historical analysis
8. **Don't duplicate snapshots** - Use unique constraints

---

## Data Schema Enhancements

### Optional: Add CLV Table

```sql
create table if not exists odds_clv_analysis (
  id                bigserial primary key,
  game_id           text not null references games(game_id),
  market_type       text not null,
  bookmaker         text not null,
  pre_game_line     numeric,
  pre_game_odds     integer,
  closing_line      numeric,
  closing_odds      integer,
  actual_result     numeric, -- Actual spread, total, or win/loss
  clv               numeric, -- Closing Line Value
  hit               boolean, -- Did the bet hit?
  created_at        timestamptz not null default now()
);
```

### Optional: Add Line Movement Table

```sql
create table if not exists odds_line_movement (
  id                bigserial primary key,
  game_id           text not null references games(game_id),
  market_type       text not null,
  bookmaker         text not null,
  opening_line      numeric,
  closing_line      numeric,
  movement_amount   numeric, -- closing - opening
  movement_direction text, -- 'toward_favorite' | 'toward_underdog' | 'none'
  hours_before_game numeric, -- Time between snapshots
  created_at        timestamptz not null default now()
);
```

---

## Query Examples

### Get Line Movement for Recent Games

```sql
SELECT 
  g.game_id,
  ht.abbreviation || ' vs ' || at.abbreviation as matchup,
  m_pre.line as opening_spread,
  m_closing.line as closing_spread,
  (m_closing.line - m_pre.line) as movement,
  CASE 
    WHEN m_closing.line > m_pre.line THEN 'toward_underdog'
    WHEN m_closing.line < m_pre.line THEN 'toward_favorite'
    ELSE 'no_movement'
  END as direction
FROM games g
JOIN teams ht ON g.home_team_id = ht.team_id
JOIN teams at ON g.away_team_id = at.team_id
JOIN markets m_pre ON g.game_id = m_pre.game_id 
  AND m_pre.snapshot_type = 'pre_game'
  AND m_pre.market_type = 'spread'
  AND m_pre.side = 'home'
JOIN markets m_closing ON g.game_id = m_closing.game_id 
  AND m_closing.snapshot_type = 'closing'
  AND m_closing.market_type = 'spread'
  AND m_closing.side = 'home'
WHERE m_pre.bookmaker = 'draftkings'
  AND m_closing.bookmaker = 'draftkings'
  AND g.status = 'Final'
ORDER BY g.start_time DESC
LIMIT 20;
```

### Calculate CLV for Spread Bets

```sql
SELECT 
  g.game_id,
  m_closing.line as closing_spread,
  m_closing.odds as closing_odds,
  (g.home_score - g.away_score) as actual_margin,
  CASE 
    WHEN m_closing.side = 'home' THEN
      (g.home_score - g.away_score) >= m_closing.line
    ELSE
      (g.away_score - g.home_score) >= ABS(m_closing.line)
  END as bet_hit,
  -- CLV calculation (simplified)
  CASE 
    WHEN m_closing.side = 'home' AND (g.home_score - g.away_score) >= m_closing.line THEN
      (m_closing.odds - (-110)) / 110.0
    ELSE 0
  END as clv
FROM games g
JOIN markets m_closing ON g.game_id = m_closing.game_id 
  AND m_closing.snapshot_type = 'closing'
  AND m_closing.market_type = 'spread'
WHERE g.status = 'Final'
  AND m_closing.bookmaker = 'draftkings'
ORDER BY g.start_time DESC;
```

---

## Implementation Checklist

- [ ] Set up daily pre-game snapshot (09:05 ET)
- [ ] Set up closing line snapshot (5 min before game start)
- [ ] Add data quality monitoring queries
- [ ] Create CLV calculation script (post-game)
- [ ] Create line movement analysis queries
- [ ] Add bookmaker accuracy tracking
- [ ] Set up alerts for missing closing odds
- [ ] Document snapshot schedule and triggers
- [ ] Test with historical data
- [ ] Create dashboard for odds data quality

---

## Future Enhancements

1. **Player Prop Historical Data**: Track player prop lines over time
2. **Multi-Book Comparison**: Compare odds across all bookmakers
3. **Sharp Money Indicators**: Identify reverse line movement patterns
4. **Market Efficiency Metrics**: Measure how quickly markets adjust
5. **Historical Betting Simulation**: Backtest strategies using historical odds
6. **Odds API Rate Optimization**: Cache and batch requests efficiently

---

_Last updated: 2025-01-15_

