# Schema Consolidation Plan - Basketball Reference Only

## Current Situation

### Box Score Tables (Multiple Sources)
1. **`player_game_stats`** ✅ - Currently used by working scraper
   - No source tracking
   - Missing: offensive_rebounds, defensive_rebounds, personal_fouls
   - References: `games` table

2. **`bbref_player_game_stats`** ❌ - Unused, BBRef-specific
   - Has source='bbref' constraint
   - Has offensive_rebounds, defensive_rebounds, personal_fouls
   - References: `bbref_games` table

3. **`scraped_boxscores`** ❌ - Used by CSV scraper (inconsistent)
   - Source: 'bbref_csv'
   - Has all fields including percentages

4. **`bbref_boxscores_csv`** ❌ - Unused, CSV-specific
   - Similar to scraped_boxscores

### Game Tables
1. **`games`** ✅ - Main canonical games table
   - Currently used by working scraper

2. **`bbref_games`** ⚠️ - BBRef-specific games table
   - Used by bbref_player_game_stats
   - May be redundant if we consolidate

### Team Stats Tables
1. **`team_game_stats`** ✅ - Main table
   - Has comment about NBA API for quarters
   - Missing: offensive_rebounds, defensive_rebounds, personal_fouls

2. **`bbref_team_game_stats`** ❌ - Unused, BBRef-specific
   - Has all fields including offensive_rebounds, defensive_rebounds, personal_fouls
   - References: `bbref_games`

## Consolidation Strategy

### Option 1: Enhance Main Tables (Recommended)
- Add source tracking to `player_game_stats` and `team_game_stats`
- Add missing BBRef fields (offensive_rebounds, defensive_rebounds, personal_fouls)
- Update scrapers to write to main tables with source='bbref'
- Deprecate/remove duplicate BBRef-specific tables

### Option 2: Use BBRef-Specific Tables
- Switch scrapers to write to `bbref_player_game_stats` and `bbref_team_game_stats`
- Keep main tables for other sources (but user wants BBRef only)
- More complex migration

## Recommended Approach: Option 1

### Step 1: Update `player_game_stats` Schema
- Add `source` field (default 'bbref')
- Add `offensive_rebounds` field
- Add `defensive_rebounds` field  
- Add `personal_fouls` field
- Add constraint: source = 'bbref' (since we're BBRef-only)

### Step 2: Update `team_game_stats` Schema
- Add `source` field (default 'bbref')
- Add `offensive_rebounds` field (if missing)
- Add `defensive_rebounds` field (if missing)
- Add `personal_fouls` field (if missing)
- Remove comment about NBA API (we're BBRef-only)

### Step 3: Update Scrapers
- Ensure all scrapers write to main tables
- Set source='bbref' explicitly
- Include new fields (offensive_rebounds, defensive_rebounds, personal_fouls)

### Step 4: Deprecate Unused Tables
- Mark `bbref_player_game_stats` as deprecated
- Mark `bbref_team_game_stats` as deprecated
- Mark `scraped_boxscores` as deprecated
- Mark `bbref_boxscores_csv` as deprecated
- Mark `bbref_games` as deprecated (if not needed)

## Implementation Order

1. ✅ Update `player_game_stats.sql` schema
2. ✅ Update `team_game_stats.sql` schema
3. ✅ Update `scrape-basketball-reference.ts` to include new fields
4. ✅ Update Lambda function to include new fields
5. ⚠️ Create migration script to add new columns to existing tables
6. ⚠️ Backfill missing fields from existing data (if possible)
7. ⚠️ Mark deprecated tables in comments

