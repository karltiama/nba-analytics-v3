# BBRef Aggregation Strategy

## Current Situation
- `bbref_team_game_stats` stores individual game stats (one row per team per game)
- Currently calculating season aggregates on-the-fly via SQL queries
- Only 1 game exists for Detroit, so aggregation is working but limited data

## Best Practice Options

### Option 1: Calculate On-The-Fly (Current Approach)
**Pros:**
- Simple, no maintenance needed
- Always up-to-date
- No additional storage

**Cons:**
- Slower for large datasets
- Recalculates every time

**Use Case:** MVP, small datasets, when real-time accuracy is critical

### Option 2: Materialized View (Recommended)
**Pros:**
- Fast queries (pre-calculated)
- Can refresh on schedule or trigger
- No duplicate data storage

**Cons:**
- Needs refresh mechanism
- Slightly more complex setup

**Use Case:** Production, when performance matters, multiple queries

### Option 3: Aggregated Table
**Pros:**
- Fastest queries
- Can store historical seasons
- Easy to query

**Cons:**
- Duplicate data
- Needs ETL to maintain
- Can get out of sync

**Use Case:** When you need historical tracking, complex aggregations

## Recommendation: Materialized View

Create a materialized view that aggregates from `bbref_team_game_stats`:

```sql
CREATE MATERIALIZED VIEW bbref_team_season_stats AS
SELECT 
  team_id,
  COUNT(DISTINCT game_id) as games_played,
  AVG(points) as avg_points,
  SUM(points) as total_points,
  -- ... all other aggregates
FROM bbref_team_game_stats btgs
JOIN games g ON btgs.game_id = g.game_id
WHERE g.status = 'Final'
GROUP BY team_id;

-- Refresh when new games are added
REFRESH MATERIALIZED VIEW bbref_team_season_stats;
```

**Refresh Strategy:**
- After ETL runs (when new games added)
- On a schedule (daily/hourly)
- Via trigger (when new rows inserted)


