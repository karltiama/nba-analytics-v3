# Data Filling Action Plan

## Immediate Actions (This Week)

### 1. Box Score Retry System ✅
**Status**: Script created, needs testing
- Run `retry-missing-boxscores.ts` daily
- Target: Games from 1-7 days ago
- Expected: Catch 80-90% of delayed box scores

### 2. Historical Backfill (Last 30 Days)
**New Script Needed**: `backfill-recent-boxscores.ts`
```typescript
// Pseudo-code
for (date = 30 days ago; date <= today; date++) {
  find Final games without box scores
  fetch box scores with retry logic
  store results
}
```

### 3. Data Completeness Dashboard
**New Page**: `/admin/data-completeness`
- Show % of games with box scores by date
- Highlight gaps visually
- Track trends over time

---

## Quick Wins (Next Week)

### 4. Multi-Source Box Score Fetching
**Idea**: Try multiple sources in order
```typescript
async function fetchBoxScoreWithFallback(gameId) {
  // Try NBA.com V3 first
  try {
    return await fetchNBAV3(gameId);
  } catch {
    // Fallback to BallDontLie if available
    return await fetchBallDontLie(gameId);
  }
}
```

### 5. Calculate Advanced Stats from Existing Data
**New Table**: `player_advanced_stats` (computed)
- PER (Player Efficiency Rating)
- True Shooting %
- Usage Rate
- Offensive/Defensive Rating (team level)

**Implementation**: SQL views or computed columns
```sql
CREATE VIEW player_advanced_stats AS
SELECT 
  player_id,
  game_id,
  -- PER calculation
  -- TS% calculation
  -- etc.
FROM player_game_stats
```

### 6. Historical Game Data Backfill
**Script**: `backfill-historical-games.ts`
- Fetch all games from current season start
- Use date range queries
- Batch process with rate limiting

---

## Medium-Term (Next 2 Weeks)

### 7. Player Profile Enrichment
**New Fields**: `players` table
- `photo_url` - Player headshot
- `bio` - Short biography
- `draft_year`, `draft_pick` - Draft information

**Sources**:
- NBA Stats `commonplayerinfo` endpoint
- Wikipedia API for bios
- NBA.com for photos

### 8. Team Statistics Aggregation
**New Table**: `team_season_stats` (computed daily)
- Offensive/Defensive ratings
- Pace
- Effective FG%
- Turnover rate
- Rebound rate

**Update Strategy**: Daily aggregation job

### 9. Missing Game Detection & Alerting
**New Script**: `detect-missing-games.ts`
- Compare expected games vs actual games
- Alert on missing games
- Auto-fetch missing games

---

## Data Source Integration Ideas

### Option A: BallDontLie API (Paid)
**Cost**: ~$50-100/month
**Pros**: 
- Faster box score availability
- Historical data
- Reliable API

**Cons**: 
- Cost
- Still has some delay

**Integration**: Add as fallback/secondary source

### Option B: Basketball Reference Scraping
**Cost**: Free
**Pros**: 
- Comprehensive historical data
- Advanced stats available
- No API limits

**Cons**: 
- Scraping complexity
- Legal/ToS considerations
- Maintenance burden

**Integration**: Use for historical backfill only

### Option C: Public Datasets
**Cost**: Free
**Sources**: 
- Kaggle NBA datasets
- GitHub community datasets
- Open data repositories

**Pros**: 
- Quick import
- Comprehensive
- No API limits

**Cons**: 
- May be outdated
- Data quality varies
- Need cleaning/validation

**Integration**: One-time historical import

---

## Implementation Priority Matrix

| Priority | Task | Effort | Impact | Timeline |
|----------|------|--------|--------|----------|
| 🔴 High | Retry script (daily) | Low | High | Done |
| 🔴 High | Historical backfill (30 days) | Medium | High | This week |
| 🟡 Medium | Advanced stats calculation | Medium | Medium | Next week |
| 🟡 Medium | Data completeness dashboard | Low | Medium | Next week |
| 🟢 Low | Player profile enrichment | High | Low | Later |
| 🟢 Low | Multi-source fetching | Medium | Low | Later |

---

## Specific Implementation Ideas

### Idea 1: Smart Retry with Exponential Backoff
```typescript
// Retry games multiple times with increasing delays
// Day 1: Try immediately
// Day 2: Retry if still missing
// Day 3: Final retry
// After Day 3: Mark as "unavailable" and move on
```

### Idea 2: Data Completeness Scoring
```typescript
// Score each game's data completeness
// 100% = game + box score + team stats
// 50% = game + scores only
// 0% = game only
// Track and report on completeness trends
```

### Idea 3: Batch Processing with Progress Tracking
```typescript
// Process games in batches
// Track progress in database
// Resume from last checkpoint if interrupted
// Email/Slack notifications on completion
```

### Idea 4: Data Validation Layer
```typescript
// Before storing, validate:
// - Box score totals match team scores
// - Player minutes don't exceed game time
// - Stats are within reasonable ranges
// - Flag anomalies for manual review
```

### Idea 5: Incremental Updates Only
```typescript
// Only fetch games that:
// - Are Final (have scores)
// - Don't have box scores yet
// - Are at least X hours old (to account for delay)
// - Haven't been tried in last Y hours
```

---

## Monitoring & Metrics

### Key Metrics to Track
1. **Box Score Completeness**: % of Final games with box scores
2. **Data Freshness**: Time since last successful fetch
3. **Retry Success Rate**: % of retries that succeed
4. **API Health**: Success rate, response times
5. **Data Quality**: Anomaly detection scores

### Dashboard Ideas
- **Completeness Chart**: Line chart showing % over time
- **Gap Visualization**: Calendar view highlighting missing dates
- **Source Performance**: Compare NBA.com vs alternatives
- **Alert Log**: Recent failures and retries

---

## Quick Script Ideas

### Script 1: `calculate-advanced-stats.ts`
- Calculate PER, TS%, Usage Rate from existing box scores
- Store in new `player_advanced_stats` table
- Run after box scores are fetched

### Script 2: `backfill-last-30-days.ts`
- One-time script to fill last 30 days of box scores
- Use retry logic
- Progress tracking

### Script 3: `data-quality-report.ts`
- Generate report on data completeness
- Identify gaps
- Suggest actions

### Script 4: `sync-missing-games.ts`
- Compare expected vs actual games
- Fetch missing games from schedule
- Handle edge cases (postponements, etc.)

---

## Questions to Answer

1. **What's the acceptable delay?** 
   - 24 hours? 48 hours? 
   - Should we mark games as "pending" if box scores aren't available?

2. **How far back should we backfill?**
   - Current season only?
   - Multiple seasons?
   - All available history?

3. **What's the budget for paid APIs?**
   - $0 (free only)
   - $50/month (one service)
   - $200+/month (multiple services)

4. **What data is most critical?**
   - Box scores (current priority)
   - Advanced stats
   - Historical data
   - Real-time updates

5. **How should we handle failures?**
   - Retry automatically?
   - Alert manually?
   - Mark as "unavailable"?

---

## Next Steps

1. ✅ **Review this document** - Prioritize ideas
2. ⏳ **Implement retry script** - Test and schedule
3. ⏳ **Create backfill script** - Fill last 30 days
4. ⏳ **Build completeness dashboard** - Visualize gaps
5. ⏳ **Decide on paid APIs** - Budget and integration

---

## Resources

- [NBA Stats API Documentation](https://github.com/swar/nba_api)
- [BallDontLie API Docs](https://www.balldontlie.io/)
- [Basketball Reference](https://www.basketball-reference.com/)
- [Kaggle NBA Datasets](https://www.kaggle.com/datasets?search=nba)


