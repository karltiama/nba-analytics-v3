# Odds Snapshot Schedule & Implementation

This document outlines the specific schedule and implementation details for capturing historical odds snapshots.

---

## Snapshot Schedule

### 1. **Pre-Game Snapshot**

**Schedule:** Daily at 09:05 ET

**EventBridge Rule:**
```json
{
  "ScheduleExpression": "cron(5 9 * * ? *)",
  "State": "ENABLED",
  "Description": "Daily pre-game odds snapshot at 09:05 ET"
}
```

**Lambda Function:** `odds-pre-game-snapshot`

**What it does:**
1. Gets today's scheduled games from `bbref_schedule`
2. Fetches odds from Odds API for all games
3. Stores raw payload in `staging_events`
4. Normalizes and upserts into `markets` with `snapshot_type='pre_game'`
5. Logs summary and errors

**Expected Duration:** ~2-5 minutes for 10-15 games

---

### 2. **Closing Line Snapshot**

**Schedule:** 5 minutes before each game's start time

**EventBridge Rule:** Dynamic (one per game)

**Implementation Options:**

#### Option A: Per-Game EventBridge Rules (Recommended)

**Lambda Function:** `odds-closing-snapshot`

**Trigger:** EventBridge rule created per game:
```json
{
  "ScheduleExpression": "cron(55 18 28 11 ? 2025)",
  "State": "ENABLED",
  "Description": "Closing odds for game 1842025112803 at 19:00 ET"
}
```

**What it does:**
1. Receives game_id from EventBridge event
2. Fetches latest odds from Odds API
3. Stores as `snapshot_type='closing'`
4. Updates existing pre-game odds if needed

**Pros:**
- Precise timing (exactly 5 min before)
- No wasted API calls
- Scales automatically

**Cons:**
- Need to create/delete rules dynamically
- More complex setup

#### Option B: Batch Approach (Simpler)

**Schedule:** Every 15 minutes during game hours (18:00-02:00 ET)

**Lambda Function:** `odds-closing-snapshot-batch`

**What it does:**
1. Query games starting in next 5-20 minutes
2. For each game without closing odds:
   - Fetch latest odds
   - Store as `snapshot_type='closing'`

**Pros:**
- Simpler implementation
- No dynamic rule management
- Handles schedule changes automatically

**Cons:**
- May miss exact 5-min-before timing
- Some wasted API calls

**Recommended:** Start with Option B, migrate to Option A if needed

---

## Lambda Function Implementation

### Pre-Game Snapshot Lambda

**File:** `lambda/odds-pre-game-snapshot/index.ts`

**Dependencies:**
- `pg` for database
- `axios` or `fetch` for Odds API
- `zod` for validation

**Environment Variables:**
- `SUPABASE_DB_URL`
- `ODDS_API_KEY`
- `ODDS_API_BASE_URL` (optional, defaults to https://api.the-odds-api.com/v4)

**Error Handling:**
- Continue processing if one game fails
- Log errors to CloudWatch
- Store failed games in `staging_events` with `error_message`
- Send SNS alert if >50% of games fail

**Idempotency:**
- Use UPSERT pattern
- Safe to re-run same day
- Won't create duplicates

---

### Closing Line Snapshot Lambda

**File:** `lambda/odds-closing-snapshot/index.ts`

**Input (EventBridge Event):**
```json
{
  "game_id": "1842025112803",
  "start_time": "2025-11-28T19:00:00Z",
  "home_team": "Atlanta Hawks",
  "away_team": "Cleveland Cavaliers"
}
```

**What it does:**
1. Fetch latest odds from Odds API
2. Match to game_id (same logic as test script)
3. Store as `snapshot_type='closing'`
4. Log success/failure

**Error Handling:**
- Retry once if API fails
- Log to CloudWatch
- Don't block if one game fails

---

## Data Quality Monitoring

### Daily Health Check

**Schedule:** Daily at 10:00 ET (after pre-game snapshot)

**Lambda Function:** `odds-data-quality-check`

**What it checks:**
1. % of games with pre-game odds
2. % of games with all 3 market types
3. Games missing closing odds from yesterday
4. Average markets per game
5. Bookmaker coverage

**Alerts:**
- SNS notification if <80% games have complete odds
- CloudWatch metric for tracking over time

---

## Best Practices for Snapshot Timing

### 1. **Pre-Game: Early is Better**

**Why:** Lines are most stable early in the day
- Less news/injury impact
- More time for analysis
- Consistent baseline

**Timing:** 09:00-09:30 ET (before most news breaks)

### 2. **Closing: As Close as Possible**

**Why:** Closing line is most accurate predictor
- Includes all available information
- Market consensus
- Industry standard for evaluation

**Timing:** 5 minutes before start (sweet spot)
- Not too early (line might move)
- Not too late (might miss if game starts early)

### 3. **Handle Edge Cases**

**Scenarios:**
- Game postponed: Skip closing snapshot, keep pre-game
- Game starts early: Try to capture closing if possible
- No odds available: Log and continue
- Partial markets: Store what's available

---

## Cost Optimization

### Odds API Usage

**Current Plan Limits:**
- Check your Odds API plan limits
- Typical: 500 requests/month (free) or unlimited (paid)

**Optimization:**
1. **Batch requests**: Fetch all games in one call (already doing this)
2. **Cache results**: Don't re-fetch if snapshot already exists
3. **Skip completed games**: Don't fetch odds for games that already started
4. **Rate limiting**: 1 request per second max

**Estimated Monthly Usage:**
- Pre-game: ~30 days × 1 request = 30 requests
- Closing: ~30 days × 10 games × 1 request = 300 requests
- **Total: ~330 requests/month** (within free tier)

---

## Monitoring & Alerts

### CloudWatch Metrics

**Track:**
- `OddsSnapshotsProcessed` - Count of snapshots stored
- `OddsSnapshotsFailed` - Count of failed snapshots
- `OddsDataCompleteness` - % of games with complete odds
- `OddsApiLatency` - Time to fetch from Odds API

### SNS Alerts

**Triggers:**
- >50% of games fail to process
- No snapshots processed in 24 hours
- Odds API returns errors for >3 consecutive requests

---

## Implementation Timeline

### Phase 1: Pre-Game Snapshot (Week 1)
- [ ] Create Lambda function
- [ ] Set up EventBridge schedule
- [ ] Test with today's games
- [ ] Monitor for 3 days
- [ ] Fix any issues

### Phase 2: Closing Line Snapshot (Week 2)
- [ ] Create Lambda function (batch approach)
- [ ] Set up EventBridge schedule (every 15 min)
- [ ] Test with today's games
- [ ] Verify closing odds captured
- [ ] Monitor for 3 days

### Phase 3: Data Quality (Week 3)
- [ ] Create monitoring Lambda
- [ ] Set up CloudWatch dashboards
- [ ] Configure SNS alerts
- [ ] Create data quality reports

### Phase 4: Historical Analysis (Week 4)
- [ ] Create CLV calculation script
- [ ] Create line movement queries
- [ ] Build historical analysis views
- [ ] Test with accumulated data

---

_Last updated: 2025-01-15_

