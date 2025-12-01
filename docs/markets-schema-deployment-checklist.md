# Markets Schema Deployment Checklist

## Prerequisites (Must Exist First)

Before running `markets.sql`, ensure these tables exist:

1. ✅ **`games` table** (with `game_id` column)
   - File: `db/schemas/games.sql`
   - The `markets` table has: `game_id text not null references games(game_id)`

2. ✅ **`players` table** (with `player_id` column)
   - File: `db/schemas/players.sql`
   - The `markets` table has: `player_id text references players(player_id)`

3. ✅ **`teams` table** (indirect dependency via games/players)
   - Should already exist if you have games/players

## Deployment Steps

### Option 1: If Tables Already Exist ✅

**You can copy/paste `markets.sql` directly into Supabase SQL Editor:**

1. Open Supabase Dashboard → SQL Editor
2. Copy entire contents of `db/schemas/markets.sql`
3. Paste and run
4. ✅ Done! (Uses `create table if not exists`, so safe to run multiple times)

### Option 2: If You're Unsure About Dependencies

**Run in this order:**

1. First, check if tables exist:
```sql
-- Check if games table exists
SELECT EXISTS (
  SELECT FROM information_schema.tables 
  WHERE table_name = 'games'
);

-- Check if players table exists
SELECT EXISTS (
  SELECT FROM information_schema.tables 
  WHERE table_name = 'players'
);
```

2. If both return `true`, you're good to go!
3. Copy/paste `markets.sql` into Supabase SQL Editor
4. Run it

### Option 3: Full Schema Deployment (Recommended)

**If you want to be extra safe, run all schemas in order:**

1. `teams.sql` (if not exists)
2. `players.sql` (if not exists)
3. `games.sql` (if not exists)
4. `staging_events.sql` (optional, but recommended)
5. `markets.sql` ✅

## What the Schema Creates

✅ **Table:** `markets`
- Stores team odds (moneyline, spread, total)
- Stores player props (points, rebounds, assists, threes, blocks, double_double, triple_double, first_basket)
- Supports pre-game, closing, live, mid-game snapshots

✅ **Indexes:** 6 indexes for fast queries
- By game_id
- By game + market type + snapshot
- By player_id + stat_type (partial index for player props)
- By bookmaker
- By fetched_at

✅ **Unique Constraint:** Prevents duplicate pre-game/closing snapshots

## Verification Query

After deployment, verify it worked:

```sql
-- Check table exists
SELECT table_name 
FROM information_schema.tables 
WHERE table_name = 'markets';

-- Check indexes
SELECT indexname 
FROM pg_indexes 
WHERE tablename = 'markets';

-- Check constraints
SELECT constraint_name, constraint_type
FROM information_schema.table_constraints
WHERE table_name = 'markets';
```

## Common Issues

### ❌ Error: "relation 'games' does not exist"
**Solution:** Run `games.sql` first

### ❌ Error: "relation 'players' does not exist"
**Solution:** Run `players.sql` first

### ❌ Error: "constraint already exists"
**Solution:** This is fine! The schema uses `if not exists`, so it's safe to run multiple times.

## Summary

**If you already have `games` and `players` tables:**
✅ **Yes, you can copy/paste `markets.sql` directly into Supabase!**

The schema uses `create table if not exists` and `create index if not exists`, so it's safe to run multiple times.

---

_Last updated: 2025-11-29_





