# How to Run Schema Migration in Supabase

## Important: Schema Files Don't Auto-Sync

The schema files in `db/schemas/` are just code/documentation. They **do NOT automatically update your Supabase database**. You need to run the SQL manually.

## Steps to Run Migration

### 1. Open Supabase SQL Editor

1. Go to your Supabase dashboard: https://supabase.com/dashboard
2. Select your project
3. Click on **"SQL Editor"** in the left sidebar
4. Click **"New query"**

### 2. Copy and Run the Migration

1. Open `db/schemas/MIGRATION_ADD_BBREF_FIELDS_SAFE.sql`
2. Copy the entire contents
3. Paste into the Supabase SQL Editor
4. Click **"Run"** (or press `Ctrl+Enter` / `Cmd+Enter`)

### 3. Verify the Changes

After running, verify the changes worked:

```sql
-- Check player_game_stats columns
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'player_game_stats'
  AND column_name IN ('offensive_rebounds', 'defensive_rebounds', 'personal_fouls', 'source')
ORDER BY column_name;

-- Check team_game_stats source column
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'team_game_stats'
  AND column_name = 'source';

-- Check constraints
SELECT constraint_name, constraint_type
FROM information_schema.table_constraints
WHERE table_name IN ('player_game_stats', 'team_game_stats')
  AND constraint_name LIKE '%source%';
```

### 4. Check Existing Data

Verify existing rows have source='bbref':

```sql
-- Check player_game_stats
SELECT source, COUNT(*) as count
FROM player_game_stats
GROUP BY source;

-- Check team_game_stats
SELECT source, COUNT(*) as count
FROM team_game_stats
GROUP BY source;
```

## What This Migration Does

1. ✅ Adds `offensive_rebounds`, `defensive_rebounds`, `personal_fouls` to `player_game_stats`
2. ✅ Adds `source` field to both tables (default 'bbref')
3. ✅ Sets existing rows to `source='bbref'`
4. ✅ Adds constraint to ensure all future data is from BBRef only
5. ✅ Creates indexes on `source` field

## Troubleshooting

### If you get an error about existing columns:
- The migration uses `IF NOT EXISTS`, so it's safe to run multiple times
- If a column already exists, it will be skipped

### If you get a constraint error:
- The migration drops existing constraints first, then adds new ones
- This is safe to run multiple times

### If you want to see what will change:
- Run the verification queries first to see current state
- Then run the migration
- Run verification queries again to see the changes

## Alternative: Using Supabase CLI

If you have Supabase CLI set up, you can also run:

```bash
supabase db push
```

But you'd need to set up migrations first. For now, using the SQL Editor is the simplest approach.

