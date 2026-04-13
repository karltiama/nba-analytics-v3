# Creating IAM Role for Lambda via AWS Console (GUI Guide)

This guide walks you through creating an IAM role for your Lambda function using the AWS Management Console web interface.

## Prerequisites

- AWS account with appropriate permissions
- Access to AWS Management Console
- Basic understanding of IAM roles and policies

---

## Step 1: Navigate to IAM Console

1. **Sign in to AWS Console**
   - Go to [https://console.aws.amazon.com](https://console.aws.amazon.com)
   - Sign in with your AWS account credentials

2. **Open IAM Service**
   - In the top search bar, type "IAM" and select **IAM** from the dropdown
   - Or navigate to: **Services** → **Security, Identity, & Compliance** → **IAM**

3. **Go to Roles Section**
   - In the left sidebar, click **Roles**
   - You'll see a list of existing roles (if any)

**Why this step?**
- IAM (Identity and Access Management) is where you manage permissions
- Roles define what AWS services can do (like Lambda accessing other AWS services)
- This is separate from user permissions - roles are for services, not people

---

## Step 2: Create New Role

1. **Click "Create role" button**
   - Located at the top right of the Roles page
   - Blue button with "Create role" text

2. **Select Trusted Entity Type**
   - You'll see three options:
     - ✅ **AWS service** (SELECT THIS)
     - Custom trust policy
     - Web identity
   - Click the radio button next to **AWS service**

3. **Choose Use Case**
   - Under "Use case" dropdown, select **Lambda**
   - This automatically configures the trust policy for Lambda service

**What this does:**
- Creates a "trust relationship" that allows the Lambda service to "assume" (use) this role
- Think of it like giving Lambda an identity card that says "I'm allowed to use this role"
- Without this, Lambda can't use the role, even if it has permissions

**Why Lambda service?**
- Lambda functions run in AWS's infrastructure
- They need an identity (role) to access other AWS services
- This is AWS's security model: services authenticate using roles, not user credentials

---

## Step 3: Configure Trust Policy (Review)

1. **Review the Trust Policy**
   - You should see a policy document that looks like this:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Principal": {
           "Service": "lambda.amazonaws.com"
         },
         "Action": "sts:AssumeRole"
       }
     ]
   }
   ```
   - This is automatically generated when you select "Lambda" use case
   - **No changes needed** - this is correct

2. **Click "Next"**
   - Bottom right of the page

**What this policy means:**
- `"Principal": { "Service": "lambda.amazonaws.com" }` - Only the Lambda service can use this role
- `"Action": "sts:AssumeRole"` - Lambda can "assume" (take on) this role's identity
- This is the foundation - it doesn't grant permissions yet, just establishes trust

---

## Step 4: Add Permissions (Policies)

This is where you grant the role actual permissions. You'll add multiple policies.

### 4.1 Add Basic Execution Policy (Required)

1. **Search for Basic Execution Policy**
   - In the search box, type: `AWSLambdaBasicExecutionRole`
   - You should see it appear in the list

2. **Select the Policy**
   - Check the checkbox next to **AWSLambdaBasicExecutionRole**
   - This is an AWS managed policy (pre-built by AWS)

3. **Review what it grants:**
   - `logs:CreateLogGroup` - Creates CloudWatch log groups
   - `logs:CreateLogStream` - Creates log streams
   - `logs:PutLogEvents` - Writes log entries
   - **Why needed:** Lambda needs to write logs to CloudWatch so you can see what's happening

**Why this is required:**
- Without this, Lambda can't write logs
- You won't see any output, errors, or debugging information
- Essential for troubleshooting and monitoring

### 4.2 Add Secrets Manager Policy (If Using Secrets Manager)

> **⚠️ SKIP THIS SECTION if you're using environment variables!**
> 
> You only need Secrets Manager permissions if you're storing credentials in AWS Secrets Manager. If you're using environment variables in Lambda (simpler approach), you can skip this entire section and go straight to Step 4.4.

**Skip this if you're using environment variables or SSM Parameter Store**

1. **Create Custom Policy for Secrets Manager**
   - Click **"Create policy"** button (opens in new tab)
   - This takes you to the Policy creation page

2. **Switch to JSON Tab**
   - Click the **JSON** tab (instead of Visual editor)

3. **Paste this Policy:**
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": [
           "secretsmanager:GetSecretValue"
         ],
         "Resource": [
           "arn:aws:secretsmanager:*:*:secret:odds/*"
         ]
       }
     ]
   }
   ```

4. **Configure Policy Details**
   - Click **"Next"** button
   - **Policy name:** `LambdaOddsSecretsAccess`
   - **Description:** `Allows Lambda to read odds-related secrets from Secrets Manager`
   - Click **"Create policy"**

5. **Return to Role Creation**
   - Go back to the role creation tab
   - Click the refresh icon (🔄) next to the search box
   - Search for: `LambdaOddsSecretsAccess`
   - Check the checkbox next to your custom policy

**What this grants:**
- `secretsmanager:GetSecretValue` - Read secret values
- Scoped to only `odds/*` secrets (not all secrets in your account)
- **Security:** Principle of least privilege - only access what's needed

**Why Secrets Manager?**
- More secure than environment variables (encrypted at rest)
- Audit trail of who accessed secrets
- Can rotate secrets automatically
- Cost: $0.40/month per secret

### 4.3 Add SSM Parameter Store Policy (If Using SSM)

> **⚠️ SKIP THIS SECTION if you're using environment variables!**
> 
> You only need SSM permissions if you're storing credentials in AWS Systems Manager Parameter Store. If you're using environment variables in Lambda (simpler approach), you can skip this entire section and go straight to Step 4.4.

**Skip this if you're using environment variables or Secrets Manager**

1. **Create Custom Policy for SSM**
   - Click **"Create policy"** button (opens in new tab)

2. **Switch to JSON Tab**
   - Click the **JSON** tab

3. **Paste this Policy:**
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": [
           "ssm:GetParameter",
           "ssm:GetParameters"
         ],
         "Resource": [
           "arn:aws:ssm:*:*:parameter/odds/*"
         ]
       }
     ]
   }
   ```

4. **Configure Policy Details**
   - Click **"Next"**
   - **Policy name:** `LambdaOddsSSMAccess`
   - **Description:** `Allows Lambda to read odds-related parameters from SSM`
   - Click **"Create policy"**

5. **Return to Role Creation**
   - Go back to the role creation tab
   - Click refresh (🔄)
   - Search for: `LambdaOddsSSMAccess`
   - Check the checkbox

**What this grants:**
- `ssm:GetParameter` - Read a single parameter
- `ssm:GetParameters` - Read multiple parameters at once
- Scoped to only `/odds/*` parameters

**Why SSM Parameter Store?**
- Free for standard parameters
- Simpler than Secrets Manager
- Good for non-rotating secrets (API keys, connection strings)
- **Cost:** Free (vs $0.40/month for Secrets Manager)

### 4.4 Continue After Adding Policies

1. **Review Selected Policies**
   - **If using environment variables (simplest):**
     - ✅ `AWSLambdaBasicExecutionRole` (required - this is all you need!)
   - **If using Secrets Manager:**
     - ✅ `AWSLambdaBasicExecutionRole` (required)
     - ✅ `LambdaOddsSecretsAccess` (custom policy you created)
   - **If using SSM Parameter Store:**
     - ✅ `AWSLambdaBasicExecutionRole` (required)
     - ✅ `LambdaOddsSSMAccess` (custom policy you created)

2. **Click "Next"**
   - Bottom right of the page

**Summary of what you've done:**
- **Trust policy:** Allows Lambda service to use this role
- **Execution policy:** Allows Lambda to write logs
- **Secrets policy (optional):** Allows Lambda to read secrets if needed

---

## Step 5: Name and Review Role

1. **Enter Role Name**
   - **Role name:** `lambda-odds-execution-role`
   - Use a descriptive name that indicates:
     - It's for Lambda (`lambda-`)
     - It's for odds functionality (`odds-`)
     - It's an execution role (`execution-role`)

2. **Add Description (Optional but Recommended)**
   - **Description:** `Execution role for Lambda function that fetches and stores NBA odds from Odds API to Supabase`
   - Helps you remember what this role is for later

3. **Review Trust Policy**
   - Should show: `lambda.amazonaws.com` can assume this role
   - ✅ Correct

4. **Review Permissions**
   - Should list the policies you selected
   - ✅ Verify they're correct

5. **Click "Create role"**
   - Bottom right of the page

**Why naming matters:**
- You'll reference this role when creating the Lambda function
- Good naming makes it easy to find and manage later
- Follows AWS naming conventions

---

## Step 6: Verify Role Creation

1. **You should see a success message**
   - "Role `lambda-odds-execution-role` has been created"

2. **Click on the role name** (or find it in the Roles list)

3. **Review Role Details**
   - **Trust relationships tab:** Should show `lambda.amazonaws.com`
   - **Permissions tab:** Should show your selected policies
   - **Summary tab:** Shows role ARN (you'll need this later)

4. **Copy the Role ARN**
   - Format: `arn:aws:iam::YOUR_ACCOUNT_ID:role/lambda-odds-execution-role`
   - You'll need this when creating the Lambda function
   - Click the copy icon (📋) next to the ARN

**What you've accomplished:**
- ✅ Created a role that Lambda can use
- ✅ Granted permissions for CloudWatch logs (required)
- ✅ Granted permissions for secrets (if using Secrets Manager/SSM)
- ✅ Ready to attach to your Lambda function

---

## Step 7: Optional - Add Tags

1. **Click "Tags" tab** (optional but recommended)

2. **Add Tags:**
   - **Key:** `Project` → **Value:** `nba-analytics`
   - **Key:** `Function` → **Value:** `odds-pre-game-snapshot`
   - **Key:** `Environment` → **Value:** `production` (or `development`)

3. **Click "Save changes"**

**Why tags?**
- Helps organize resources in large AWS accounts
- Makes it easier to find and manage related resources
- Useful for cost tracking and reporting
- Best practice for AWS resource management

---

## Troubleshooting

### Issue: "You don't have permission to create roles"
**Solution:**
- Your AWS user needs `iam:CreateRole` permission
- Contact your AWS administrator to grant this permission
- Or use an account with admin access

### Issue: "Policy not found" when searching
**Solution:**
- Make sure you're in the correct AWS region (policies are global, but double-check)
- Try typing the full policy name
- For custom policies, make sure you created them first and refreshed the page

### Issue: "Role name already exists"
**Solution:**
- Choose a different name (e.g., `lambda-odds-execution-role-v2`)
- Or delete the existing role if it's not being used
- Role names must be unique within your AWS account

### Issue: Can't see the role after creation
**Solution:**
- Check you're in the correct AWS account
- Use the search box in the Roles list
- Verify the role name spelling

---

## Next Steps

Now that you have the IAM role created, you can:

1. **Create the Lambda function** and attach this role
2. **Store secrets** in Secrets Manager or SSM (if using)
3. **Deploy your Lambda function code**
4. **Set up EventBridge schedule** to run daily

See `docs/lambda-deployment-guide.md` for the complete deployment process.

---

## Summary

**What you created:**
- IAM role: `lambda-odds-execution-role`
- Trust policy: Allows Lambda service to assume the role
- Permissions: CloudWatch logs (required) + Secrets Manager/SSM (only if using secrets)

**Why each piece matters:**
- **Trust policy:** Establishes that Lambda can use this role
- **Execution policy:** Enables logging (essential for debugging)
- **Secrets policy:** Allows reading credentials securely (only if using Secrets Manager/SSM)

**Key takeaway:**
- IAM roles are like identity cards for AWS services
- They define what services can do, not what users can do
- Principle of least privilege: only grant what's needed
- **For environment variables:** You only need the basic execution role - that's it!

---

## Visual Checklist

Before moving to Lambda creation, verify:

- [ ] Role name: `lambda-odds-execution-role`
- [ ] Trust relationship: `lambda.amazonaws.com`
- [ ] Policy attached: `AWSLambdaBasicExecutionRole` (required)
- [ ] Policy attached: `LambdaOddsSecretsAccess` OR `LambdaOddsSSMAccess` (only if using secrets - skip if using environment variables)
- [ ] Role ARN copied (you'll need it)
- [ ] Tags added (optional but recommended)

**For environment variables users:** You only need the first 3 items checked! ✅

You're ready to create the Lambda function! 🚀

