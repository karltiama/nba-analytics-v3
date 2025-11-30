# EventBridge Setup Guide: Daily Pre-Game Odds Snapshot

This guide walks you through setting up AWS EventBridge to automatically trigger your Lambda function daily at 09:05 ET for pre-game odds snapshots.

---

## Overview

**What we're setting up:**
- EventBridge rule that triggers daily at 09:05 ET (Eastern Time)
- Lambda function: `odds-pre-game-snapshot`
- Fetches team odds (moneyline, spread, total) + player props (points, rebounds, assists)
- Stores data in Supabase `markets` table

**Credit Usage:**
- 1 API call per day = 30 calls/month
- Estimated: 3-5 credits per call = **90-150 credits/month** ✅
- Well within your 500 credit quota!

---

## Prerequisites

✅ Lambda function `odds-pre-game-snapshot` is created and deployed  
✅ Lambda function has correct environment variables set:
  - `SUPABASE_DB_URL`
  - `ODDS_API_KEY`
  - `ODDS_API_BASE` (optional)
  - `PREFERRED_BOOKMAKER` (optional, defaults to 'draftkings')

---

## Step-by-Step: Create EventBridge Rule

### Step 1: Navigate to EventBridge

1. Go to [AWS Console](https://console.aws.amazon.com/)
2. Search for "EventBridge" in the search bar
3. Click on **Amazon EventBridge** (or **Amazon EventBridge Scheduler**)

**Note:** There are two services:
- **EventBridge Rules**: For event-driven triggers (what we need)
- **EventBridge Scheduler**: For more advanced scheduling (overkill for our use case)

Make sure you're in **EventBridge Rules** (not Scheduler).

---

### Step 2: Create Rule

1. Click **"Create rule"** button (top right)
2. You'll see a multi-step wizard

---

### Step 3: Define Rule Details

**Name:**
```
odds-pre-game-snapshot-daily
```

**Description (optional):**
```
Daily pre-game odds snapshot at 09:05 ET. Fetches team and player odds for all scheduled games.
```

**Event bus:**
- Select **"default"** (default event bus)

**Rule type:**
- Select **"Rule with an event pattern"** (for event-driven)
- OR select **"Schedule"** (for cron-based) - **This is what we want!**

**Note:** If you see "Schedule" option, use that. If not, use "Rule with an event pattern" and we'll configure a cron expression.

Click **"Next"**.

---

### Step 4: Build Event Pattern (if using "Rule with an event pattern")

If you selected "Rule with an event pattern", you need to create a scheduled event:

1. **Event source:** Select **"AWS events or EventBridge partner events"**
2. **Creation method:** Select **"Use pattern form"**
3. **Event pattern:**
   - **Event source:** `aws.events`
   - **Event pattern type:** `EventBridge schedule`
   - **Schedule expression:** `cron(5 9 * * ? *)`
     - This means: "At 09:05 UTC every day"
     - **Wait!** We need 09:05 ET, not UTC!
     - ET is UTC-5 (EST) or UTC-4 (EDT)
     - 09:05 ET = 14:05 UTC (EST) or 13:05 UTC (EDT)
     - **Better approach:** Use `cron(5 14 * * ? *)` for EST or handle timezone in Lambda

**Actually, let's use the Schedule option if available, or use a cron that accounts for timezone.**

Click **"Next"**.

---

### Step 4 (Alternative): Configure Schedule (if using "Schedule" option)

If you selected "Schedule" as the rule type:

1. **Schedule pattern:**
   - Select **"Recurring schedule"**
   - **Schedule type:** `Rate-based schedule` or `Cron-based schedule`
   - **Cron expression:** `cron(5 14 * * ? *)`
     - This is 14:05 UTC = 09:05 ET (EST)
     - **Note:** This doesn't account for daylight saving time!
     - **Better:** Use `cron(5 13 * * ? *)` for EDT (summer) or handle in Lambda

**Recommended Cron Expression:**
```
cron(5 14 * * ? *)
```
- Runs at 14:05 UTC daily
- = 09:05 ET (EST) or 10:05 ET (EDT)
- **Note:** You may need to adjust for daylight saving time, or handle timezone conversion in Lambda

**Timezone Handling:**
- Option A: Use `cron(5 13 * * ? *)` for EDT (summer) and manually change to `cron(5 14 * * ? *)` for EST (winter)
- Option B: Use `cron(5 14 * * ? *)` and let Lambda handle timezone (Lambda already filters by ET date)

**We'll use Option B** since our Lambda already filters by ET timezone.

Click **"Next"**.

---

### Step 5: Select Targets

**Target types:**
- Select **"AWS service"**

**Select a target:**
- **Service:** `Lambda function`
- **Function:** Select your `odds-pre-game-snapshot` function from the dropdown

**Additional settings (optional):**
- **Configure input:** Leave as default (no input needed)
- **Retry policy:** 
  - **Maximum retry attempts:** `2` (recommended)
  - **Maximum age of event:** `1 hour` (default)

Click **"Next"**.

---

### Step 6: Configure Tags (Optional)

You can skip this step or add tags for organization:
- **Key:** `Project`
- **Value:** `nba-analytics`
- **Key:** `Purpose`
- **Value:** `odds-snapshot`

Click **"Next"**.

---

### Step 7: Review and Create

1. Review your configuration:
   - **Rule name:** `odds-pre-game-snapshot-daily`
   - **Schedule:** `cron(5 14 * * ? *)` (09:05 ET daily)
   - **Target:** `odds-pre-game-snapshot` Lambda function
   - **Retry:** 2 attempts

2. Click **"Create rule"**

---

## Step 8: Verify Rule is Active

1. Go back to EventBridge Rules list
2. Find your rule: `odds-pre-game-snapshot-daily`
3. Check **"State"** column - should be **"Enabled"**
4. Check **"Schedule expression"** - should show your cron expression

---

## Step 9: Test the Rule (Optional)

### Option A: Manual Test via Lambda Console

1. Go to Lambda Console
2. Select `odds-pre-game-snapshot` function
3. Click **"Test"** tab
4. Create a test event (empty JSON: `{}`)
5. Click **"Test"** to manually trigger
6. Check CloudWatch logs to verify it works

### Option B: Wait for Scheduled Run

- Wait until 09:05 ET (or 14:05 UTC)
- Check CloudWatch logs after the scheduled time
- Verify data in Supabase `markets` table

---

## Monitoring & Troubleshooting

### Check CloudWatch Logs

1. Go to **CloudWatch** → **Log groups**
2. Find: `/aws/lambda/odds-pre-game-snapshot`
3. Click on latest log stream
4. Look for:
   - `Starting pre-game odds snapshot...`
   - `Fetched X events from Odds API`
   - `Filtered to X events for today`
   - `Summary: { marketsProcessed: X, ... }`

### Common Issues

**Issue: Rule not triggering**
- Check rule state is "Enabled"
- Verify cron expression is correct
- Check EventBridge service is available in your region

**Issue: Lambda function failing**
- Check CloudWatch logs for errors
- Verify environment variables are set correctly
- Check Supabase connection string is valid
- Verify Odds API key is valid

**Issue: No games found**
- Check if there are games scheduled for today
- Verify date filtering logic in Lambda
- Check `bbref_schedule` table has games for today

**Issue: Player props not processing**
- Check if Odds API returns player props for the games
- Verify player name resolution is working (check logs for warnings)
- Check `markets` table for player_prop entries

---

## Cron Expression Reference

**Format:** `cron(minute hour day-of-month month day-of-week year)`

**Examples:**
- `cron(5 14 * * ? *)` - Daily at 14:05 UTC (09:05 ET EST)
- `cron(5 13 * * ? *)` - Daily at 13:05 UTC (09:05 ET EDT)
- `cron(0 9 * * ? *)` - Daily at 09:00 UTC
- `cron(0 14 ? * MON-FRI *)` - Weekdays at 14:00 UTC

**Timezone Note:**
- EventBridge cron uses UTC timezone
- ET = UTC-5 (EST) or UTC-4 (EDT)
- 09:05 ET = 14:05 UTC (EST) or 13:05 UTC (EDT)
- Our Lambda filters by ET date, so using 14:05 UTC works for both (Lambda handles the date filtering)

---

## Cost Estimate

**EventBridge:**
- First 1 million events/month: **FREE** ✅
- Our usage: 30 events/month (one per day)
- **Cost: $0.00**

**Lambda:**
- First 1 million requests/month: **FREE** ✅
- Our usage: 30 invocations/month
- **Cost: $0.00**

**Total AWS Cost: $0.00** ✅

---

## Next Steps

After EventBridge is set up:

1. ✅ **Monitor first few runs** (check CloudWatch logs)
2. ✅ **Verify data quality** (check Supabase `markets` table)
3. ✅ **Check credit usage** (Odds API dashboard)
4. ✅ **Set up alerts** (optional - CloudWatch alarms for failures)

---

## Summary

**What we created:**
- EventBridge rule: `odds-pre-game-snapshot-daily`
- Schedule: Daily at 09:05 ET (cron: `cron(5 14 * * ? *)`)
- Target: Lambda function `odds-pre-game-snapshot`
- Retry: 2 attempts

**Expected behavior:**
- Lambda runs daily at 09:05 ET
- Fetches odds for all games scheduled for today
- Processes team odds (moneyline, spread, total) + player props (points, rebounds, assists)
- Stores in Supabase `markets` table
- Uses ~3-5 credits per day = 90-150 credits/month ✅

**You're all set!** 🎉

---

_Last updated: 2025-01-15_

