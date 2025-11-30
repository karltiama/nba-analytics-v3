# Creating Lambda Function via AWS Console (GUI Guide)

This guide walks you through creating and deploying your Lambda function using the AWS Management Console web interface.

## Prerequisites

- ✅ IAM role created (`lambda-odds-execution-role`) - see [IAM Role GUI Guide](./iam-role-gui-guide.md)
- ✅ Lambda function code ready (`lambda/odds-pre-game-snapshot/index.ts`)
- ✅ Environment variables ready (Supabase DB URL, Odds API key)
- ✅ AWS account with appropriate permissions

---

## Step 1: Package Your Lambda Function (Local)

Before creating the Lambda in AWS, you need to package your code and dependencies into a ZIP file.

### 1.1 Navigate to Lambda Directory

1. **Open terminal/command prompt**
2. **Navigate to your project root:**
   ```bash
   cd C:\Users\tiama\Desktop\Coding\nba-analytics-v3
   ```

3. **Go to Lambda function directory:**
   ```bash
   cd lambda/odds-pre-game-snapshot
   ```

**Why this step?**
- Lambda requires a ZIP file containing your code and all dependencies
- You need to be in the function directory to package everything correctly

### 1.2 Install Production Dependencies

1. **Install only production dependencies:**
   ```bash
   npm install --production
   ```

**Why `--production`?**
- Excludes dev dependencies (TypeScript, tsx, etc.) that aren't needed at runtime
- Reduces package size (faster uploads, faster cold starts)
- Lambda only needs runtime dependencies: `pg` and `zod`

**What gets installed:**
- `pg` - PostgreSQL client for Supabase
- `zod` - Schema validation
- Their dependencies

### 1.3 Compile TypeScript (If Needed)

**If your code is already compiled:**
- Skip this step if you have a `dist/` folder with compiled JavaScript

**If you need to compile:**
1. **Build the TypeScript:**
   ```bash
   npm run build
   ```
   - This runs `tsc` and creates `index.js` in the current directory or `dist/` folder

**Why compile?**
- Lambda runs JavaScript, not TypeScript
- TypeScript needs to be compiled to JavaScript before deployment
- The `build` script in `package.json` handles this

### 1.4 Create Deployment Package

**Option A: If using compiled TypeScript (dist folder):**
```bash
zip -r function.zip dist/ node_modules package.json
```

**Option B: If JavaScript is in root (index.js):**
```bash
zip -r function.zip index.js node_modules package.json
```

**On Windows (PowerShell), use:**
```powershell
Compress-Archive -Path index.js,node_modules,package.json -DestinationPath function.zip -Force
```

Or if using `dist/`:
```powershell
Compress-Archive -Path dist,node_modules,package.json -DestinationPath function.zip -Force
```

**What's included:**
- `index.js` or `dist/` - Your compiled Lambda handler code
- `node_modules/` - Runtime dependencies (pg, zod, etc.)
- `package.json` - Dependency manifest

**What's NOT included (and shouldn't be):**
- `node_modules/.bin/` - Not needed at runtime
- `*.ts` files - TypeScript source (not needed, only compiled JS)
- `tsconfig.json` - TypeScript config (not needed)
- `.env` files - Never include secrets in code!

**Verify package size:**
- Check that `function.zip` is created
- Size should be around 2-5 MB (pg library is ~2 MB)
- Lambda limit: 50 MB zipped, 250 MB unzipped

**Why this format?**
- Lambda expects a ZIP file with code at the root
- Dependencies must be in `node_modules/`
- Handler path is relative to ZIP root

---

## Step 2: Navigate to Lambda Console

1. **Sign in to AWS Console**
   - Go to [https://console.aws.amazon.com](https://console.aws.amazon.com)
   - Sign in with your AWS account credentials

2. **Open Lambda Service**
   - In the top search bar, type "Lambda" and select **Lambda** from the dropdown
   - Or navigate to: **Services** → **Compute** → **Lambda**

3. **Verify Region**
   - Check the region in the top right (e.g., `us-east-1`)
   - **Important:** Choose a region close to you (or where you want the function to run)
   - Lambda functions are region-specific

**Why this step?**
- Lambda is AWS's serverless compute service
- You'll create, configure, and monitor your function here
- Region matters for latency and data residency

---

## Step 3: Create Lambda Function

1. **Click "Create function" button**
   - Located at the top right of the Functions page
   - Blue button with "Create function" text

2. **Choose Creation Method**
   - You'll see three options:
     - ✅ **Author from scratch** (SELECT THIS)
     - Use a blueprint
     - Container image
   - Click the radio button for **Author from scratch**

**Why "Author from scratch"?**
- You already have your code written
- Blueprints are templates for common use cases (not needed here)
- Container images are for more complex deployments (overkill for this)

---

## Step 4: Configure Basic Settings

### 4.1 Basic Information

1. **Function name:**
   - Enter: `odds-pre-game-snapshot`
   - Use a descriptive name that indicates what the function does
   - Must be unique within your AWS account and region

2. **Runtime:**
   - Select: **Node.js 20.x** (or latest available)
   - This is the Node.js version Lambda will use to run your code
   - **Why Node.js 20.x?** Latest LTS, includes modern features, good performance

3. **Architecture:**
   - Select: **x86_64** (default)
   - ARM64 is available but x86_64 is more compatible
   - **Why x86_64?** Better compatibility with npm packages, especially native modules

### 4.2 Permissions

1. **Change default execution role:**
   - Expand the **"Change default execution role"** section
   - Select: **Use an existing role**
   - In the dropdown, select: **lambda-odds-execution-role**
   - (This is the role you created in the IAM guide)

**Why use existing role?**
- You already created the role with the right permissions
- Avoids creating duplicate roles
- Ensures consistent permissions

**If you don't see your role:**
- Make sure you're in the same AWS account
- Verify the role was created successfully
- Check the role name spelling

2. **Click "Create function"**
   - Bottom right of the page
   - This creates the function with basic settings (you'll configure more next)

**What happens:**
- Lambda creates the function with a basic "Hello World" template
- You'll replace this with your actual code in the next step
- Function is created but not ready to use yet

---

## Step 5: Upload Your Code

1. **You should see the function configuration page**
   - Function name at the top
   - Code source editor in the middle
   - Configuration tabs below

2. **Scroll to "Code source" section**
   - You'll see a code editor with a default "Hello World" function
   - You need to replace this with your actual code

3. **Upload your deployment package:**
   - Click the **"Upload from"** dropdown (next to "Test" button)
   - Select **".zip file"**
   - Click **"Upload"** button
   - Browse and select your `function.zip` file
   - Click **"Save"** when upload completes

**Alternative: Upload individual files (not recommended for production):**
- You can paste code directly, but this doesn't include `node_modules`
- Only use this for quick testing, not production

**What happens during upload:**
- AWS uploads your ZIP file
- Extracts it in Lambda's environment
- Validates the code structure
- Checks for the handler function

**Upload time:**
- Small packages (< 5 MB): 10-30 seconds
- Larger packages: 1-2 minutes
- Progress bar shows upload status

**If upload fails:**
- Check ZIP file size (must be < 50 MB)
- Verify ZIP contains `index.js` or `dist/` at root
- Ensure `node_modules/` is included
- Check that handler function exists

---

## Step 6: Configure Handler and Runtime

1. **Scroll to "Runtime settings" section**
   - Located below the code editor
   - Click **"Edit"** button

2. **Set Handler:**
   - **Handler:** `dist/index.handler` ⚠️ **IMPORTANT: Use `dist/index.handler` if code is in dist folder**
   - Format: `PATH/TO/FILENAME.EXPORTED_FUNCTION`
   - Since TypeScript compiles to `dist/index.js`, the handler path must include `dist/`
   - In your code: `export const handler = async (event) => { ... }`
   - This tells Lambda which function to call

3. **Verify Runtime:**
   - Should show: **Node.js 20.x**
   - If different, change it to match your code

4. **Click "Save"**

**Why this matters:**
- Handler is the entry point Lambda calls when function is invoked
- Must match your exported function name exactly
- Wrong handler = function won't run

---

## Step 7: Configure Environment Variables

1. **Go to "Configuration" tab**
   - Click **"Configuration"** tab at the top
   - Then click **"Environment variables"** in the left sidebar

2. **Click "Edit" button**
   - Top right of the Environment variables section

3. **Add Environment Variables:**
   - Click **"Add environment variable"** for each one:

   **Variable 1:**
   - **Key:** `SUPABASE_DB_URL`
   - **Value:** `postgresql://postgres:[PASSWORD]@[PROJECT].supabase.co:6543/postgres?pgbouncer=true`
   - **Important:** Use the **pooled connection** URL (port 6543) for better performance
   - Click the lock icon to mark as sensitive (optional, but recommended)

   **Variable 2:**
   - **Key:** `ODDS_API_KEY`
   - **Value:** `your_odds_api_key_here`
   - Click the lock icon to mark as sensitive

   **Variable 3:**
   - **Key:** `PREFERRED_BOOKMAKER`
   - **Value:** `draftkings`
   - This is not sensitive (just a preference)

   **Variable 4 (Optional):**
   - **Key:** `ODDS_API_BASE`
   - **Value:** `https://api.the-odds-api.com/v4`
   - Only needed if you want to override the default

4. **Click "Save"**
   - Bottom right

**Why environment variables?**
- Store configuration that changes between environments
- Keeps secrets out of code (better than hardcoding)
- Easy to update without redeploying code

**Security notes:**
- Environment variables are visible in Lambda console (anyone with read access can see them)
- For production, consider Secrets Manager (more secure)
- Mark sensitive variables with the lock icon (visual indicator only)

**Supabase connection string format:**
- **Pooled (recommended):** `postgresql://postgres:[PASSWORD]@[PROJECT].supabase.co:6543/postgres?pgbouncer=true`
- **Direct:** `postgresql://postgres:[PASSWORD]@[PROJECT].supabase.co:5432/postgres`
- **Why pooled?** Better for Lambda (avoids connection limits, faster)

---

## Step 8: Configure Function Settings

1. **Still in "Configuration" tab**
   - Click **"General configuration"** in the left sidebar
   - Click **"Edit"** button

2. **Set Timeout:**
   - **Timeout:** `5 min 0 sec` (or `300` seconds)
   - **Why 5 minutes?** Odds API calls + database writes can take 1-3 minutes for 10+ games
   - **Max allowed:** 15 minutes (900 seconds)
   - **Default:** 3 seconds (too short for this use case)

3. **Set Memory:**
   - **Memory:** `512 MB`
   - **Why 512 MB?** Good balance for database connections + API calls
   - **More memory = more CPU:** Lambda allocates CPU proportionally to memory
   - **Cost impact:** Higher memory = higher cost, but faster execution
   - **Recommended range:** 256-1024 MB for this function

4. **Ephemeral storage (optional):**
   - **Default:** 512 MB (usually sufficient)
   - Only increase if you're writing large temporary files

5. **Click "Save"**

**Why these settings matter:**
- **Timeout:** Prevents function from running indefinitely (cost control)
- **Memory:** Affects performance and cost (more memory = faster but more expensive)
- **Storage:** For temporary files (usually not needed for this function)

**Cost considerations:**
- Lambda charges per GB-second (memory × execution time)
- 512 MB for 2 minutes = 1 GB-second
- Very affordable for daily runs

---

## Step 9: Verify Configuration

1. **Review Function Summary:**
   - **Function name:** `odds-pre-game-snapshot` ✅
   - **Runtime:** Node.js 20.x ✅
   - **Handler:** `index.handler` ✅
   - **Role:** `lambda-odds-execution-role` ✅
   - **Timeout:** 5 minutes ✅
   - **Memory:** 512 MB ✅

2. **Review Environment Variables:**
   - Go to **Configuration** → **Environment variables**
   - Verify all 3-4 variables are present ✅
   - Check that values are correct (especially connection strings)

3. **Review Code:**
   - Go to **Code** tab
   - Verify your code is uploaded (not the default template)
   - Check that `index.js` or `dist/index.js` exists

**Checklist:**
- [ ] Function name is correct
- [ ] Runtime is Node.js 20.x
- [ ] Handler is `index.handler`
- [ ] IAM role is attached
- [ ] Timeout is 5 minutes
- [ ] Memory is 512 MB
- [ ] Environment variables are set (SUPABASE_DB_URL, ODDS_API_KEY, PREFERRED_BOOKMAKER)
- [ ] Code is uploaded (not default template)

---

## Step 10: Test the Function

1. **Go to "Test" tab**
   - Click **"Test"** tab at the top
   - You'll see a test event configuration

2. **Create Test Event:**
   - Click **"Create new event"**
   - **Event name:** `test-event`
   - **Event JSON:** Leave as empty object `{}` (your function doesn't need event data)
   - Click **"Save"**

3. **Run Test:**
   - Click **"Test"** button
   - Lambda will invoke your function
   - You'll see execution results

4. **Review Results:**
   - **Execution result:** Should show "succeeded" or "failed"
   - **Function Logs:** Shows console.log output
   - **Duration:** How long it took to run
   - **Billed Duration:** What you're charged for

**What to look for:**
- ✅ **Success:** Function runs without errors
- ✅ **Logs:** Should show "Starting pre-game odds snapshot..." and summary
- ✅ **Duration:** Should be 1-3 minutes for a full run
- ❌ **Errors:** Check logs for database connection issues, API errors, etc.

**Common issues:**
- **"Missing SUPABASE_DB_URL":** Environment variable not set correctly
- **"Connection timeout":** Database URL incorrect or network issue
- **"Missing ODDS_API_KEY":** API key not set in environment variables
- **"Handler not found":** Handler path incorrect or function not exported

**If test fails:**
- Check CloudWatch Logs (more detailed than test output)
- Verify environment variables are set correctly
- Check that database URL is accessible
- Verify API key is valid

---

## Step 11: View CloudWatch Logs

1. **Go to "Monitor" tab**
   - Click **"Monitor"** tab at the top
   - Shows metrics and recent invocations

2. **Click "View CloudWatch logs"**
   - Opens CloudWatch Logs in a new tab
   - Shows detailed execution logs

3. **Review Logs:**
   - Each invocation creates a log stream
   - Click on a log stream to see detailed output
   - Look for:
     - Function start/end
     - Database connection messages
     - API call results
     - Error messages (if any)

**Why CloudWatch Logs?**
- More detailed than test output
- Historical logs (kept for retention period)
- Better for debugging production issues
- Can set up alarms based on log patterns

---

## Step 12: Update Code (When Needed)

When you make changes to your Lambda function code:

1. **Package updated code:**
   ```bash
   cd lambda/odds-pre-game-snapshot
   npm install --production  # If dependencies changed
   npm run build  # If TypeScript changed
   zip -r function.zip index.js node_modules package.json
   # Or: zip -r function.zip dist/ node_modules package.json
   ```

2. **In Lambda Console:**
   - Go to **Code** tab
   - Click **"Upload from"** → **".zip file"**
   - Upload new `function.zip`
   - Click **"Save"**

3. **Test again:**
   - Run a test to verify changes work
   - Check CloudWatch logs for any issues

**Why this process?**
- Lambda doesn't auto-deploy from Git
- You must manually upload updated code
- Always test after updating

---

## Troubleshooting

### Issue: "Handler not found"
**Solution:**
- Verify handler is set to `index.handler`
- Check that `index.js` exists in ZIP root (not in subfolder)
- Ensure function is exported: `export const handler = ...`

### Issue: "Module not found" (e.g., "Cannot find module 'pg'")
**Solution:**
- `node_modules/` not included in ZIP
- Re-package with: `zip -r function.zip index.js node_modules package.json`
- Verify `node_modules/` folder exists locally

### Issue: "Connection timeout" to Supabase
**Solution:**
- Check `SUPABASE_DB_URL` environment variable is set correctly
- Verify database URL is accessible (test from local machine)
- Use pooled connection (port 6543) for better performance
- Check Supabase project is active (not paused)

### Issue: "Missing environment variable"
**Solution:**
- Go to **Configuration** → **Environment variables**
- Verify all required variables are set:
  - `SUPABASE_DB_URL`
  - `ODDS_API_KEY`
  - `PREFERRED_BOOKMAKER`
- Check for typos in variable names

### Issue: Function times out
**Solution:**
- Increase timeout in **Configuration** → **General configuration**
- Check CloudWatch logs for what's taking long
- Verify API calls are completing (not hanging)
- Check database queries aren't slow

### Issue: "Access denied" errors
**Solution:**
- Verify IAM role is attached correctly
- Check role has `AWSLambdaBasicExecutionRole` policy
- Ensure role ARN is correct

### Issue: ZIP file too large
**Solution:**
- Remove dev dependencies: `npm install --production`
- Don't include `.env`, `node_modules/.bin/`, or source files
- Use Lambda Layers for large dependencies (advanced)

---

## Next Steps

Now that your Lambda function is created and tested:

1. **Set up EventBridge schedule** - See [EventBridge GUI Guide](./eventbridge-schedule-gui-guide.md) (to be created)
2. **Monitor first scheduled run** - Check CloudWatch logs after first automatic execution
3. **Set up CloudWatch alarms** - Get notified of failures (optional)
4. **Review costs** - Lambda is very affordable, but good to monitor

---

## Summary

**What you created:**
- Lambda function: `odds-pre-game-snapshot`
- Configured with Node.js 20.x runtime
- Handler: `index.handler`
- IAM role: `lambda-odds-execution-role`
- Environment variables: Database URL, API key, preferences
- Settings: 5 min timeout, 512 MB memory

**Why each piece matters:**
- **Function name:** Identifies your function
- **Runtime:** Node.js version Lambda uses
- **Handler:** Entry point Lambda calls
- **IAM role:** Grants permissions (logs, secrets if needed)
- **Environment variables:** Configuration and secrets
- **Timeout/Memory:** Performance and cost settings

**Key takeaway:**
- Lambda is serverless - you just upload code and configure
- No servers to manage, scales automatically
- Pay only for execution time (very affordable for daily runs)

---

## Visual Checklist

Before moving to EventBridge scheduling, verify:

- [ ] Function created: `odds-pre-game-snapshot`
- [ ] Runtime: Node.js 20.x
- [ ] Handler: `index.handler`
- [ ] IAM role attached: `lambda-odds-execution-role`
- [ ] Environment variables set (SUPABASE_DB_URL, ODDS_API_KEY, PREFERRED_BOOKMAKER)
- [ ] Timeout: 5 minutes
- [ ] Memory: 512 MB
- [ ] Code uploaded (not default template)
- [ ] Test execution successful
- [ ] CloudWatch logs accessible

You're ready to schedule the function! 🚀

