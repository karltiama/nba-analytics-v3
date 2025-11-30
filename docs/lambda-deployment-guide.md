# Lambda Deployment Guide for Supabase

Step-by-step guide for deploying the odds snapshot Lambda functions to AWS, optimized for Supabase (managed PostgreSQL).

---

## Prerequisites

1. **AWS Account** with Lambda, EventBridge, and CloudWatch access
   - *Why:* These are the core AWS services needed for scheduled data fetching
   - *Cost:* All within free tier for this use case

2. **AWS CLI** installed and configured
   - *Why:* Command-line interface for deploying and managing AWS resources
   - *Alternative:* AWS Console (web UI), but CLI is faster for repeated operations

3. **Node.js 20+** installed locally
   - *Why:* Lambda runtime uses Node.js 20.x, and you need it to build/test locally
   - *Note:* Lambda supports Node.js 20.x, which includes native ESM support

4. **Supabase Database URL** (connection string)
   - *Why:* Your Lambda needs to connect to Supabase PostgreSQL
   - *Format:* `postgresql://postgres:[PASSWORD]@[PROJECT].supabase.co:5432/postgres`
   - *Note:* Supabase uses public endpoints (no VPC needed), but requires SSL

5. **Odds API Key**
   - *Why:* Required to authenticate with the-odds-api.com
   - *Get it from:* https://the-odds-api.com/

---

## Understanding the Architecture

**Why Lambda?**
- **Serverless:** No servers to manage, scales automatically
- **Cost-effective:** Pay only for execution time (free tier: 1M requests/month)
- **Reliable:** AWS manages infrastructure, 99.95% uptime SLA
- **Event-driven:** Perfect for scheduled tasks (daily odds fetching)

**Why EventBridge?**
- **Cron scheduling:** Built-in support for time-based triggers
- **Reliable:** AWS-managed scheduler, no missed triggers
- **Cost:** Free tier includes 14M custom events/month

**Why Supabase?**
- **Managed PostgreSQL:** No database administration needed
- **Public endpoints:** No VPC configuration required (simpler Lambda setup)
- **Connection pooling:** Built-in pgBouncer for efficient connections
- **SSL/TLS:** Secure connections out of the box

---

## Step 1: Prepare Lambda Function

### 1.1 Install Dependencies

```bash
cd lambda/odds-pre-game-snapshot
npm install
```

**Why this step?**
- Lambda needs all dependencies bundled with the function code
- `pg` (PostgreSQL client) and `zod` (validation) must be included
- Installing locally ensures compatibility before deployment

**What gets installed:**
- `pg@^8.13.1` - PostgreSQL client library (connects to Supabase)
- `zod@^3.23.8` - Runtime type validation (validates API responses)
- Dev dependencies (TypeScript, tsx) for local development

**Supabase-specific note:**
- Supabase uses standard PostgreSQL protocol, so `pg` works perfectly
- Connection string includes SSL parameters automatically
- No special configuration needed beyond the connection string

### 1.2 Build TypeScript (Optional)

```bash
npm run build
```

**Why this step?**
- TypeScript needs to be compiled to JavaScript for Lambda
- Creates `dist/index.js` from `index.ts`
- **Alternative:** Lambda with Node.js 20+ can run TypeScript directly using `tsx`, but compilation is more reliable

**When to skip:**
- If using `tsx` runtime (not recommended for production)
- If deploying via CDK/Serverless Framework (they handle compilation)

**Supabase-specific note:**
- No changes needed - Supabase connection works the same in compiled JS

### 1.3 Test Locally

```bash
# Set environment variables (PowerShell)
$env:SUPABASE_DB_URL="postgresql://postgres:[PASSWORD]@[PROJECT].supabase.co:5432/postgres"
$env:ODDS_API_KEY="your_api_key"

# Run locally
npx tsx index.ts
```

**Why this step?**
- **Catch errors early:** Test database connection, API calls, and logic before deploying
- **Faster iteration:** Fix issues locally instead of deploying repeatedly
- **Cost savings:** Avoid Lambda invocations during development

**What to verify:**
- ✅ Connects to Supabase successfully
- ✅ Fetches odds from API
- ✅ Stores data in `staging_events` and `markets` tables
- ✅ Handles errors gracefully (missing games, API failures)

**Supabase connection tips:**
- Use the **Connection Pooling** URL if available (port 6543) for better performance
- Format: `postgresql://postgres:[PASSWORD]@[PROJECT].supabase.co:6543/postgres?pgbouncer=true`
- Direct connection (port 5432) also works but has connection limits
- SSL is required and enabled by default in Supabase

---

## Step 2: Create IAM Role for Lambda

> **💡 Prefer using the AWS Console GUI?** See [IAM Role GUI Guide](./iam-role-gui-guide.md) for step-by-step instructions with screenshots and detailed explanations.

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

**Why this step?**
- **Security:** Lambda functions need an IAM role to access AWS services
- **Principle of least privilege:** Role defines what the function can do
- **No user credentials:** Lambda uses the role, not your personal AWS keys

**What this does:**
- Creates a role that Lambda service can "assume" (use)
- The role itself doesn't grant permissions yet (next step adds them)
- This is AWS's way of giving Lambda an identity

**Supabase-specific note:**
- Supabase is external to AWS, so no special AWS permissions needed for database access
- The role only needs permissions for AWS services (CloudWatch logs, Secrets Manager)

### 2.2 Attach Basic Execution Policy

```bash
aws iam attach-role-policy \
  --role-name lambda-odds-execution-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
```

**Why this step?**
- **CloudWatch Logs:** Lambda needs permission to write logs
- **Monitoring:** Without this, you can't see function output or errors
- **Debugging:** Essential for troubleshooting failed runs

**What this policy grants:**
- `logs:CreateLogGroup` - Creates log group if it doesn't exist
- `logs:CreateLogStream` - Creates log streams for each invocation
- `logs:PutLogEvents` - Writes log entries to CloudWatch

**Why not skip:**
- Lambda will fail silently without log permissions
- You won't know if the function runs or what errors occur

### 2.3 VPC Access (NOT NEEDED FOR SUPABASE)

**Why skip this step?**
- Supabase databases are **publicly accessible** (no VPC required)
- Lambda can connect directly via HTTPS/SSL
- VPC configuration adds complexity and cold start latency
- **Only needed if:** Your database is in a private VPC (not Supabase)

**If you had a private database:**
- Would need VPC configuration
- Lambda would need ENI (Elastic Network Interface)
- Adds ~1-3 seconds to cold starts
- More complex networking setup

---

## Step 3: Store Secrets

### Why Store Secrets Separately?

**Security best practices:**
- Never hardcode credentials in code
- Secrets Manager/SSM encrypt secrets at rest
- Audit trail of who accessed secrets
- Easy rotation without code changes

**Why not environment variables?**
- Environment variables are visible in Lambda console
- Anyone with Lambda read access can see them
- No encryption at rest
- Harder to rotate

### Option A: AWS Secrets Manager (Recommended)

```bash
# Store Supabase database URL
aws secretsmanager create-secret \
  --name odds/supabase-db-url \
  --secret-string "postgresql://postgres:[PASSWORD]@[PROJECT].supabase.co:5432/postgres"

# Store Odds API key
aws secretsmanager create-secret \
  --name odds/api-key \
  --secret-string "your_odds_api_key"
```

**Why Secrets Manager?**
- **Automatic rotation:** Can set up automatic credential rotation
- **Audit logging:** CloudTrail logs all secret access
- **Versioning:** Keeps history of secret values
- **Cost:** $0.40/month per secret (first 10,000 API calls free)

**Supabase connection string format:**
- Direct connection: `postgresql://postgres:[PASSWORD]@[PROJECT].supabase.co:5432/postgres`
- Pooled connection: `postgresql://postgres:[PASSWORD]@[PROJECT].supabase.co:6543/postgres?pgbouncer=true`
- **Recommendation:** Use pooled connection (port 6543) for Lambda to avoid connection limits

### Option B: SSM Parameter Store

```bash
# Store Supabase database URL
aws ssm put-parameter \
  --name /odds/supabase-db-url \
  --value "postgresql://postgres:[PASSWORD]@[PROJECT].supabase.co:5432/postgres" \
  --type SecureString

# Store Odds API key
aws ssm put-parameter \
  --name /odds/api-key \
  --value "your_odds_api_key" \
  --type SecureString
```

**Why SSM Parameter Store?**
- **Cost:** Free for standard parameters (SecureString)
- **Simple:** Easier to use than Secrets Manager
- **Good enough:** For non-rotating secrets like API keys

**When to use SSM vs Secrets Manager:**
- **SSM:** Simple secrets that don't rotate (API keys, connection strings)
- **Secrets Manager:** Secrets that need rotation (database passwords, OAuth tokens)

**For this use case:** SSM is fine (API key and connection string don't rotate often)

---

## Step 4: Package and Deploy Lambda

> **💡 Prefer using the AWS Console GUI?** See [Lambda Creation GUI Guide](./lambda-creation-gui-guide.md) for step-by-step instructions with detailed explanations for creating and configuring your Lambda function via the web interface.

### 4.1 Package Function

```bash
cd lambda/odds-pre-game-snapshot

# Install production dependencies only (smaller package)
npm install --production

# Create deployment package
zip -r function.zip index.js node_modules package.json

# Or if using compiled TypeScript
zip -r function.zip dist/ node_modules package.json
```

**Why this step?**
- Lambda requires a ZIP file containing code + dependencies
- **Production only:** Excludes dev dependencies (TypeScript, tsx) to reduce size
- **Size limit:** Lambda deployment package max 50 MB (unzipped: 250 MB)
- Smaller packages = faster cold starts

**What's included:**
- `index.js` - Your Lambda handler code
- `node_modules/` - Runtime dependencies (pg, zod)
- `package.json` - Dependency manifest

**Supabase-specific:**
- `pg` library is ~2 MB, well within limits
- No special packaging needed for Supabase

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

**Parameter explanations:**

- **`--function-name`**: Unique name for your Lambda function
  - *Why:* Used to identify and invoke the function
  - *Naming:* Use descriptive names (e.g., `odds-pre-game-snapshot`)

- **`--runtime nodejs20.x`**: Node.js version
  - *Why:* Lambda needs to know which runtime to use
  - *Version choice:* Node.js 20.x is latest LTS, includes modern features

- **`--role`**: IAM role ARN (from Step 2)
  - *Why:* Grants Lambda permissions to access AWS services
  - *Format:* `arn:aws:iam::ACCOUNT_ID:role/ROLE_NAME`

- **`--handler index.handler`**: Entry point function
  - *Why:* Lambda needs to know which function to call
  - *Format:* `FILENAME.EXPORTED_FUNCTION`
  - *In our code:* `export const handler = async (event) => { ... }`

- **`--timeout 300`**: 5 minutes max execution time
  - *Why:* Prevents runaway functions from running indefinitely
  - *Why 5 min:* Odds API calls + database writes can take 1-3 minutes for 10+ games
  - *Max:* 15 minutes (900 seconds)

- **`--memory-size 512`**: 512 MB RAM allocation
  - *Why:* More memory = more CPU (Lambda allocates CPU proportionally)
  - *Why 512 MB:* Good balance for database connections + API calls
  - *Cost impact:* Higher memory = higher cost, but faster execution

- **`--environment Variables`**: Non-sensitive configuration
  - *Why:* Store config that changes between environments
  - *What's safe:* Bookmaker preference, API base URL
  - *What's NOT safe:* Passwords, API keys (use Secrets Manager)

**Supabase connection considerations:**
- Lambda connects to Supabase over public internet (HTTPS)
- No VPC configuration needed
- Connection pooling recommended (use port 6543)
- Timeout of 300 seconds is sufficient for database operations

### 4.3 Grant Secrets Access (if using Secrets Manager)

```bash
# Create policy document
cat > secrets-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["secretsmanager:GetSecretValue"],
    "Resource": [
      "arn:aws:secretsmanager:REGION:ACCOUNT:secret:odds/supabase-db-url-*",
      "arn:aws:secretsmanager:REGION:ACCOUNT:secret:odds/api-key-*"
    ]
  }]
}
EOF

# Attach policy to role
aws iam put-role-policy \
  --role-name lambda-odds-execution-role \
  --policy-name SecretsAccess \
  --policy-document file://secrets-policy.json
```

**Why this step?**
- Lambda role needs explicit permission to read secrets
- **Principle of least privilege:** Only grant access to specific secrets
- **Security:** Prevents Lambda from accessing other secrets

**What this grants:**
- `secretsmanager:GetSecretValue` - Read secret values
- Scoped to only `odds/*` secrets (not all secrets)

**If using SSM Parameter Store:**
```bash
aws iam put-role-policy \
  --role-name lambda-odds-execution-role \
  --policy-name SSMAccess \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Action": ["ssm:GetParameter", "ssm:GetParameters"],
      "Resource": [
        "arn:aws:ssm:REGION:ACCOUNT:parameter/odds/*"
      ]
    }]
  }'
```

### 4.4 Update Lambda Code to Read Secrets

**Why modify the code?**
- Current code reads from environment variables
- Need to fetch from Secrets Manager/SSM instead
- More secure and follows AWS best practices

**Option A: Fetch secrets at handler start (recommended)**

```typescript
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const secretsClient = new SecretsManagerClient({});
let cachedDbUrl: string | null = null;
let cachedApiKey: string | null = null;

async function getSecret(secretName: string): Promise<string> {
  const response = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: secretName })
  );
  return response.SecretString || '';
}

export const handler = async (event: LambdaEvent) => {
  // Fetch secrets (cache for warm invocations)
  if (!cachedDbUrl) {
    cachedDbUrl = await getSecret('odds/supabase-db-url');
    cachedApiKey = await getSecret('odds/api-key');
  }

  const pool = new Pool({ connectionString: cachedDbUrl });
  // ... rest of handler
};
```

**Why cache secrets?**
- Secrets Manager calls add ~100-200ms latency
- Lambda containers are reused (warm starts)
- Cache secrets in module scope for warm invocations
- **Trade-off:** Slightly stale secrets vs. performance (acceptable for this use case)

**Option B: Use environment variables (simpler, less secure)**

If you prefer simplicity and secrets don't rotate:
```bash
aws lambda update-function-configuration \
  --function-name odds-pre-game-snapshot \
  --environment Variables="{
    SUPABASE_DB_URL=postgresql://...,
    ODDS_API_KEY=...,
    PREFERRED_BOOKMAKER=draftkings
  }"
```

**When to use this:**
- Development/testing environments
- Secrets that don't change often
- Simpler code (no Secrets Manager SDK needed)

---

## Step 5: Set Up EventBridge Schedule

### 5.1 Create EventBridge Rule

```bash
# For EST (Nov-Mar): 09:05 ET = 14:05 UTC
aws events put-rule \
  --name odds-pre-game-snapshot-daily \
  --schedule-expression "cron(5 14 * * ? *)" \
  --description "Daily pre-game odds snapshot at 09:05 ET" \
  --state ENABLED

# For EDT (Mar-Nov): 09:05 ET = 13:05 UTC
# aws events put-rule \
#   --name odds-pre-game-snapshot-daily \
#   --schedule-expression "cron(5 13 * * ? *)" \
#   --description "Daily pre-game odds snapshot at 09:05 ET" \
#   --state ENABLED
```

**Why EventBridge?**
- **Reliable scheduling:** AWS-managed cron service
- **No missed triggers:** More reliable than cron on a server
- **Cost-effective:** Free tier includes 14M events/month
- **Time zone handling:** Cron uses UTC, but you can adjust for DST

**Why 09:05 ET?**
- **After game scheduling:** NBA schedules are usually finalized by 9 AM ET
- **Before games start:** Most games start 7 PM ET or later
- **Buffer time:** 5 minutes after 9 AM gives time for schedule updates
- **Odds availability:** Odds API typically has odds by 9 AM

**Cron expression breakdown:**
- `cron(5 14 * * ? *)` = "At 14:05 UTC every day"
- Format: `minute hour day month day-of-week year`
- `?` = "no specific value" (used when you specify day OR day-of-week)

**DST handling:**
- EventBridge cron is UTC-only (no timezone support)
- **Solution:** Update the rule twice a year, or use two rules
- **Alternative:** Use `rate(24 hours)` and check time in Lambda (less precise)

### 5.2 Add Lambda Permission

```bash
aws lambda add-permission \
  --function-name odds-pre-game-snapshot \
  --statement-id allow-eventbridge-invoke \
  --action lambda:InvokeFunction \
  --principal events.amazonaws.com \
  --source-arn arn:aws:events:REGION:ACCOUNT:rule/odds-pre-game-snapshot-daily
```

**Why this step?**
- **Security:** Lambda functions are private by default
- **Resource-based policy:** Grants EventBridge permission to invoke Lambda
- **Principle of least privilege:** Only this specific EventBridge rule can invoke

**What happens without this:**
- EventBridge tries to invoke Lambda
- Lambda rejects the request (403 Forbidden)
- Function never runs

**The permission:**
- `events.amazonaws.com` = EventBridge service
- `source-arn` = Only this specific rule can invoke (not all EventBridge rules)

### 5.3 Add Lambda as Target

```bash
aws events put-targets \
  --rule odds-pre-game-snapshot-daily \
  --targets "Id=1,Arn=arn:aws:lambda:REGION:ACCOUNT:function:odds-pre-game-snapshot"
```

**Why this step?**
- **Links rule to function:** Tells EventBridge which Lambda to invoke
- **Completes the chain:** Rule → Target → Lambda execution
- **Can have multiple targets:** One rule can trigger multiple Lambdas (not needed here)

**What this does:**
- When the cron schedule fires, EventBridge invokes the Lambda
- Passes the event payload (empty `{}` in our case)
- Lambda handler receives the event and processes it

---

## Step 6: Test Lambda

### 6.1 Test via AWS Console

1. Go to Lambda console → Functions → `odds-pre-game-snapshot`
2. Click "Test" tab
3. Create test event: `{}` (empty JSON object)
4. Click "Test"
5. View execution results and logs

**Why test manually first?**
- **Verify deployment:** Ensure function was deployed correctly
- **Check errors:** See immediate feedback if something's wrong
- **Validate secrets:** Confirm secrets are accessible
- **Test Supabase connection:** Verify database connectivity

**What to check:**
- ✅ Function executes without errors
- ✅ Connects to Supabase successfully
- ✅ Fetches odds from API
- ✅ Stores data in database
- ✅ Returns success response

### 6.2 Test via CLI

```bash
aws lambda invoke \
  --function-name odds-pre-game-snapshot \
  --payload '{}' \
  response.json

cat response.json
```

**Why use CLI?**
- **Automation:** Can be scripted for CI/CD
- **Quick testing:** Faster than console for repeated tests
- **Integration:** Can be called from other scripts

**Expected response:**
```json
{
  "statusCode": 200,
  "body": {
    "success": true,
    "date": "2025-01-15",
    "eventsFetched": 11,
    "marketsProcessed": 594,
    "eventsSkipped": 0,
    "errors": 0
  }
}
```

### 6.3 Verify Data in Supabase

```sql
-- Check staging_events
SELECT COUNT(*), MAX(fetched_at) 
FROM staging_events 
WHERE source = 'oddsapi' 
  AND fetched_at > NOW() - INTERVAL '1 hour';

-- Check markets
SELECT 
  COUNT(*) as total_markets,
  COUNT(DISTINCT game_id) as games_with_odds,
  bookmaker,
  market_type
FROM markets
WHERE snapshot_type = 'pre_game'
  AND fetched_at > NOW() - INTERVAL '1 hour'
GROUP BY bookmaker, market_type;
```

**Why verify in database?**
- **End-to-end test:** Confirms entire pipeline works
- **Data quality:** Verifies correct data was stored
- **Debugging:** If Lambda succeeds but data is wrong, check here

---

## Step 7: Monitor and Debug

### 7.1 CloudWatch Logs

```bash
# View recent logs
aws logs tail /aws/lambda/odds-pre-game-snapshot --follow

# Or in AWS Console:
# CloudWatch > Log Groups > /aws/lambda/odds-pre-game-snapshot
```

**Why monitor logs?**
- **Debugging:** See what the function is doing
- **Error tracking:** Identify failures and their causes
- **Performance:** Check execution time, database query performance
- **Supabase connection:** Verify connection strings, query success

**What to look for:**
- ✅ "Starting pre-game odds snapshot..."
- ✅ "Fetched X events from Odds API"
- ✅ "Summary: { marketsProcessed: X, errors: 0 }"
- ❌ Connection errors (check Supabase URL)
- ❌ API errors (check Odds API key)
- ❌ Database errors (check table permissions)

**Log retention:**
- Default: Logs kept forever (can be expensive)
- **Recommendation:** Set retention to 7-30 days
```bash
aws logs put-retention-policy \
  --log-group-name /aws/lambda/odds-pre-game-snapshot \
  --retention-in-days 7
```

### 7.2 CloudWatch Metrics

**Why monitor metrics?**
- **Health checks:** See if function is running regularly
- **Error rate:** Track failures over time
- **Performance:** Monitor execution duration
- **Cost:** Track invocations (billing)

**Key metrics:**
- **Invocations:** Should be 1 per day (or 0 if no games)
- **Errors:** Should be 0 (investigate if > 0)
- **Duration:** Typically 30-120 seconds (investigate if > 300 seconds)
- **Throttles:** Should be 0 (indicates concurrency limits hit)

**View metrics:**
- AWS Console: Lambda → Function → Monitoring tab
- CloudWatch: Metrics → Lambda → By Function Name

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
  --dimensions Name=FunctionName,Value=odds-pre-game-snapshot \
  --alarm-actions arn:aws:sns:REGION:ACCOUNT:topic-name
```

**Why set up alarms?**
- **Proactive monitoring:** Get notified when things break
- **Early detection:** Catch issues before users notice
- **Automation:** Can trigger auto-remediation (retry, notifications)

**What this alarm does:**
- Monitors `Errors` metric for the Lambda
- Triggers if errors > 0 in a 5-minute period
- Sends notification to SNS topic (email, Slack, etc.)

**Additional alarms to consider:**
- **No invocations:** Function didn't run (EventBridge issue?)
- **High duration:** Function taking too long (timeout risk)
- **Database connection failures:** Supabase connectivity issues

---

## Supabase-Specific Considerations

### Connection Pooling

**Why use connection pooling?**
- **Connection limits:** Supabase has connection limits per project
- **Lambda concurrency:** Multiple Lambda invocations = multiple connections
- **Efficiency:** Pooling reuses connections, reducing overhead

**How to use:**
- Use port **6543** (pooled) instead of **5432** (direct)
- Connection string: `postgresql://postgres:[PASSWORD]@[PROJECT].supabase.co:6543/postgres?pgbouncer=true`
- **Note:** Some PostgreSQL features disabled in pooler mode (prepared statements, transactions)

**For this Lambda:**
- We use simple queries (no complex transactions)
- Pooling is recommended to avoid connection limits
- If you hit limits, consider:
  - Increasing Supabase plan
  - Reducing Lambda concurrency
  - Using direct connection (port 5432) with connection limits

### SSL/TLS

**Why SSL is required:**
- Supabase enforces SSL for all connections
- Protects data in transit
- Required by default (can't disable)

**How it works:**
- `pg` library automatically uses SSL when connecting to Supabase
- No additional configuration needed
- Connection string includes SSL parameters

### Connection Timeouts

**Why set timeouts?**
- **Network issues:** Prevents hanging on slow/unreachable connections
- **Resource cleanup:** Ensures connections are released
- **Lambda limits:** Function timeout (5 min) should be > connection timeout

**Recommended settings:**
```typescript
const pool = new Pool({
  connectionString: SUPABASE_DB_URL,
  connectionTimeoutMillis: 10000, // 10 seconds
  idleTimeoutMillis: 30000, // 30 seconds
  max: 5, // Max connections per Lambda instance
});
```

**Why these values:**
- `connectionTimeoutMillis: 10000` - Fail fast if Supabase is unreachable
- `idleTimeoutMillis: 30000` - Close idle connections quickly
- `max: 5` - Limit connections per Lambda (pooler handles rest)

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

**Secrets Manager (if used):**
- $0.40/month per secret
- 2 secrets = $0.80/month
- **Alternative:** SSM Parameter Store (free)

**Supabase:**
- Your existing Supabase plan (not AWS cost)
- Connection pooling helps stay within limits

**Total Estimated AWS Cost: $0-1/month** (depending on secrets storage)

---

## Troubleshooting

### Lambda Timeout

**Issue:** Function times out before completing

**Symptoms:**
- CloudWatch logs show "Task timed out"
- Partial data in database (some games processed, others not)

**Solutions:**
1. **Increase timeout:**
   ```bash
   aws lambda update-function-configuration \
     --function-name odds-pre-game-snapshot \
     --timeout 600
   ```

2. **Optimize database queries:**
   - Use batch inserts instead of individual inserts
   - Add database indexes for faster lookups

3. **Process in parallel:**
   - Fetch odds for all games first
   - Process games in parallel batches

**Supabase-specific:**
- Check Supabase dashboard for slow queries
- Verify connection pooling is working
- Check if you're hitting connection limits

### Database Connection Issues

**Issue:** Can't connect to Supabase

**Symptoms:**
- CloudWatch logs show "Connection refused" or "timeout"
- Lambda fails immediately on startup

**Solutions:**
1. **Verify connection string:**
   - Check Supabase dashboard → Settings → Database
   - Ensure password is correct
   - Use pooled connection (port 6543)

2. **Check Supabase status:**
   - Visit https://status.supabase.com
   - Verify your project is active

3. **Test connection locally:**
   ```bash
   psql "postgresql://postgres:[PASSWORD]@[PROJECT].supabase.co:5432/postgres"
   ```

4. **Check network:**
   - Lambda needs internet access (default)
   - No VPC configuration needed for Supabase

**Common mistakes:**
- Wrong password in connection string
- Using direct connection (port 5432) when hitting limits
- Connection string missing SSL parameters

### Missing Odds

**Issue:** Some games don't get odds

**Symptoms:**
- Lambda succeeds but some games have no odds in database
- `eventsSkipped > 0` in Lambda response

**Solutions:**
1. **Check CloudWatch logs:**
   - Look for "Could not map teams" warnings
   - Look for "Could not find game" warnings

2. **Verify team name mapping:**
   - Check `ODDS_API_TEAM_TO_ABBR` in Lambda code
   - Ensure Odds API team names match mapping

3. **Check bbref_schedule:**
   ```sql
   SELECT * FROM bbref_schedule 
   WHERE game_date = CURRENT_DATE
     AND (home_team_abbr = 'TEAM' OR away_team_abbr = 'TEAM');
   ```

4. **Review staging_events:**
   ```sql
   SELECT payload->>'home_team', payload->>'away_team'
   FROM staging_events
   WHERE source = 'oddsapi'
     AND fetched_at > NOW() - INTERVAL '1 day'
     AND processed = false;
   ```

**Why this happens:**
- Team name mismatches between Odds API and bbref_schedule
- Games not yet in bbref_schedule when Lambda runs
- Odds API doesn't have odds for all games

---

## Next Steps

1. **Test the deployment** - Run Lambda manually and verify data
2. **Wait for scheduled run** - Check CloudWatch logs after 09:05 ET
3. **Set up monitoring** - Create CloudWatch alarms
4. **Add closing line snapshot** - Create second Lambda for closing odds
5. **Optimize** - Monitor performance and adjust timeouts/memory as needed

---

_Last updated: 2025-01-15_
