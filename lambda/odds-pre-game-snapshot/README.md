# Pre-Game Odds Snapshot Lambda

Fetches today's NBA game odds from BallDontLie `/v2/odds`, stores raw snapshots, and transforms into analytics tables. Designed to run every 30 minutes from 10am–12pm ET so odds are captured as sportsbooks publish them.

**Prerequisite:** The `nightly-bdl-updater` Lambda must have already run (03:00 ET) so today's games exist in `analytics.games`.

## Pipeline

```
EventBridge (cron every 30 min, 10:00–12:00 ET)
  -> Lambda handler
    -> BDL API: GET /v2/odds?dates[]=today
    -> raw.odds_pull_runs (audit log)
    -> raw.odds_snapshots (append-only)
    -> analytics.game_odds_current (upsert — latest odds per game)
    -> analytics.game_odds_history (append — every snapshot for line movement)
    -> analytics.game_line_movement_summary (recompute open vs current)
```

**Markets captured:** Moneyline, Spread, Total (per vendor — defaults to DraftKings).

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `SUPABASE_DB_URL` | Yes | -- | Postgres connection string |
| `BALLDONTLIE_API_KEY` | Yes | -- | BallDontLie API key (GOAT tier recommended) |
| `PREFERRED_VENDOR` | No | `draftkings` | Which sportsbook to use for `game_odds_current` |

## Local Testing

```bash
cd lambda/odds-pre-game-snapshot
npm install

# Fetch today + tomorrow (default)
npx tsx index.ts

# Fetch a specific date
npx tsx index.ts 2026-03-10

# Fetch multiple dates
npx tsx index.ts 2026-03-10 2026-03-11
```

Requires a `.env` file at the project root (or in this directory) with `SUPABASE_DB_URL` and `BALLDONTLIE_API_KEY`.

## Build & Package

```bash
cd lambda/odds-pre-game-snapshot
npm install
npm run build
cd dist
cp ../package.json ../package-lock.json .
npm install --production
zip -r ../odds-pre-game-snapshot.zip .
```

This produces `lambda/odds-pre-game-snapshot/odds-pre-game-snapshot.zip` ready for upload.

## AWS Console Deployment Guide

### Step 1: Create the Lambda Function

1. Open the [AWS Lambda console](https://console.aws.amazon.com/lambda/)
2. Click **Create function**
3. Choose **Author from scratch**
4. Configure:
   - **Function name:** `odds-pre-game-snapshot`
   - **Runtime:** Node.js 20.x (or 22.x)
   - **Architecture:** x86_64
5. Under **Permissions**, use an existing role (e.g. the one from `nightly-bdl-updater`) or let AWS create a new one
6. Click **Create function**

### Step 2: Upload the Code

1. On the function page, scroll to the **Code** section
2. Click **Upload from** > **.zip file**
3. Upload the `odds-pre-game-snapshot.zip` file you built above
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
   | `PREFERRED_VENDOR` | `draftkings` (optional) |

3. Click **Save**

### Step 6: Test the Lambda

1. Go to the **Test** tab
2. Create a new test event:
   - **Event name:** `manual-test`
   - **Event JSON:** `{}`
3. Click **Test**
4. Check the execution result — you should see a JSON summary with dates processed, rows fetched/stored, and transform counts
5. Check the **Log output** section for step-by-step pipeline logs

### Step 7: Create the EventBridge Schedule

1. Open the [Amazon EventBridge console](https://console.aws.amazon.com/events/)
2. In the left sidebar, click **Rules**
3. Make sure you're in the **default** event bus, then click **Create rule**
4. Configure:
   - **Name:** `odds-snapshot-schedule`
   - **Description:** `NBA odds snapshot every 30 min, 10am–12pm ET`
   - **Rule type:** Schedule
5. Click **Next**
6. Define the schedule:
   - Choose **Cron-based schedule**
   - **Cron expression:** `*/30 15-17 * * ? *`
   - This runs every 30 min from 15:00–17:00 UTC = **10:00am–12:00pm ET**
   - Triggers at: 10:00, 10:30, 11:00, 11:30, 12:00 ET (5 invocations/day)
   - Verify the **Next 10 trigger dates** look correct
7. Click **Next**
8. Select target:
   - **Target type:** AWS service
   - **Select a target:** Lambda function
   - **Function:** `odds-pre-game-snapshot`
9. Click **Next** > **Next** > **Create rule**

### Step 8: Verify

1. Confirm `odds-snapshot-schedule` shows **Status: Enabled**
2. Use the **Test** button to run manually, or wait for the next trigger

## Monitoring

- **CloudWatch Logs:** `/aws/lambda/odds-pre-game-snapshot`
- **Key metrics:** Invocations, Errors, Duration
- **DB audit:** `SELECT * FROM raw.odds_pull_runs ORDER BY pulled_at DESC LIMIT 10;`

## Expected Output

```json
{
  "success": true,
  "dates": ["2026-03-09", "2026-03-10"],
  "results": [
    {
      "date": "2026-03-09",
      "pullRunId": 42,
      "rowsFetched": 15,
      "rowsStored": 15,
      "uniqueGames": 3,
      "uniqueVendors": 5,
      "transform": { "current": 3, "history": 15, "movement": 3 }
    },
    {
      "date": "2026-03-10",
      "pullRunId": 43,
      "rowsFetched": 40,
      "rowsStored": 40,
      "uniqueGames": 8,
      "uniqueVendors": 5,
      "transform": { "current": 8, "history": 40, "movement": 8 }
    }
  ],
  "totalFetched": 55,
  "totalStored": 55,
  "timestamp": "2026-03-09T15:00:05.123Z"
}
```

## Idempotency

- `raw.odds_snapshots`: Append-only (each pull creates new rows)
- `analytics.game_odds_current`: Upserted by game_id (always reflects latest)
- `analytics.game_odds_history`: Deduped by `(game_id, vendor, snapshot_at)` unique constraint
- Safe to re-run or overlap schedules without data corruption

## Scheduling Recommendations

| Frequency | Cron (UTC) | Use case |
|---|---|---|
| Every 30 min, 10am–12pm ET | `*/30 15-17 * * ? *` | **Recommended** — captures odds as books publish |
| 1x daily at 11am ET | `0 16 * * ? *` | Minimal — single snapshot |
| Every 30 min, 10am–7pm ET | `*/30 15-0 * * ? *` | Extended — captures line movement through tip-off |
