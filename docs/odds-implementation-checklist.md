# Odds Implementation Checklist

Step-by-step checklist for implementing historical odds collection.

---

## ✅ Step 1: Validate bbref_schedule (COMPLETED)

**Status:** ✅ All checks passed

**What was done:**
- Created validation script: `scripts/validate-bbref-schedule.ts`
- Validated:
  - ✅ All games have team mappings
  - ✅ No duplicate game IDs
  - ✅ No duplicate matchups
  - ✅ All upcoming games have start times
  - ✅ All games have canonical_game_id
  - ✅ 11 games today, 8 games tomorrow ready for odds

**Run validation:**
```bash
npx tsx scripts/validate-bbref-schedule.ts
```

---

## ✅ Step 2: Create Lambda Function (COMPLETED)

**Status:** ✅ Lambda function structure created

**What was created:**
- `lambda/odds-pre-game-snapshot/index.ts` - Main Lambda function
- `lambda/odds-pre-game-snapshot/package.json` - Dependencies
- `lambda/odds-pre-game-snapshot/tsconfig.json` - TypeScript config
- `lambda/odds-pre-game-snapshot/README.md` - Setup instructions

**Function features:**
- Fetches odds for all scheduled games
- Stores in staging_events and markets tables
- Uses DraftKings as default bookmaker
- Handles errors gracefully
- Idempotent (safe to re-run)

---

## 📋 Step 3: Test Lambda Function Locally

**Status:** ⏳ Pending

**Commands:**
```bash
cd lambda/odds-pre-game-snapshot

# Set environment variables
$env:SUPABASE_DB_URL="your_db_url"
$env:ODDS_API_KEY="your_api_key"

# Test locally
npx tsx index.ts
```

**Expected output:**
- Should fetch odds for today's games
- Should store in database
- Should show summary of processed markets

---

## 📋 Step 4: Deploy to AWS Lambda

**Status:** ⏳ Pending

**Steps:**
1. Create IAM role for Lambda
2. Store secrets in AWS Secrets Manager or SSM
3. Package Lambda function
4. Deploy to AWS
5. Configure environment variables

**See:** `docs/lambda-deployment-guide.md` for detailed instructions

**Quick deploy:**
```bash
cd lambda/odds-pre-game-snapshot
zip -r function.zip index.js node_modules package.json

aws lambda create-function \
  --function-name odds-pre-game-snapshot \
  --runtime nodejs20.x \
  --role arn:aws:iam::ACCOUNT:role/lambda-odds-execution-role \
  --handler index.handler \
  --zip-file fileb://function.zip \
  --timeout 300 \
  --memory-size 512
```

---

## 📋 Step 5: Set Up EventBridge Schedule

**Status:** ⏳ Pending

**Schedule:** Daily at 09:05 ET (14:05 UTC or 13:05 UTC during DST)

**Commands:**
```bash
# Create EventBridge rule
aws events put-rule \
  --name odds-pre-game-snapshot-daily \
  --schedule-expression "cron(5 14 * * ? *)" \
  --state ENABLED

# Add Lambda permission
aws lambda add-permission \
  --function-name odds-pre-game-snapshot \
  --statement-id allow-eventbridge \
  --action lambda:InvokeFunction \
  --principal events.amazonaws.com \
  --source-arn arn:aws:events:REGION:ACCOUNT:rule/odds-pre-game-snapshot-daily

# Add Lambda as target
aws events put-targets \
  --rule odds-pre-game-snapshot-daily \
  --targets "Id=1,Arn=arn:aws:lambda:REGION:ACCOUNT:function:odds-pre-game-snapshot"
```

**Note:** Adjust UTC time based on DST:
- EST (Nov-Mar): 09:05 ET = 14:05 UTC → `cron(5 14 * * ? *)`
- EDT (Mar-Nov): 09:05 ET = 13:05 UTC → `cron(5 13 * * ? *)`

---

## 📋 Step 6: Test Scheduled Execution

**Status:** ⏳ Pending

**Manual trigger test:**
```bash
aws lambda invoke \
  --function-name odds-pre-game-snapshot \
  --payload '{}' \
  response.json

cat response.json
```

**Wait for scheduled run:**
- Check CloudWatch logs after 09:05 ET
- Verify odds were stored in database
- Check admin page: `/admin/odds-debug`

---

## 📋 Step 7: Set Up Closing Line Snapshot (Future)

**Status:** ⏳ Future enhancement

**Approach:**
- Option A: Per-game EventBridge rules (5 min before each game)
- Option B: Batch approach (every 15 min, check games starting soon)

**Recommendation:** Start with Option B (simpler)

---

## 📋 Step 8: Monitor Data Quality

**Status:** ⏳ Pending

**Set up:**
- CloudWatch alarms for Lambda errors
- Daily data quality checks
- Alerts if <80% games have odds

**Query to check:**
```sql
SELECT 
  COUNT(*) as total_games,
  COUNT(DISTINCT m.game_id) as games_with_odds,
  ROUND(100.0 * COUNT(DISTINCT m.game_id) / COUNT(*), 2) as pct_with_odds
FROM bbref_schedule bs
LEFT JOIN markets m ON (m.game_id = bs.canonical_game_id OR m.game_id = bs.bbref_game_id)
  AND m.snapshot_type = 'pre_game'
WHERE bs.game_date = CURRENT_DATE;
```

---

## Current Status Summary

✅ **Completed:**
- Database schemas (staging_events, markets)
- Validation script for bbref_schedule
- Lambda function code
- Test script (test-odds-api.ts)
- Admin debug page
- Integration with betting dashboard

⏳ **Next Steps:**
1. Test Lambda function locally
2. Deploy to AWS
3. Set up EventBridge schedule
4. Monitor first few runs
5. Set up closing line snapshot

---

## Quick Test Commands

**Validate schedule:**
```bash
npx tsx scripts/validate-bbref-schedule.ts
```

**Test odds fetching (manual):**
```bash
npx tsx scripts/test-odds-api.ts
```

**Test Lambda locally:**
```bash
cd lambda/odds-pre-game-snapshot
npx tsx index.ts
```

**Check odds in database:**
```bash
# Visit: http://localhost:3000/admin/odds-debug
```

---

_Last updated: 2025-01-15_

