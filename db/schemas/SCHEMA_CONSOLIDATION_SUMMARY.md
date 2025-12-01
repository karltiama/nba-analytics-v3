# Schema Consolidation Summary - Basketball Reference Only

## ✅ Completed Updates

### 1. Updated `player_game_stats.sql`
- ✅ Added `offensive_rebounds` field
- ✅ Added `defensive_rebounds` field
- ✅ Added `personal_fouls` field
- ✅ Added `source` field (default 'bbref')
- ✅ Added constraint: `source = 'bbref'` (BBRef only)

### 2. Updated `team_game_stats.sql`
- ✅ Removed comment about NBA API
- ✅ Added `source` field (default 'bbref')
- ✅ Added constraint: `source = 'bbref'` (BBRef only)
- ✅ Note: `offensive_rebounds`, `defensive_rebounds`, `personal_fouls` already exist

### 3. Updated Scrapers
- ✅ `scripts/scrape-basketball-reference.ts`
  - Now parses ORB, DRB, PF from HTML
  - Inserts all new fields including source='bbref'
  
- ✅ `lambda/boxscore-scraper/index.ts`
  - Now parses ORB, DRB, PF from HTML
  - Inserts all new fields including source='bbref'

### 4. Created Migration Script
- ✅ `MIGRATION_ADD_BBREF_FIELDS.sql` - Adds new columns to existing tables

### 5. Documented Deprecated Tables
- ✅ `DEPRECATED_TABLES.md` - Lists all deprecated tables and migration notes

## 📋 Next Steps

### 1. Run Migration
```sql
-- Run this on your database:
\i db/schemas/MIGRATION_ADD_BBREF_FIELDS.sql
```

### 2. Test Updated Scrapers
```bash
# Test the updated scraper
npx tsx scripts/scrape-basketball-reference.ts --game-id <game_id>

# Verify new fields are populated
# Check offensive_rebounds, defensive_rebounds, personal_fouls, source
```

### 3. Verify Lambda Function
- Build and test the Lambda function locally
- Ensure it includes all new fields

### 4. Clean Up Deprecated Tables (Optional)
- Review data in deprecated tables
- Migrate if needed
- Drop deprecated tables once confirmed

## 🎯 Result

All schemas are now consolidated to use Basketball Reference as the single source of truth:
- ✅ `player_game_stats` - BBRef only (with source constraint)
- ✅ `team_game_stats` - BBRef only (with source constraint)
- ✅ All scrapers write to main tables with source='bbref'
- ✅ New fields (ORB, DRB, PF) are now captured
- ✅ Source tracking ensures data integrity

## 📝 Notes

- The `source` field ensures we can verify all data is from Basketball Reference
- The constraint prevents accidentally inserting data from other sources
- Deprecated tables can be removed after confirming no important data needs migration

