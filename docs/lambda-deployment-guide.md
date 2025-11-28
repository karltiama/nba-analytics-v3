# Lambda Deployment Guide

Step-by-step guide for deploying the odds snapshot Lambda functions to AWS.

---

## Prerequisites

1. AWS Account with Lambda, EventBridge, and CloudWatch access
2. AWS CLI installed and configured
3. Node.js 20+ installed locally
4. Database credentials stored in AWS Secrets Manager or SSM Parameter Store

---

## Step 1: Prepare Lambda Function

### 1.1 Install Dependencies

```bash
cd lambda/odds-pre-game-snapshot
npm install
```

### 1.2 Build TypeScript

```bash
npm run build
```

This creates `dist/index.js` (or you can use `tsx` to run directly in Lambda with Node 20+)

### 1.3 Test Locally

```bash
# Set environment variables
export SUPABASE_DB_URL="your_db_url"
export ODDS_API_KEY="your_api_key"

# Run locally
npm run test
```

---

## Step 2: Create IAM Role for Lambda

### 2.1 Create Execution Role

```bash
aws iam create-role \
  --role-name lambda-odds-execution-role \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "lambda.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }'
```

### 2.2 Attach Basic Execution Policy

```bash
aws iam attach-role-policy \
  --role-name lambda-odds-execution-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
```

### 2.3 Add VPC Access (if database is in VPC)

```bash
aws iam attach-role-policy \
  --role-name lambda-odds-execution-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole
```

---

## Step 3: Store Secrets

### Option A: AWS Secrets Manager (Recommended)

```bash
# Store database URL
aws secretsmanager create-secret \
  --name odds/supabase-db-url \
  --secret-string "your_database_url"

# Store API key
aws secretsmanager create-secret \
  --name odds/api-key \
  --secret-string "your_odds_api_key"
```

### Option B: SSM Parameter Store

```bash
# Store database URL
aws ssm put-parameter \
  --name /odds/supabase-db-url \
  --value "your_database_url" \
  --type SecureString

# Store API key
aws ssm put-parameter \
  --name /odds/api-key \
  --value "your_odds_api_key" \
  --type SecureString
```

---

## Step 4: Package and Deploy Lambda

### 4.1 Package Function

```bash
cd lambda/odds-pre-game-snapshot

# Install production dependencies only
npm install --production

# Create deployment package
zip -r function.zip index.js node_modules package.json

# Or if using dist/
zip -r function.zip dist/ node_modules package.json
```

### 4.2 Create Lambda Function

```bash
aws lambda create-function \
  --function-name odds-pre-game-snapshot \
  --runtime nodejs20.x \
  --role arn:aws:iam::YOUR_ACCOUNT_ID:role/lambda-odds-execution-role \
  --handler index.handler \
  --zip-file fileb://function.zip \
  --timeout 300 \
  --memory-size 512 \
  --environment Variables="{
    PREFERRED_BOOKMAKER=draftkings
  }"
```

### 4.3 Update Secrets Access (if using Secrets Manager)

Add policy to Lambda role to read secrets:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": [
      "secretsmanager:GetSecretValue"
    ],
    "Resource": [
      "arn:aws:secretsmanager:REGION:ACCOUNT:secret:odds/*"
    ]
  }]
}
```

### 4.4 Update Lambda Code to Read Secrets

Modify Lambda handler to fetch secrets:

```typescript
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const secretsClient = new SecretsManagerClient({});

async function getSecret(secretName: string): Promise<string> {
  const response = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: secretName })
  );
  return response.SecretString || '';
}

// In handler:
const dbUrl = await getSecret('odds/supabase-db-url');
const apiKey = await getSecret('odds/api-key');
```

---

## Step 5: Set Up EventBridge Schedule

### 5.1 Create EventBridge Rule

```bash
aws events put-rule \
  --name odds-pre-game-snapshot-daily \
  --schedule-expression "cron(5 9 * * ? *)" \
  --description "Daily pre-game odds snapshot at 09:05 ET" \
  --state ENABLED
```

**Note:** EventBridge cron uses UTC. 09:05 ET = 14:05 UTC (or 13:05 UTC during DST)

### 5.2 Add Lambda Permission

```bash
aws lambda add-permission \
  --function-name odds-pre-game-snapshot \
  --statement-id allow-eventbridge-invoke \
  --action lambda:InvokeFunction \
  --principal events.amazonaws.com \
  --source-arn arn:aws:events:REGION:ACCOUNT:rule/odds-pre-game-snapshot-daily
```

### 5.3 Add Lambda as Target

```bash
aws events put-targets \
  --rule odds-pre-game-snapshot-daily \
  --targets "Id=1,Arn=arn:aws:lambda:REGION:ACCOUNT:function:odds-pre-game-snapshot"
```

---

## Step 6: Test Lambda

### 6.1 Test via AWS Console

1. Go to Lambda console
2. Select function
3. Click "Test"
4. Create test event: `{}`
5. Run test

### 6.2 Test via CLI

```bash
aws lambda invoke \
  --function-name odds-pre-game-snapshot \
  --payload '{}' \
  response.json

cat response.json
```

### 6.3 Test EventBridge Trigger

```bash
aws events put-events \
  --entries '[{
    "Source": "manual.test",
    "DetailType": "Test Event",
    "Detail": "{}"
  }]'
```

---

## Step 7: Monitor and Debug

### 7.1 CloudWatch Logs

```bash
# View recent logs
aws logs tail /aws/lambda/odds-pre-game-snapshot --follow

# Or in AWS Console:
# CloudWatch > Log Groups > /aws/lambda/odds-pre-game-snapshot
```

### 7.2 CloudWatch Metrics

Monitor:
- `Invocations`: Number of times function runs
- `Errors`: Number of failed invocations
- `Duration`: Execution time
- `Throttles`: If function is hitting concurrency limits

### 7.3 Set Up Alarms

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name odds-snapshot-errors \
  --alarm-description "Alert if odds snapshot fails" \
  --metric-name Errors \
  --namespace AWS/Lambda \
  --statistic Sum \
  --period 300 \
  --evaluation-periods 1 \
  --threshold 1 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=FunctionName,Value=odds-pre-game-snapshot
```

---

## Alternative: Deploy via Infrastructure as Code

### Using AWS CDK

```typescript
// infrastructure/odds-lambda-stack.ts
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';

export class OddsLambdaStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const oddsFunction = new lambda.Function(this, 'OddsPreGameSnapshot', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/odds-pre-game-snapshot'),
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      environment: {
        PREFERRED_BOOKMAKER: 'draftkings',
      },
    });

    // Grant secrets access
    const dbSecret = secretsmanager.Secret.fromSecretNameV2(
      this, 'DbSecret', 'odds/supabase-db-url'
    );
    dbSecret.grantRead(oddsFunction);

    // Schedule daily at 09:05 ET (14:05 UTC)
    const rule = new events.Rule(this, 'DailyOddsSnapshot', {
      schedule: events.Schedule.cron({ minute: '5', hour: '14' }),
    });

    rule.addTarget(new targets.LambdaFunction(oddsFunction));
  }
}
```

---

## Cost Estimation

**Lambda:**
- Free tier: 1M requests/month, 400K GB-seconds
- Estimated: ~30 invocations/month × 2 minutes × 512 MB = ~1 GB-seconds
- **Cost: $0** (within free tier)

**EventBridge:**
- Free tier: 14M custom events/month
- Estimated: ~30 rules/month
- **Cost: $0** (within free tier)

**CloudWatch Logs:**
- Free tier: 5 GB ingestion, 5 GB storage
- Estimated: ~1 MB logs/month
- **Cost: $0** (within free tier)

**Total Estimated Cost: $0/month** (within free tier)

---

## Troubleshooting

### Lambda Timeout

**Issue:** Function times out before completing

**Solution:**
- Increase timeout: `--timeout 600` (10 minutes)
- Optimize database queries
- Process games in parallel batches

### Database Connection Issues

**Issue:** Can't connect to database

**Solution:**
- Check VPC configuration if database is in VPC
- Verify security group allows Lambda
- Check database URL in secrets
- Test connection from Lambda test event

### Missing Odds

**Issue:** Some games don't get odds

**Solution:**
- Check CloudWatch logs for errors
- Verify team name mapping
- Check if game exists in bbref_schedule
- Review staging_events for raw payloads

---

_Last updated: 2025-01-15_

