# Nightly BDL Updater Lambda

Fetches yesterday's and today's Final NBA games from the BallDontLie API, upserts raw tables, transforms into analytics tables, and recomputes season averages.

## Pipeline

```
EventBridge (cron 08:00 UTC / 03:00 ET)
  -> Lambda handler
    -> BDL API: GET /games (yesterday + today, status = Final)
    -> BDL API: GET /stats (box scores for Final games)
    -> raw.games (upsert)
    -> raw.player_game_stats (upsert)
    -> raw.players (upsert new players)
    -> analytics.games (transform)
    -> analytics.player_game_logs (transform)
    -> analytics.team_game_stats (compute)
    -> analytics.team_season_averages (recompute for season)
    -> analytics.player_season_averages (recompute for affected players)
```

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `SUPABASE_DB_URL` | Yes | -- | Postgres connection string (pooled recommended) |
| `BALLDONTLIE_API_KEY` | Yes | -- | BallDontLie API key |
| `BALLDONTLIE_REQUEST_DELAY_MS` | No | `200` | Delay between API calls (ms). GOAT tier: 200. Free tier: 12000 |
| `MAX_RETRIES` | No | `3` | Max retry attempts for 429/5xx errors |

## Local Testing

```bash
cd lambda/nightly-bdl-updater
npm install
npx tsx index.ts
```

Requires a `.env` file at the project root or in this directory with `SUPABASE_DB_URL` and `BALLDONTLIE_API_KEY`.

## Build & Package

```bash
cd lambda/nightly-bdl-updater
npm install
npm run build
cd dist
cp ../package.json ../package-lock.json .
npm install --production
zip -r ../nightly-bdl-updater.zip .
```

This produces `lambda/nightly-bdl-updater/nightly-bdl-updater.zip` ready for upload.

## AWS Console Deployment Guide

### Step 1: Create the Lambda Function

1. Open the [AWS Lambda console](https://console.aws.amazon.com/lambda/)
2. Click **Create function**
3. Choose **Author from scratch**
4. Configure:
   - **Function name:** `nightly-bdl-updater`
   - **Runtime:** Node.js 24.x
   - **Architecture:** x86_64
5. Under **Permissions**, either:
   - Use an existing role (e.g. the one from your `boxscore-scraper` Lambda)
   - Or let AWS create a new role with basic Lambda permissions
6. Click **Create function**

### Step 2: Upload the Code

1. On the function page, scroll to the **Code** section
2. Click **Upload from** > **.zip file**
3. Upload the `nightly-bdl-updater.zip` file you built above
4. Click **Save**

### Step 3: Set the Handler

1. In the **Code** section, under **Runtime settings**, click **Edit**
2. Set **Handler** to: `index.handler`
3. Click **Save**

### Step 4: Configure Timeout and Memory

1. Go to **Configuration** > **General configuration** > **Edit**
2. Set:
   - **Memory:** 256 MB
   - **Timeout:** 5 min 0 sec
3. Click **Save**

### Step 5: Add Environment Variables

1. Go to **Configuration** > **Environment variables** > **Edit**
2. Add these key-value pairs:

   | Key | Value |
   |---|---|
   | `SUPABASE_DB_URL` | `postgresql://postgres.<project>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true` |
   | `BALLDONTLIE_API_KEY` | Your BallDontLie API key |
   | `BALLDONTLIE_REQUEST_DELAY_MS` | `200` (GOAT tier) or `12000` (free tier) |

3. Click **Save**

### Step 6: Test the Lambda

1. Go to the **Test** tab
2. Create a new test event:
   - **Event name:** `manual-test`
   - **Event JSON:** `{}`
3. Click **Test**
4. Check the execution result -- you should see the JSON summary with games processed
5. Check the **Log output** section for the step-by-step pipeline logs

### Step 7: Create the EventBridge Schedule

1. Open the [Amazon EventBridge console](https://console.aws.amazon.com/events/)
2. In the left sidebar, click **Rules**
3. Make sure you're in the **default** event bus, then click **Create rule**
4. Configure the rule:
   - **Name:** `nightly-bdl-updater-schedule`
   - **Description:** `Nightly NBA stats update at 08:00 UTC (03:00 ET)`
   - **Rule type:** Schedule
5. Click **Next**
6. Define the schedule:
   - Choose **A schedule that runs at a regular rate, such as every 10 minutes**... then switch to **Cron-based schedule**
   - **Cron expression:** `0 8 * * ? *`
   - This runs at 08:00 UTC (03:00 ET) every day
   - Verify the **Next 10 trigger dates** look correct (every day at 8:00 AM UTC)
7. Click **Next**
8. Select target:
   - **Target type:** AWS service
   - **Select a target:** Lambda function
   - **Function:** `nightly-bdl-updater`
9. Click **Next**
10. Tags are optional -- click **Next**
11. Review and click **Create rule**

### Step 8: Verify the Schedule is Active

1. Back on the **Rules** page, confirm `nightly-bdl-updater-schedule` shows **Status: Enabled**
2. You can wait for the next trigger time, or go back to the Lambda console and use the **Test** button to run it immediately

## Monitoring

After the first scheduled run:

1. **Lambda console** > your function > **Monitor** tab > **View CloudWatch Logs**
2. Look for the `=== SUMMARY ===` line in the latest log stream
3. Key metrics to check:
   - `finalGames` > 0 (on game days)
   - `statsUpserted` matches expected player count
   - `status: "success"`

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
