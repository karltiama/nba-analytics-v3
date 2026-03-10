# Player Props Snapshot Lambda

Fetches today's NBA player props from BallDontLie `/v2/odds/player_props`, stores raw snapshots, and transforms into analytics tables. Designed to run every 30 minutes from 10am–12pm ET so props are captured as sportsbooks publish them.

**Prerequisite:** The `nightly-bdl-updater` Lambda must have already run (03:00 ET) so today's games exist in `analytics.games`.

## Pipeline

```
EventBridge (cron every 30 min, 10:05–12:05 ET — offset from odds)
  -> Lambda handler
    -> DB: SELECT game_id FROM analytics.games WHERE game_date = today
    -> For each game:
       -> BDL API: GET /v2/odds/player_props?game_id={id}
       -> raw.player_prop_snapshots (append-only)
       -> raw.player_prop_market_outcomes (normalized sides)
    -> raw.player_prop_pull_runs (audit log)
    -> analytics.player_prop_current (delete+insert per game — latest props)
    -> analytics.player_prop_history (append — every snapshot for line movement)
    -> analytics.player_prop_movement_summary (recompute open vs current for O/U)
```

**Prop types captured:** points, rebounds, assists, threes, PRA, and all other prop types returned by BDL.

**Market types:** over_under (O/U with two sides) and milestone (single threshold bet).

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `SUPABASE_DB_URL` | Yes | -- | Postgres connection string |
| `BALLDONTLIE_API_KEY` | Yes | -- | BallDontLie API key (GOAT tier required) |
| `PREFERRED_VENDOR` | No | `draftkings` | Which sportsbook to use for `player_prop_current` |

## Local Testing

```bash
cd lambda/player-props-snapshot
npm install

# Fetch today's props (default)
npx tsx index.ts

# Fetch props for a specific date
npx tsx index.ts 2026-03-10

# Fetch multiple dates
npx tsx index.ts 2026-03-10 2026-03-11
```

Requires a `.env` file at the project root (or in this directory) with `SUPABASE_DB_URL` and `BALLDONTLIE_API_KEY`.

## Build & Package

```bash
cd lambda/player-props-snapshot
npm install
npm run build
cd dist
cp ../package.json ../package-lock.json .
npm install --production
zip -r ../player-props-snapshot.zip .
```

This produces `lambda/player-props-snapshot/player-props-snapshot.zip` ready for upload.

## AWS Console Deployment Guide

### Step 1: Create the Lambda Function

1. Open the [AWS Lambda console](https://console.aws.amazon.com/lambda/)
2. Click **Create function**
3. Choose **Author from scratch**
4. Configure:
   - **Function name:** `player-props-snapshot`
   - **Runtime:** Node.js 20.x (or 22.x)
   - **Architecture:** x86_64
5. Under **Permissions**, use the existing role from `nightly-bdl-updater` or `odds-pre-game-snapshot`
6. Click **Create function**

### Step 2: Upload the Code

1. On the function page, scroll to the **Code** section
2. Click **Upload from** > **.zip file**
3. Upload the `player-props-snapshot.zip` file you built above
4. Click **Save**

### Step 3: Set the Handler

1. In the **Code** section, under **Runtime settings**, click **Edit**
2. Set **Handler** to: `index.handler`
3. Click **Save**

### Step 4: Configure Timeout and Memory

1. Go to **Configuration** > **General configuration** > **Edit**
2. Set:
   - **Memory:** 256 MB
   - **Timeout:** 5 min 0 sec (higher than odds due to per-game API calls)
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
4. Check the execution result — you should see a JSON summary with games queried, props fetched/stored, and transform counts
5. Check the **Log output** section for step-by-step pipeline logs

### Step 7: Create the EventBridge Schedule

1. Open the [Amazon EventBridge console](https://console.aws.amazon.com/events/)
2. In the left sidebar, click **Rules**
3. Make sure you're in the **default** event bus, then click **Create rule**
4. Configure:
   - **Name:** `player-props-snapshot-schedule`
   - **Description:** `NBA player props snapshot every 30 min, 10:05am–12:05pm ET`
   - **Rule type:** Schedule
5. Click **Next**
6. Define the schedule:
   - Choose **Cron-based schedule**
   - **Cron expression:** `5/30 15-17 * * ? *`
   - This runs at :05 and :35 past each hour from 15:00–17:00 UTC = **10:05am–12:05pm ET**
   - Offset by 5 min from odds schedule to avoid concurrent BDL API calls
   - Triggers at: 10:05, 10:35, 11:05, 11:35, 12:05 ET (5 invocations/day)
   - Verify the **Next 10 trigger dates** look correct
7. Click **Next**
8. Select target:
   - **Target type:** AWS service
   - **Select a target:** Lambda function
   - **Function:** `player-props-snapshot`
9. Click **Next** > **Next** > **Create rule**

### Step 8: Verify

1. Confirm `player-props-snapshot-schedule` shows **Status: Enabled**
2. Use the **Test** button to run manually, or wait for the next trigger

### If the Lambda never runs on schedule

EventBridge **Rules** (used above) are different from **EventBridge Scheduler**. If you created a "schedule" under Scheduler instead of a Rule, or if the rule has no target / Lambda permission, the function won’t run. See **[EventBridge Scheduler / Rules diagnosis](../../docs/eventbridge-scheduler-diagnosis.md)** for how to check and fix.

## Monitoring

- **CloudWatch Logs:** `/aws/lambda/player-props-snapshot`
- **Key metrics:** Invocations, Errors, Duration
- **DB audit:** `SELECT * FROM raw.player_prop_pull_runs ORDER BY pulled_at DESC LIMIT 10;`

## Expected Output

```json
{
  "success": true,
  "dates": ["2026-03-09"],
  "results": [
    {
      "date": "2026-03-09",
      "pullRunId": 1,
      "gamesQueried": 8,
      "rowsFetched": 1240,
      "rowsStored": 1240,
      "uniquePlayers": 96,
      "uniqueVendors": 5,
      "transform": { "current": 620, "history": 1240, "movement": 180 }
    }
  ],
  "totalFetched": 1240,
  "totalStored": 1240,
  "timestamp": "2026-03-09T15:05:12.456Z"
}
```

## Idempotency

- `raw.player_prop_snapshots`: Append-only (each pull creates new rows)
- `raw.player_prop_market_outcomes`: Append-only (linked to snapshots)
- `analytics.player_prop_current`: Delete+insert per game per vendor (always reflects latest)
- `analytics.player_prop_history`: Deduped by `(game_id, player_id, vendor, prop_type, market_type, line_value, snapshot_at)` unique constraint
- Safe to re-run or overlap schedules without data corruption

## API Considerations

Unlike the odds endpoint (which accepts `dates[]`), the player props endpoint requires a `game_id` parameter. This means:
- One API call per game (vs one call for all games with odds)
- ~8-15 API calls per run depending on the day's schedule
- 200ms delay between calls to respect rate limits
- Well within GOAT tier limit of 600 req/min

## Scheduling Recommendations

| Frequency | Cron (UTC) | Use case |
|---|---|---|
| Every 30 min, 10:05am–12:05pm ET | `5/30 15-17 * * ? *` | **Recommended** — captures props as books publish |
| 1x daily at 11:05am ET | `5 16 * * ? *` | Minimal — single snapshot |
| Every 30 min, 10:05am–7:05pm ET | `5/30 15-0 * * ? *` | Extended — captures line movement through tip-off |
