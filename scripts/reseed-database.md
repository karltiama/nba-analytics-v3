# Database Reseed Guide

This guide walks you through cleaning and reseeding your NBA analytics database.

## Step 1: Check Data Quality

First, run the quality check to see what issues exist:

```bash
# Check all data
tsx scripts/check-data-quality.ts

# Check specific season
tsx scripts/check-data-quality.ts --season 2025-26
```

This will show you:
- Duplicate games
- Missing provider mappings
- Inconsistent scores/status
- Missing box scores
- Orphaned records

## Step 2: Clean Up Duplicates

Remove duplicate games (keeps the best one):

```bash
# Preview what will be deleted (dry run)
tsx scripts/cleanup-duplicate-games.ts --dry-run

# Actually delete duplicates
tsx scripts/cleanup-duplicate-games.ts

# Clean specific season
tsx scripts/cleanup-duplicate-games.ts --season 2025-26
```

## Step 3: Sync Provider Mappings

Ensure all games have proper provider mappings:

```bash
python scripts/sync-game-provider-mappings.py
```

## Step 4: Reseed Schedule (Optional)

If you want to reseed the entire schedule:

```bash
# Reseed full 2025-26 season
tsx scripts/seed-full-season-schedule.ts --season 2025

# Or specific date range
tsx scripts/seed-full-season-schedule.ts --season 2025 --start-date 2025-10-21 --end-date 2026-04-15
```

Note: This uses UPSERT, so it's safe to run multiple times.

## Step 5: Fetch Missing Box Scores

For Final games missing box scores:

```bash
# Fetch box scores for all Final games without them
python scripts/seed_boxscores_nba.py

# Or for specific date range
python scripts/seed_boxscores_nba.py --start-date 2025-10-21 --end-date 2025-11-01
```

## Step 6: Verify Quality Again

Run the quality check again to confirm issues are resolved:

```bash
tsx scripts/check-data-quality.ts
```

## Complete Reseed Workflow

If you want to completely start fresh (⚠️ **WARNING: This deletes data**):

```bash
# 1. Backup your database first!
# (Use your database admin tool or pg_dump)

# 2. Delete all games (cascade will delete related records)
# psql $SUPABASE_DB_URL -c "DELETE FROM games;"

# 3. Reseed teams (if needed)
tsx scripts/seed-teams.ts

# 4. Reseed full schedule
tsx scripts/seed-full-season-schedule.ts --season 2025

# 5. Sync provider mappings
python scripts/sync-game-provider-mappings.py

# 6. Fetch box scores for completed games
python scripts/seed_boxscores_nba.py

# 7. Verify quality
tsx scripts/check-data-quality.ts
```

## Common Issues and Solutions

### Duplicate Games
- **Cause**: Same game seeded from multiple sources (BDL + NBA Stats)
- **Solution**: Run `cleanup-duplicate-games.ts`

### Missing Box Scores
- **Cause**: Box scores not fetched for Final games
- **Solution**: Run `seed_boxscores_nba.py`

### Missing Provider Mappings
- **Cause**: Games seeded without creating mappings
- **Solution**: Run `sync-game-provider-mappings.py`

### Games Appearing on Wrong Date
- **Cause**: Timezone issues or duplicate games
- **Solution**: Run cleanup script and verify timezone handling

## Best Practices

1. **Always run quality checks first** before making changes
2. **Use dry-run mode** when available to preview changes
3. **Backup your database** before major cleanup operations
4. **Reseed incrementally** - don't delete everything at once
5. **Verify after each step** to catch issues early

