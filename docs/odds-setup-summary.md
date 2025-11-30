# Odds Setup Summary: Quick Reference

## ✅ What's Been Set Up

### 1. Lambda Function: `odds-pre-game-snapshot`
- **Location:** `lambda/odds-pre-game-snapshot/`
- **Purpose:** Fetch team + player odds daily
- **Features:**
  - Team odds: Moneyline, Spread, Total
  - Player props: Points, Rebounds, Assists
  - Single API call per day (efficient)
  - Automatic player name resolution
  - Date filtering (only today's games)

### 2. Database Schema
- **`staging_events`**: Raw API payloads
- **`markets`**: Normalized odds data
- Supports: Team markets + Player props

### 3. EventBridge (To Be Set Up)
- **Rule:** `odds-pre-game-snapshot-daily`
- **Schedule:** Daily at 09:05 ET
- **Target:** Lambda function

---

## 📋 Next Steps Checklist

### Immediate (Before First Run)

- [ ] **Test Lambda locally**
  ```bash
  cd lambda/odds-pre-game-snapshot
  npm run build
  npx tsx index.ts
  ```

- [ ] **Package and deploy Lambda**
  ```bash
  # Windows PowerShell
  cd lambda/odds-pre-game-snapshot
  npm run build
  Compress-Archive -Path dist,node_modules,package.json -DestinationPath function.zip -Force
  ```
  Then upload `function.zip` to AWS Lambda Console

- [ ] **Verify environment variables in Lambda:**
  - `SUPABASE_DB_URL` ✅
  - `ODDS_API_KEY` ✅
  - `ODDS_API_BASE` (optional)
  - `PREFERRED_BOOKMAKER` (optional, defaults to 'draftkings')

- [ ] **Set up EventBridge rule**
  - Follow: `docs/eventbridge-setup-guide.md`
  - Rule name: `odds-pre-game-snapshot-daily`
  - Cron: `cron(5 14 * * ? *)` (09:05 ET daily)
  - Target: `odds-pre-game-snapshot` Lambda

### After First Run

- [ ] **Monitor CloudWatch logs**
  - Log group: `/aws/lambda/odds-pre-game-snapshot`
  - Check for errors or warnings

- [ ] **Verify data in Supabase**
  ```sql
  -- Check recent markets
  SELECT COUNT(*), market_type, snapshot_type
  FROM markets
  WHERE fetched_at > NOW() - INTERVAL '1 day'
  GROUP BY market_type, snapshot_type;
  
  -- Check player props
  SELECT COUNT(*), stat_type
  FROM markets
  WHERE market_type = 'player_prop'
    AND fetched_at > NOW() - INTERVAL '1 day'
  GROUP BY stat_type;
  ```

- [ ] **Check Odds API credit usage**
  - Log into Odds API dashboard
  - Verify credits used per call
  - Should be ~3-5 credits per call

---

## 📊 Credit Usage Estimate

| Item | Calls/Month | Credits/Call | Total Credits |
|------|-------------|--------------|---------------|
| Pre-game snapshot | 30 | 3-5 | 90-150 |
| **Total** | **30** | **3-5** | **90-150** |
| **Remaining Quota** | | | **350-410** |

**Status:** ✅ Well within 500 credit quota!

---

## 🔍 Monitoring Queries

### Check Recent Odds Data

```sql
-- Summary of recent markets
SELECT 
  DATE(fetched_at) as date,
  COUNT(*) as total_markets,
  COUNT(DISTINCT game_id) as games,
  COUNT(DISTINCT CASE WHEN market_type = 'player_prop' THEN player_id END) as players_with_props
FROM markets
WHERE fetched_at > NOW() - INTERVAL '7 days'
GROUP BY DATE(fetched_at)
ORDER BY date DESC;
```

### Check Player Props Coverage

```sql
-- Games with player props
SELECT 
  g.game_id,
  g.start_time,
  ht.abbreviation || ' vs ' || at.abbreviation as matchup,
  COUNT(DISTINCT m.player_id) as players_with_props,
  COUNT(DISTINCT m.stat_type) as stat_types
FROM games g
JOIN teams ht ON g.home_team_id = ht.team_id
JOIN teams at ON g.away_team_id = at.team_id
LEFT JOIN markets m ON g.game_id = m.game_id 
  AND m.market_type = 'player_prop'
  AND m.snapshot_type = 'pre_game'
WHERE g.game_date = CURRENT_DATE
GROUP BY g.game_id, g.start_time, ht.abbreviation, at.abbreviation
ORDER BY g.start_time;
```

### Check Data Quality

```sql
-- Games missing odds
SELECT 
  g.game_id,
  g.start_time,
  ht.abbreviation || ' vs ' || at.abbreviation as matchup,
  COUNT(DISTINCT CASE WHEN m.market_type = 'moneyline' THEN m.id END) as has_moneyline,
  COUNT(DISTINCT CASE WHEN m.market_type = 'spread' THEN m.id END) as has_spread,
  COUNT(DISTINCT CASE WHEN m.market_type = 'total' THEN m.id END) as has_total,
  COUNT(DISTINCT CASE WHEN m.market_type = 'player_prop' THEN m.id END) as has_player_props
FROM games g
JOIN teams ht ON g.home_team_id = ht.team_id
JOIN teams at ON g.away_team_id = at.team_id
LEFT JOIN markets m ON g.game_id = m.game_id 
  AND m.snapshot_type = 'pre_game'
WHERE g.game_date = CURRENT_DATE
GROUP BY g.game_id, g.start_time, ht.abbreviation, at.abbreviation
HAVING COUNT(DISTINCT CASE WHEN m.market_type = 'moneyline' THEN m.id END) = 0
   OR COUNT(DISTINCT CASE WHEN m.market_type = 'spread' THEN m.id END) = 0
   OR COUNT(DISTINCT CASE WHEN m.market_type = 'total' THEN m.id END) = 0
ORDER BY g.start_time;
```

---

## 🐛 Troubleshooting

### Lambda Function Not Running

1. **Check EventBridge rule:**
   - Is rule enabled?
   - Is cron expression correct?
   - Is target Lambda function correct?

2. **Check Lambda permissions:**
   - Does EventBridge have permission to invoke Lambda?
   - Check Lambda resource policy

3. **Check CloudWatch logs:**
   - Look for error messages
   - Check execution duration
   - Verify environment variables are set

### No Data in Database

1. **Check Lambda logs:**
   - Did it fetch events from API?
   - Did it filter to today's games?
   - Any errors during processing?

2. **Check Odds API:**
   - Are there games scheduled for today?
   - Does Odds API return data for those games?
   - Check API response in `staging_events` table

3. **Check player resolution:**
   - Are player names matching?
   - Check logs for warnings about unresolved players
   - Verify `players` table has the players

### Player Props Not Appearing

1. **Check API response:**
   ```sql
   SELECT payload->'bookmakers'->0->'markets'
   FROM staging_events
   WHERE source = 'oddsapi'
     AND kind = 'odds'
     AND fetched_at > NOW() - INTERVAL '1 day'
   LIMIT 1;
   ```
   - Do markets include `player_points`, `player_rebounds`, `player_assists`?

2. **Check player resolution:**
   - Look for warnings in CloudWatch logs
   - Verify player names in Odds API match database
   - Check `resolvePlayerId` function is working

3. **Check database:**
   ```sql
   SELECT COUNT(*), stat_type
   FROM markets
   WHERE market_type = 'player_prop'
     AND fetched_at > NOW() - INTERVAL '1 day'
   GROUP BY stat_type;
   ```

---

## 📚 Documentation References

- **Lambda Deployment:** `docs/lambda-deployment-guide.md`
- **EventBridge Setup:** `docs/eventbridge-setup-guide.md`
- **IAM Role Setup:** `docs/iam-role-gui-guide.md`
- **Lambda Creation:** `docs/lambda-creation-gui-guide.md`
- **Credit Analysis:** `docs/odds-api-credit-analysis.md`
- **Snapshot Strategy:** `docs/odds-snapshot-strategy-recommendation.md`

---

## 🎯 Success Criteria

✅ Lambda function runs daily at 09:05 ET  
✅ Fetches odds for all scheduled games  
✅ Processes team markets (moneyline, spread, total)  
✅ Processes player props (points, rebounds, assists)  
✅ Stores data in `markets` table  
✅ Uses < 200 credits/month  
✅ No errors in CloudWatch logs  

---

_Last updated: 2025-01-15_

