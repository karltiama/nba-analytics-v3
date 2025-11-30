# Pre-Game Odds Snapshot Lambda

Fetches and stores pre-game odds (team + player props) for all scheduled NBA games daily at 09:05 ET.

**Features:**
- ✅ Team odds: Moneyline, Spread, Total
- ✅ Player props: Points, Rebounds, Assists
- ✅ Single API call per day (efficient credit usage)
- ✅ Automatic player name → player_id resolution
- ✅ Idempotent UPSERTs (safe to re-run)

## Setup

### 1. Install Dependencies

```bash
cd lambda/odds-pre-game-snapshot
npm install
```

### 2. Build for Lambda

```bash
npm run build
```

### 3. Deploy to AWS Lambda

**Option A: Using AWS CLI**

```bash
# Zip the function
zip -r function.zip index.js node_modules package.json

# Create/update Lambda function
aws lambda create-function \
  --function-name odds-pre-game-snapshot \
  --runtime nodejs20.x \
  --role arn:aws:iam::YOUR_ACCOUNT:role/lambda-execution-role \
  --handler index.handler \
  --zip-file fileb://function.zip \
  --environment Variables="{
    SUPABASE_DB_URL=your_db_url,
    ODDS_API_KEY=your_api_key,
    PREFERRED_BOOKMAKER=draftkings
  }" \
  --timeout 300 \
  --memory-size 512
```

**Option B: Using Serverless Framework or CDK**

See AWS documentation for your preferred deployment method.

### 4. Set Up EventBridge Schedule

```bash
aws events put-rule \
  --name odds-pre-game-snapshot-daily \
  --schedule-expression "cron(5 9 * * ? *)" \
  --description "Daily pre-game odds snapshot at 09:05 ET"

aws lambda add-permission \
  --function-name odds-pre-game-snapshot \
  --statement-id allow-eventbridge \
  --action lambda:InvokeFunction \
  --principal events.amazonaws.com \
  --source-arn arn:aws:events:REGION:ACCOUNT:rule/odds-pre-game-snapshot-daily

aws events put-targets \
  --rule odds-pre-game-snapshot-daily \
  --targets "Id=1,Arn=arn:aws:lambda:REGION:ACCOUNT:function:odds-pre-game-snapshot"
```

## Local Testing

```bash
# Test locally
npm run test

# Or with tsx directly
tsx index.ts
```

## Environment Variables

- `SUPABASE_DB_URL` (required): Database connection string
- `ODDS_API_KEY` (required): Odds API key
- `ODDS_API_BASE` (optional): API base URL (defaults to https://api.the-odds-api.com/v4)
- `PREFERRED_BOOKMAKER` (optional): Default bookmaker (defaults to 'draftkings')

## Monitoring

Check CloudWatch Logs:
- Log Group: `/aws/lambda/odds-pre-game-snapshot`
- Metrics: Invocations, Errors, Duration

## Expected Output

```json
{
  "statusCode": 200,
  "body": {
    "success": true,
    "date": "2025-11-28",
    "totalEventsFetched": 11,
    "todayEventsFound": 11,
    "marketsProcessed": 594,
    "eventsSkipped": 0,
    "errors": 0,
    "timestamp": "2025-11-28T14:05:00.000Z"
  }
}
```

**Credit Usage:**
- 1 API call per day = 30 calls/month
- Estimated: 3-5 credits per call = **90-150 credits/month**
- Well within 500 credit quota! ✅

## What Gets Stored

**Team Markets (per game):**
- Moneyline (home/away)
- Spread (home/away)
- Total (over/under)

**Player Props (per game, per player):**
- Points (over/under)
- Rebounds (over/under)
- Assists (over/under)

**Storage:**
- Raw payloads: `staging_events` table
- Normalized odds: `markets` table
- Snapshot type: `pre_game`

