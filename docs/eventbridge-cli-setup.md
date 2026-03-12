# EventBridge Rules via AWS CLI

Use these commands to create or fix the two scheduled rules that trigger your odds and player-props Lambdas. All steps use **EventBridge Rules** (not EventBridge Scheduler).

**Prerequisites:** AWS CLI installed and configured (`aws configure`), and both Lambda functions already exist: `odds-pre-game-snapshot`, `player-props-snapshot`.

**One-shot script (Bash):** From the repo root, run:
```bash
bash scripts/setup-eventbridge-rules.sh
```
Optional: pass a region, e.g. `bash scripts/setup-eventbridge-rules.sh eu-west-1`. Default is `us-east-1`.

Or copy-paste the sections below into PowerShell or Bash.

---

## 1. Set variables

Run once; replace region if needed.

```bash
REGION=us-east-1
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "Region: $REGION  Account: $ACCOUNT_ID"
```

---

## 2. Odds snapshot rule (every 30 min, 10:00–12:00 ET)

**Rule name:** `odds-snapshot-schedule`  
**Schedule:** 10:00, 10:30, 11:00, 11:30, 12:00 ET = `0/30 15-17` UTC

```bash
# Create or update the rule
aws events put-rule \
  --name odds-snapshot-schedule \
  --schedule-expression "cron(0/30 15-17 * * ? *)" \
  --description "NBA odds snapshot every 30 min, 10am-12pm ET" \
  --state ENABLED \
  --region "$REGION"

# Attach Lambda as target
aws events put-targets \
  --rule odds-snapshot-schedule \
  --targets "Id=1,Arn=arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:odds-pre-game-snapshot" \
  --region "$REGION"

# Allow EventBridge to invoke the Lambda (required)
aws lambda add-permission \
  --function-name odds-pre-game-snapshot \
  --statement-id allow-eventbridge-odds-schedule \
  --action lambda:InvokeFunction \
  --principal events.amazonaws.com \
  --source-arn "arn:aws:events:${REGION}:${ACCOUNT_ID}:rule/odds-snapshot-schedule" \
  --region "$REGION"
```

If `add-permission` fails with "ResourceConflictException" (statement already exists), the permission is already there; you can skip that command or use a new `--statement-id` and remove the old one later.

---

## 3. Player props snapshot rule (every 30 min, 10:05–12:05 ET)

**Rule name:** `player-props-snapshot-schedule`  
**Schedule:** 10:05, 10:35, 11:05, 11:35, 12:05 ET = `5,35 15-17` UTC

```bash
# Create or update the rule
aws events put-rule \
  --name player-props-snapshot-schedule \
  --schedule-expression "cron(5,35 15-17 * * ? *)" \
  --description "NBA player props snapshot every 30 min, 10:05am-12:05pm ET" \
  --state ENABLED \
  --region "$REGION"

# Attach Lambda as target
aws events put-targets \
  --rule player-props-snapshot-schedule \
  --targets "Id=1,Arn=arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:player-props-snapshot" \
  --region "$REGION"

# Allow EventBridge to invoke the Lambda (required)
aws lambda add-permission \
  --function-name player-props-snapshot \
  --statement-id allow-eventbridge-player-props-schedule \
  --action lambda:InvokeFunction \
  --principal events.amazonaws.com \
  --source-arn "arn:aws:events:${REGION}:${ACCOUNT_ID}:rule/player-props-snapshot-schedule" \
  --region "$REGION"
```

---

## 4. Verify

**List rules and state:**
```bash
aws events list-rules --region "$REGION" --query "Rules[?contains(Name,'snapshot')].[Name,State,ScheduleExpression]" --output table
```

**Check targets for each rule:**
```bash
aws events list-targets-by-rule --rule odds-snapshot-schedule --region "$REGION"
aws events list-targets-by-rule --rule player-props-snapshot-schedule --region "$REGION"
```

**Trigger Lambda manually (optional):**
```bash
aws lambda invoke --function-name odds-pre-game-snapshot --payload '{}' response.json --region "$REGION"
cat response.json
```

**After the next scheduled time:** Check CloudWatch log groups  
`/aws/lambda/odds-pre-game-snapshot` and `/aws/lambda/player-props-snapshot` for new log streams.

---

## 5. Odds rule: 6am–12pm ET (optional)

To run the odds Lambda every 30 minutes from **6am–12pm ET** instead of 10am–12pm, update only the rule (target and permission stay the same):

```bash
# Same REGION (and ACCOUNT_ID) as in section 1
aws events put-rule \
  --name odds-snapshot-schedule \
  --schedule-expression "cron(0/30 11-17 * * ? *)" \
  --description "NBA odds snapshot every 30 min, 6am-12pm ET" \
  --state ENABLED \
  --region "$REGION"
```

Cron `0/30 11-17` = 11:00–17:00 UTC = 6:00am–12:00pm ET (EST) or 7:00am–1:00pm ET (EDT).

---

## 6. Remove / re-create (optional)

To delete a rule (targets must be removed first):

```bash
aws events remove-targets --rule odds-snapshot-schedule --ids 1 --region "$REGION"
aws events delete-rule --name odds-snapshot-schedule --region "$REGION"
```

To remove the Lambda permission (so you can re-add it cleanly):

```bash
aws lambda remove-permission \
  --function-name odds-pre-game-snapshot \
  --statement-id allow-eventbridge-odds-schedule \
  --region "$REGION"
```

---

## Summary

| Rule name                         | Schedule (UTC)           | Lambda                     |
|-----------------------------------|--------------------------|----------------------------|
| `odds-snapshot-schedule`          | `0/30 15-17 * * ? *` (10am–12pm ET) or `0/30 11-17 * * ? *` (6am–12pm ET) | `odds-pre-game-snapshot`   |
| `player-props-snapshot-schedule`  | `5,35 15-17 * * ? *`     | `player-props-snapshot`    |

After running the commands in sections 1–3, both Lambdas will be triggered by EventBridge Rules at the intended ET times.
