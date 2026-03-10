#!/usr/bin/env bash
# Set up EventBridge Rules for odds-pre-game-snapshot and player-props-snapshot Lambdas.
# Usage: bash scripts/setup-eventbridge-rules.sh [REGION]
# Default region: us-east-1

set -e
REGION="${1:-us-east-1}"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "Region: $REGION  Account: $ACCOUNT_ID"

echo ""
echo "=== Odds snapshot rule (odds-snapshot-schedule) ==="
aws events put-rule \
  --name odds-snapshot-schedule \
  --schedule-expression "cron(0/30 15-17 * * ? *)" \
  --description "NBA odds snapshot every 30 min, 10am-12pm ET" \
  --state ENABLED \
  --region "$REGION"

aws events put-targets \
  --rule odds-snapshot-schedule \
  --targets "Id=1,Arn=arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:odds-pre-game-snapshot" \
  --region "$REGION"

aws lambda add-permission \
  --function-name odds-pre-game-snapshot \
  --statement-id allow-eventbridge-odds-schedule \
  --action lambda:InvokeFunction \
  --principal events.amazonaws.com \
  --source-arn "arn:aws:events:${REGION}:${ACCOUNT_ID}:rule/odds-snapshot-schedule" \
  --region "$REGION" 2>/dev/null || echo "(Permission may already exist; continuing.)"

echo ""
echo "=== Player props snapshot rule (player-props-snapshot-schedule) ==="
aws events put-rule \
  --name player-props-snapshot-schedule \
  --schedule-expression "cron(5,35 15-17 * * ? *)" \
  --description "NBA player props snapshot every 30 min, 10:05am-12:05pm ET" \
  --state ENABLED \
  --region "$REGION"

aws events put-targets \
  --rule player-props-snapshot-schedule \
  --targets "Id=1,Arn=arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:player-props-snapshot" \
  --region "$REGION"

aws lambda add-permission \
  --function-name player-props-snapshot \
  --statement-id allow-eventbridge-player-props-schedule \
  --action lambda:InvokeFunction \
  --principal events.amazonaws.com \
  --source-arn "arn:aws:events:${REGION}:${ACCOUNT_ID}:rule/player-props-snapshot-schedule" \
  --region "$REGION" 2>/dev/null || echo "(Permission may already exist; continuing.)"

echo ""
echo "=== Verify ==="
aws events list-rules --region "$REGION" --query "Rules[?contains(Name,'snapshot')].[Name,State,ScheduleExpression]" --output table
echo ""
echo "Done. Targets:"
aws events list-targets-by-rule --rule odds-snapshot-schedule --region "$REGION" --query "Targets[0].Arn" --output text
aws events list-targets-by-rule --rule player-props-snapshot-schedule --region "$REGION" --query "Targets[0].Arn" --output text
