# Nightly BDL Updater Lambda

Fetches yesterday's and today's Final NBA games from the BallDontLie API, upserts raw tables, transforms into analytics tables, and recomputes season averages.

## Pipeline

```
EventBridge (cron 08:00 UTC / 03:00 ET)
  → Lambda handler
    → BDL API: GET /games (yesterday + today, status = Final)
    → BDL API: GET /stats (box scores for Final games)
    → raw.games (upsert)
    → raw.player_game_stats (upsert)
    → raw.players (upsert new players)
    → analytics.games (transform)
    → analytics.player_game_logs (transform)
    → analytics.team_game_stats (compute)
    → analytics.team_season_averages (recompute for season)
    → analytics.player_season_averages (recompute for affected players)
```

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `SUPABASE_DB_URL` | Yes | — | Postgres connection string (pooled recommended) |
| `BALLDONTLIE_API_KEY` | Yes | — | BallDontLie API key |
| `BALLDONTLIE_REQUEST_DELAY_MS` | No | `200` | Delay between API calls (ms). GOAT tier: 200. Free tier: 12000 |
| `MAX_RETRIES` | No | `3` | Max retry attempts for 429/5xx errors |

## Local Testing

```bash
cd lambda/nightly-bdl-updater
npm install
npx tsx index.ts
```

Requires a `.env` file at the project root or in this directory with `SUPABASE_DB_URL` and `BALLDONTLIE_API_KEY`.

## Build & Deploy

```bash
# Build
cd lambda/nightly-bdl-updater
npm install
npm run build

# Package for Lambda
cd dist
cp ../package.json ../package-lock.json .
npm install --production
zip -r ../nightly-bdl-updater.zip .

# Upload to AWS Lambda
aws lambda update-function-code \
  --function-name nightly-bdl-updater \
  --zip-file fileb://../nightly-bdl-updater.zip
```

### Lambda Configuration

- **Runtime:** Node.js 20.x
- **Handler:** `index.handler`
- **Timeout:** 300 seconds (5 min; typical run < 60s)
- **Memory:** 256 MB

### EventBridge Schedule

```json
{
  "ScheduleExpression": "cron(0 8 * * ? *)",
  "Description": "Nightly NBA stats update at 08:00 UTC (03:00 ET)",
  "Target": {
    "Arn": "arn:aws:lambda:<region>:<account>:function:nightly-bdl-updater"
  }
}
```

AWS CLI:

```bash
aws events put-rule \
  --name nightly-bdl-updater-schedule \
  --schedule-expression "cron(0 8 * * ? *)" \
  --description "Nightly NBA stats update at 08:00 UTC (03:00 ET)"

aws events put-targets \
  --rule nightly-bdl-updater-schedule \
  --targets "Id"="1","Arn"="arn:aws:lambda:<region>:<account>:function:nightly-bdl-updater"

aws lambda add-permission \
  --function-name nightly-bdl-updater \
  --statement-id eventbridge-nightly \
  --action lambda:InvokeFunction \
  --principal events.amazonaws.com \
  --source-arn "arn:aws:events:<region>:<account>:rule/nightly-bdl-updater-schedule"
```

## Idempotency

All database writes use `ON CONFLICT ... DO UPDATE`, making the job safe to re-run. If it runs twice for the same date window, it will overwrite with the same data.

## Logging

The handler logs each pipeline step with counts:
- Games found / Final games
- Stat lines fetched and upserted
- Players upserted
- Analytics rows transformed
- Team and player season averages recomputed
- Final JSON summary with elapsed time
