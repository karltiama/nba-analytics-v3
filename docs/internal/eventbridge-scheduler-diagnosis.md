# EventBridge Scheduler / Rules Diagnosis Guide

This guide helps you fix Lambda functions that are **not being triggered** by AWS scheduling. The most common cause is mixing up **EventBridge Rules** (legacy) with **EventBridge Scheduler** (newer), or missing Lambda invoke permissions.

---

## The Two Different Services

| | **EventBridge Rules** (schedule-based) | **EventBridge Scheduler** |
|---|----------------------------------------|----------------------------|
| **What it is** | Rules on an event bus with a *schedule* (cron/rate) | Standalone scheduling service (recommended by AWS for new use) |
| **Where in console** | EventBridge → **Rules** (default event bus) | EventBridge → **Schedules** (or “Scheduler” in left nav) |
| **Invokes Lambda as** | `events.amazonaws.com` | Scheduler uses an **execution role** that you attach to the schedule; that role needs `lambda:InvokeFunction` |
| **Our docs** | `eventbridge-setup-guide.md`, Lambda READMEs (Step 7) | This doc (how to use Scheduler correctly) |

**Important:** If you created “schedules” under **EventBridge Scheduler** but never gave an execution role (or the role can’t invoke Lambda), the Lambdas will never run. If you created **Rules** but didn’t add the rule as a **target** or didn’t add Lambda permission for `events.amazonaws.com`, they also won’t run.

---

## Step 1: See What You Actually Have

### A. Check EventBridge Rules (legacy pattern)

```bash
# List rules on the default event bus (replace REGION if needed)
aws events list-rules --region us-east-1
```

Look for rules like:

- `odds-snapshot-schedule` → should target `odds-pre-game-snapshot` Lambda  
- `player-props-snapshot-schedule` → should target `player-props-snapshot` Lambda  

If these exist, you’re using **Rules**. Then:

1. **Rule state**
   ```bash
   aws events describe-rule --name odds-snapshot-schedule --region us-east-1
   ```
   - `State` must be `ENABLED`.

2. **Target attached**
   ```bash
   aws events list-targets-by-rule --rule odds-snapshot-schedule --region us-east-1
   ```
   - There must be a target whose `Arn` is your Lambda function ARN.

3. **Lambda permission for EventBridge**
   - Lambda console → your function → **Configuration** → **Permissions** → **Resource-based policy**.
   - There should be a statement with **Principal** `events.amazonaws.com` and **Source ARN** = the rule ARN (e.g. `arn:aws:events:us-east-1:ACCOUNT:rule/odds-snapshot-schedule`).

If any of these are missing, the Rule will not invoke the Lambda.

### B. Check EventBridge Scheduler (new product)

In the AWS Console:

1. Open **EventBridge** → in the left sidebar click **Schedules** (under “Scheduler”).
2. Check whether you have schedules there (e.g. “odds-snapshot”, “player-props-snapshot”).

If you see your schedules here (and not under **Rules**), you’re using **EventBridge Scheduler**. Then:

- Each schedule must have:
  - **Target type**: Lambda.
  - **Target**: Your function (e.g. `odds-pre-game-snapshot`).
  - **Execution role**: A role that Scheduler can assume and that has `lambda:InvokeFunction` on that Lambda (or the Console may add the Lambda resource policy for you when you pick the function).

If the schedule has no target or the execution role can’t invoke Lambda, the function will never run.

---

## Step 2: Fix EventBridge Rules (if you use Rules)

Use your **region** and **account ID** in the ARNs below.

### 2.1 Create or fix the rule (odds example)

```bash
REGION=us-east-1
RULE_NAME=odds-snapshot-schedule
# Every 30 min from 15:00–17:00 UTC = 10:00–12:00 ET (10:00, 10:30, 11:00, 11:30, 12:00 ET)
aws events put-rule \
  --name $RULE_NAME \
  --schedule-expression "cron(0/30 15-17 * * ? *)" \
  --description "NBA odds snapshot every 30 min, 10am–12pm ET" \
  --state ENABLED \
  --region $REGION
```

**Cron note:** EventBridge cron is 6 fields: `minute hour day-of-month month day-of-week year`.  
`0/30 15-17 * * ? *` = at :00 and :30 for hours 15, 16, 17 UTC.

### 2.2 Add Lambda as target

```bash
ACCOUNT_ID=123456789012   # Your AWS account ID
FUNCTION_NAME=odds-pre-game-snapshot

aws events put-targets \
  --rule $RULE_NAME \
  --targets "Id=1,Arn=arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:${FUNCTION_NAME}" \
  --region $REGION
```

### 2.3 Give EventBridge permission to invoke Lambda

**Required.** Without this, the rule fires but Lambda returns 403 and doesn’t run.

```bash
aws lambda add-permission \
  --function-name $FUNCTION_NAME \
  --statement-id allow-eventbridge-rule \
  --action lambda:InvokeFunction \
  --principal events.amazonaws.com \
  --source-arn arn:aws:events:${REGION}:${ACCOUNT_ID}:rule/$RULE_NAME \
  --region $REGION
```

Repeat the same pattern for **player-props-snapshot**: create rule `player-props-snapshot-schedule` (cron `5,35 15-17 * * ? *` for 10:05–12:05 ET), put target, add Lambda permission.

---

## Step 3: Fix EventBridge Scheduler (if you use Scheduler)

If you created schedules under **EventBridge Scheduler**:

1. **Execution role**  
   When you create the schedule, you choose an execution role. That role must:
   - Have a trust policy allowing `scheduler.amazonaws.com` to assume it.
   - Have a policy with `lambda:InvokeFunction` on your Lambda ARN.

2. **Target**  
   In the schedule, set:
   - **Target API**: Invoke Lambda function.
   - **Lambda function**: e.g. `odds-pre-game-snapshot`.

3. **Lambda resource policy (if needed)**  
   When you set the target in the Console, AWS often adds the resource-based policy on the Lambda automatically. If you created the schedule via CLI/CloudFormation, you may need to add:

   ```bash
   aws lambda add-permission \
     --function-name odds-pre-game-snapshot \
     --statement-id allow-eventbridge-scheduler \
     --action lambda:InvokeFunction \
     --principal scheduler.amazonaws.com \
     --source-arn arn:aws:scheduler:REGION:ACCOUNT:schedule/default/SCHEDULE_NAME \
     --region REGION
   ```

   (Replace `SCHEDULE_NAME` with the name of the schedule in Scheduler.)

---

## Step 4: Verify Lambda Runs

1. **Manual invoke**
   ```bash
   aws lambda invoke --function-name odds-pre-game-snapshot --payload '{}' response.json --region us-east-1
   cat response.json
   ```
   If this works, the function and env (DB, API keys) are fine; the issue is only the trigger.

2. **CloudWatch**
   - **Log group**: `/aws/lambda/odds-pre-game-snapshot` (and same for `player-props-snapshot`).
   - After the next scheduled time, check for new log streams. No new streams = trigger never fired (Rule/Scheduler or permissions).

3. **EventBridge metrics (Rules)**
   - CloudWatch → Metrics → **Events** (or EventBridge) → **By Rule Name**.
   - Check **Invocations** for your rule. Zero invocations at the scheduled time = rule not firing or no target.

---

## Quick Checklist

- [ ] I know which I use: **Rules** (under EventBridge → Rules) or **Scheduler** (EventBridge → Schedules).
- [ ] **Rules:** Rule exists, `State` = ENABLED, has a target (Lambda ARN), and Lambda has resource policy for `events.amazonaws.com` with that rule’s ARN.
- [ ] **Scheduler:** Schedule has Lambda as target and an execution role that can invoke that Lambda; Lambda allows `scheduler.amazonaws.com` if required.
- [ ] Manual `aws lambda invoke` works for both Lambdas.
- [ ] After the next scheduled time, CloudWatch has new log streams for the function.

---

## Cron Reference (UTC) – Rules

| Goal | Cron (UTC) |
|------|------------|
| 10:00–12:00 ET every 30 min (10:00, 10:30, 11:00, 11:30, 12:00) | `cron(0/30 15-17 * * ? *)` |
| 10:05–12:05 ET every 30 min (10:05, 10:35, 11:05, 11:35, 12:05) | `cron(5,35 15-17 * * ? *)` |
| Daily 09:05 ET | `cron(5 14 * * ? *)` (EST) or `cron(5 13 * * ? *)` (EDT) |

ET = UTC−5 (EST) or UTC−4 (EDT). Our Lambdas filter by ET date, so 14:05 UTC is a safe default for “morning ET”.

---

## Summary

- **“EventBridge Scheduler”** in the console usually means the **Scheduler** product (Schedules), not Rules. Our READMEs describe **Rules** (Create rule → Schedule → Cron).
- If nothing runs: (1) Confirm whether you’re on Rules or Scheduler, (2) Ensure the rule/schedule has the Lambda as target, (3) Ensure Lambda can be invoked by `events.amazonaws.com` (Rules) or by the Scheduler execution role / `scheduler.amazonaws.com` (Scheduler).
- Use the checklist and CLI checks above to fix the missing piece.
