# Team Stats API Performance Optimizations

## Current Issues

1. **5+ sequential queries** per request
2. **Rankings query calculates ALL teams** just to rank one team
3. **Table existence check** on every request
4. **No caching** of computed values

## Optimization Options

### Option 1: Single Query with CTEs (Quick Win)
Combine all queries into one SQL statement using CTEs. Reduces round trips from 5+ to 1.

### Option 2: Precomputed Season Stats Table (Best for Scale)
Create `team_season_stats` table updated by ETL:
- Updated after each game completes
- Contains all season aggregates
- Rankings precomputed
- Single fast SELECT per request

### Option 3: Materialized Views (PostgreSQL Feature)
Use PostgreSQL materialized views for complex aggregations:
- Refreshed periodically (e.g., every 5 minutes)
- Fast reads, slower writes
- Good middle ground

## Recommended Approach

**For MVP:** Option 1 (single query)
**For Production:** Option 2 (precomputed table)

