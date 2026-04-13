# Supabase Connection Troubleshooting

## Error: "getaddrinfo ENOTFOUND db.[PROJECT].supabase.co"

This error means Lambda cannot resolve the DNS for your Supabase database hostname.

### Common Causes

1. **Wrong connection string format** - Using `db.` prefix instead of direct project name
2. **Incorrect hostname** - Copying wrong URL from Supabase dashboard
3. **Missing environment variable** - SUPABASE_DB_URL not set correctly in Lambda

---

## How to Get the Correct Connection String

### Step 1: Go to Supabase Dashboard

1. Sign in to [https://supabase.com/dashboard](https://supabase.com/dashboard)
2. Select your project
3. Go to **Settings** → **Database**

### Step 2: Find Connection String

You'll see two connection options:

**Option A: Direct Connection (Port 5432)**
```
postgresql://postgres.[PROJECT]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres
```

**Option B: Connection Pooling (Port 6543) - RECOMMENDED FOR LAMBDA**
```
postgresql://postgres.[PROJECT]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true
```

### Step 3: Use the Correct Format

**For Lambda, use the Pooled Connection (port 6543):**

```
postgresql://postgres.[PROJECT]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true
```

**Important notes:**
- Replace `[PROJECT]` with your actual project reference ID
- Replace `[PASSWORD]` with your database password
- Replace `[REGION]` with your AWS region (e.g., `us-east-1`)
- The hostname should be `aws-0-[REGION].pooler.supabase.com`, NOT `db.[PROJECT].supabase.co`

---

## Alternative: Connection String Format

If you see a different format in Supabase, it might look like:

```
postgresql://postgres:[PASSWORD]@[PROJECT].supabase.co:5432/postgres
```

**This is also valid**, but for Lambda, prefer the pooled connection:
```
postgresql://postgres:[PASSWORD]@[PROJECT].supabase.co:6543/postgres?pgbouncer=true
```

---

## Fixing the Lambda Environment Variable

1. **Go to Lambda Console**
   - Open your function: `odds-pre-game-snapshot`
   - Go to **Configuration** → **Environment variables**

2. **Edit SUPABASE_DB_URL**
   - Click **Edit**
   - Find `SUPABASE_DB_URL`
   - Replace the value with the correct connection string from Supabase dashboard
   - **Make sure:**
     - No `db.` prefix in hostname
     - Uses port `6543` for pooling (recommended)
     - Includes `?pgbouncer=true` for pooled connection
     - Password is correct

3. **Save and Test**
   - Click **Save**
   - Test the function again

---

## Verify Connection String Format

Your connection string should match one of these patterns:

✅ **Correct (Pooled - Recommended):**
```
postgresql://postgres.[PROJECT]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true
```

✅ **Correct (Direct):**
```
postgresql://postgres:[PASSWORD]@[PROJECT].supabase.co:5432/postgres
```

❌ **Wrong (has db. prefix):**
```
postgresql://postgres:[PASSWORD]@db.[PROJECT].supabase.co:5432/postgres
```

---

## Testing the Connection String Locally

Before updating Lambda, test the connection string locally:

```bash
# Using psql (if installed)
psql "postgresql://postgres:[PASSWORD]@[PROJECT].supabase.co:5432/postgres"

# Or test with Node.js
node -e "const { Pool } = require('pg'); const pool = new Pool({ connectionString: 'YOUR_CONNECTION_STRING' }); pool.query('SELECT NOW()').then(r => { console.log('✅ Connected:', r.rows[0]); pool.end(); }).catch(e => { console.error('❌ Error:', e.message); process.exit(1); });"
```

---

## Common Mistakes

1. **Copying wrong URL**
   - Don't use the "Connection string" from the wrong section
   - Use the one from Settings → Database

2. **Missing password encoding**
   - If password has special characters, URL-encode them
   - Example: `@` becomes `%40`, `#` becomes `%23`

3. **Wrong port**
   - Port 5432 = Direct connection (can hit limits)
   - Port 6543 = Pooled connection (recommended for Lambda)

4. **Missing query parameters**
   - Pooled connection needs `?pgbouncer=true`
   - Direct connection doesn't need it

---

## Still Having Issues?

1. **Check Supabase Project Status**
   - Go to Supabase dashboard
   - Verify project is active (not paused)
   - Check if project is in the correct region

2. **Verify Network Access**
   - Lambda has internet access by default (no VPC needed)
   - Supabase is publicly accessible

3. **Check CloudWatch Logs**
   - Look for more detailed error messages
   - The error might give more context about what's wrong

4. **Test from Local Machine**
   - If it works locally but not in Lambda, it's likely a connection string issue
   - If it doesn't work locally either, check Supabase project status


