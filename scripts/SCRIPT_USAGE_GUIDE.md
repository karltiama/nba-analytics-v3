# Script Usage Guide

This guide explains when and how to use each script in the codebase. All scripts follow the principle: **never overwrite good data with bad data**.

---

## 🎯 Quick Reference

### Daily ETL Workflow
```bash
# 1. Seed games for today
python scripts/run_day_seed.py

# 2. Update game statuses (sets Final if has scores)
python scripts/update-game-statuses.py

# 3. Fetch box scores for Final games
python scripts/seed_boxscores_nba.py

# 4. Update scores from stats if missing
python scripts/update-scores-from-stats.py
```

### Initial Season Setup
```bash
# 1. Seed full season schedule
tsx scripts/seed-full-season-schedule.ts --season 2025

# 2. Sync provider mappings
python scripts/sync-game-provider-mappings.py

# 3. Fetch box scores for completed games
python scripts/seed_boxscores_nba.py --start-date 2025-10-21 --end-date 2025-11-01
```

### Data Quality Maintenance
```bash
# 1. Check for issues
tsx scripts/check-data-quality.ts

# 2. Fix status issues (preview first)
tsx scripts/fix-incorrect-statuses.ts --dry-run
tsx scripts/fix-incorrect-statuses.ts

# 3. Fix score inconsistencies
tsx scripts/fix-inconsistent-scores.ts

# 4. Clean duplicates (preview first)
tsx scripts/cleanup-duplicate-games.ts --dry-run
tsx scripts/cleanup-duplicate-games.ts
```

---

## 📋 Script Categories

### 1. Seeding Scripts (Initial Data Load)

#### `seed-full-season-schedule.ts` ✅ PRIMARY
**Purpose**: Seed entire season schedule from BallDontLie API  
**When to use**: 
- Initial season setup
- Reseeding entire schedule
- **Safe to run multiple times** (idempotent, protects existing scores/statuses)

**Usage**:
```bash
# Full season
tsx scripts/seed-full-season-schedule.ts --season 2025

# Date range
tsx scripts/seed-full-season-schedule.ts --season 2025 --start-date 2025-10-21 --end-date 2026-04-15
```

**What it does**:
- Fetches games from BallDontLie API
- Creates/updates games (protects existing scores/statuses)
- Creates provider mappings

**Data Protection**: ✅ Protects scores and statuses from being overwritten

---

#### `seed-games-bdl.ts` ⚠️ ALTERNATIVE
**Purpose**: Seed games from BallDontLie (date range)  
**When to use**: 
- Alternative to `seed-full-season-schedule.ts`
- **Consider deprecating** if `seed-full-season-schedule.ts` covers all use cases

**Usage**:
```bash
tsx scripts/seed-games-bdl.ts --start-date 2025-10-21 --end-date 2025-11-01
```

**Data Protection**: ✅ Now protects scores and statuses (fixed)

---

#### `seed_games_nba.py` ✅ BOX SCORE SEEDING
**Purpose**: Seed games and box scores from NBA Stats API  
**When to use**: 
- Fetching box scores (primary method)
- Also seeds games if they don't exist

**Usage**:
```bash
# All Final games without box scores
python scripts/seed_games_nba.py

# Date range
python scripts/seed_games_nba.py --start-date 2025-10-21 --end-date 2025-11-01
```

**What it does**:
- Fetches box scores from NBA Stats API
- Creates/updates games (protects existing scores/statuses)
- Inserts player game stats

**Data Protection**: ✅ Protects scores and statuses from being overwritten

---

#### `seed_boxscores_nba.py` ✅ BOX SCORE FETCHING
**Purpose**: Fetch box scores from NBA Stats API  
**When to use**: 
- Daily ETL for Final games
- Backfilling missing box scores

**Usage**:
```bash
# All Final games without box scores
python scripts/seed_boxscores_nba.py

# Date range
python scripts/seed_boxscores_nba.py --start-date 2025-10-21 --end-date 2025-11-01
```

**What it does**:
- Fetches box scores from NBA Stats API
- Updates team game stats
- Inserts player game stats

**Data Protection**: ✅ Uses UPSERTs, safe to run multiple times

---

#### `seed_players_nba.py` ✅ PLAYER SEEDING
**Purpose**: Seed players and rosters from NBA Stats API  
**When to use**: 
- Initial player data load
- Updating player rosters

**Usage**:
```bash
python scripts/seed_players_nba.py
```

**Data Protection**: ✅ Uses UPSERTs, safe to run multiple times

---

#### `seed-players.ts` ⚠️ ALTERNATIVE
**Purpose**: Alternative player seeding from API-Sports  
**When to use**: 
- If NBA Stats API doesn't have all players
- **Check if still needed** - may be redundant

---

#### `seed-teams.ts` ✅ TEAM SEEDING
**Purpose**: Seed teams data  
**When to use**: 
- Initial setup
- **Safe to run multiple times**

**Usage**:
```bash
tsx scripts/seed-teams.ts
```

---

### 2. Score Update Scripts

#### `update-scores-from-stats.py` ✅ PRIMARY
**Purpose**: Update game scores from aggregated player stats  
**When to use**: 
- Games have box scores but missing final scores
- After fetching box scores

**Usage**:
```bash
# All games with missing scores
python scripts/update-scores-from-stats.py

# Date range
python scripts/update-scores-from-stats.py --start-date 2025-10-21 --end-date 2025-11-01
```

**What it does**:
- Aggregates points from `player_game_stats`
- Updates `home_score` and `away_score` **only if NULL**
- Sets status to 'Final'

**Data Protection**: ✅ Only updates NULL scores

---

#### `update-scores-from-boxscores.ts` ✅ FALLBACK
**Purpose**: Update scores from Basketball Reference scraping  
**When to use**: 
- Fallback if `update-scores-from-stats.py` doesn't work
- Games have box scores but missing scores

**Usage**:
```bash
# Preview first
tsx scripts/update-scores-from-boxscores.ts --dry-run

# Actually update
tsx scripts/update-scores-from-boxscores.ts --start-date 2025-10-21 --end-date 2025-11-01
```

**What it does**:
- Scrapes Basketball Reference for scores
- Updates scores **only if NULL**

**Data Protection**: ✅ Only updates NULL scores

---

#### `fix-inconsistent-scores.ts` ✅ DATA QUALITY
**Purpose**: Fix games where scores don't match box scores  
**When to use**: 
- After data quality check finds inconsistencies
- Data cleanup

**Usage**:
```bash
tsx scripts/fix-inconsistent-scores.ts
```

**Data Protection**: ✅ Only fixes inconsistencies, doesn't overwrite good data

---

### 3. Status Update Scripts

#### `update-game-statuses.py` ✅ ETL UTILITY
**Purpose**: Set status to 'Final' if game has scores  
**When to use**: 
- Daily ETL workflow
- After fetching box scores

**Usage**:
```bash
# All games
python scripts/update-game-statuses.py

# Date range
python scripts/update-game-statuses.py --start-date 2025-10-21 --end-date 2025-11-01
```

**What it does**:
- Updates status to 'Final' **only if status != 'Final'**
- Only for games with both scores

**Data Protection**: ✅ Only updates non-Final games

---

#### `fix-incorrect-statuses.ts` ✅ DATA QUALITY
**Purpose**: Fix logical status inconsistencies  
**When to use**: 
- Past games marked as Scheduled but have box scores
- Future games marked as Final without scores
- Data cleanup

**Usage**:
```bash
# Preview first
tsx scripts/fix-incorrect-statuses.ts --dry-run

# Actually fix
tsx scripts/fix-incorrect-statuses.ts
```

**What it does**:
- Fixes past games with box scores → 'Final'
- Fixes future games marked Final → 'Scheduled'
- Only fixes logical issues

**Data Protection**: ✅ Only fixes incorrect statuses

---

#### `fix-game-statuses.ts` ✅ DATA QUALITY
**Purpose**: Fix NULL or invalid status values  
**When to use**: 
- Games with NULL status
- Games with invalid status values

**Usage**:
```bash
# Preview first
tsx scripts/fix-game-statuses.ts --dry-run

# Actually fix
tsx scripts/fix-game-statuses.ts
```

**What it does**:
- Fixes NULL statuses → 'Scheduled' or 'Final' (based on game time)
- Fixes invalid statuses → valid status

**Data Protection**: ✅ Only fixes invalid values

---

### 4. Data Quality Scripts

#### `check-data-quality.ts` ✅ PRIMARY
**Purpose**: Comprehensive data quality checker  
**When to use**: 
- Before making changes
- Regular data audits
- After seeding/updates

**Usage**:
```bash
# All data
tsx scripts/check-data-quality.ts

# Specific season
tsx scripts/check-data-quality.ts --season 2025-26
```

**What it checks**:
- Duplicate games
- Missing provider mappings
- Inconsistent scores/status
- Missing box scores
- Orphaned records

---

#### `cleanup-duplicate-games.ts` ✅ CLEANUP
**Purpose**: Remove duplicate games intelligently  
**When to use**: 
- After data quality check finds duplicates
- Migrates box scores and preserves best data

**Usage**:
```bash
# Preview first
tsx scripts/cleanup-duplicate-games.ts --dry-run

# Actually clean
tsx scripts/cleanup-duplicate-games.ts --season 2025-26
```

**Data Protection**: ✅ Preserves best data, migrates box scores

---

#### `cleanup-orphaned-mappings.ts` ✅ CLEANUP
**Purpose**: Remove orphaned provider mappings  
**When to use**: 
- After cleanup operations
- Data maintenance

**Usage**:
```bash
tsx scripts/cleanup-orphaned-mappings.ts
```

---

### 5. Box Score Retrieval Scripts

#### `fetch-missing-boxscores.ts` ✅ FETCHING
**Purpose**: Fetch missing box scores from NBA API  
**When to use**: 
- Games marked Final but missing box scores
- Backfilling

**Usage**:
```bash
tsx scripts/fetch-missing-boxscores.ts
```

---

#### `retry-missing-boxscores.ts` ✅ RETRY
**Purpose**: Retry failed box score fetches  
**When to use**: 
- After `fetch-missing-boxscores.ts` fails for some games
- Retry failed attempts

**Usage**:
```bash
tsx scripts/retry-missing-boxscores.ts
```

---

#### `backfill-boxscores-bbref.ts` ✅ BACKFILL
**Purpose**: Backfill box scores from Basketball Reference  
**When to use**: 
- NBA API doesn't have box scores
- Historical data

**Usage**:
```bash
tsx scripts/backfill-boxscores-bbref.ts
```

---

#### `scrape-basketball-reference.ts` ✅ SCRAPING
**Purpose**: Scrape box scores from Basketball Reference  
**When to use**: 
- Fallback when API doesn't work
- Historical data

**Usage**:
```bash
tsx scripts/scrape-basketball-reference.ts
```

---

#### `scrape-nba-com.ts` ✅ SCRAPING
**Purpose**: Scrape scoreboard from NBA.com  
**When to use**: 
- Real-time score updates
- Fallback data source

**Usage**:
```bash
tsx scripts/scrape-nba-com.ts
```

**Data Protection**: ✅ Now protects scores and statuses (fixed)

---

### 6. ETL Scripts

#### `run_day_seed.py` ✅ DAILY ETL
**Purpose**: Daily ETL for single date  
**When to use**: 
- Scheduled daily runs
- Seeds games for today

**Usage**:
```bash
python scripts/run_day_seed.py
```

---

#### `sync-game-provider-mappings.py` ✅ SYNC
**Purpose**: Sync provider ID mappings  
**When to use**: 
- After seeding games
- Ensure all games have mappings

**Usage**:
```bash
python scripts/sync-game-provider-mappings.py
```

---

#### `backfill-team-stats.ts` ✅ BACKFILL
**Purpose**: Backfill team_game_stats from player stats  
**When to use**: 
- Missing team stats
- After player stats are loaded

**Usage**:
```bash
tsx scripts/backfill-team-stats.ts
```

---

#### `backfill_quarter_data.py` ✅ BACKFILL
**Purpose**: Backfill quarter data for games  
**When to use**: 
- Missing quarter-by-quarter data
- Historical data

**Usage**:
```bash
python scripts/backfill_quarter_data.py
```

---

## 🔒 Data Protection Rules

All scripts now follow these rules:

### Score Protection
- ✅ **Never overwrite** existing scores with NULL
- ✅ **Only update** if existing score is NULL
- ✅ **Allow updates** if new score is NOT NULL (even if existing exists)

### Status Protection
- ✅ **Never overwrite** 'Final' with 'Scheduled'
- ✅ **Only update** if existing status is NULL or invalid
- ✅ **Allow upgrades** (Scheduled → Final, InProgress → Final)

### UPSERT Behavior
- ✅ **Idempotent** - Safe to run multiple times
- ✅ **Preserves** existing good data
- ✅ **Updates** only when new data is better/more complete

---

## 📊 Script Comparison

### Score Update Scripts

| Script | Source | When to Use | Protection |
|--------|--------|-------------|------------|
| `update-scores-from-stats.py` | Player stats aggregation | Primary method | ✅ Only NULL scores |
| `update-scores-from-boxscores.ts` | Basketball Reference | Fallback | ✅ Only NULL scores |
| `fix-inconsistent-scores.ts` | Box score validation | Data quality | ✅ Only inconsistencies |

### Status Update Scripts

| Script | Purpose | When to Use | Protection |
|--------|---------|-------------|------------|
| `update-game-statuses.py` | Set Final if has scores | Daily ETL | ✅ Only non-Final |
| `fix-incorrect-statuses.ts` | Fix logical issues | Data cleanup | ✅ Only incorrect |
| `fix-game-statuses.ts` | Fix NULL/invalid | Data cleanup | ✅ Only invalid |

### Seeding Scripts

| Script | Source | Purpose | Protection |
|--------|--------|---------|------------|
| `seed-full-season-schedule.ts` | BallDontLie | Full season | ✅ Protected |
| `seed-games-bdl.ts` | BallDontLie | Date range | ✅ Protected |
| `seed_games_nba.py` | NBA Stats | Box scores | ✅ Protected |
| `scrape-nba-com.ts` | NBA.com | Scoreboard | ✅ Protected |

---

## ⚠️ Important Notes

1. **Always preview changes** - Use `--dry-run` when available
2. **Check data quality first** - Run `check-data-quality.ts` before fixes
3. **Backup before major changes** - Especially before cleanup operations
4. **Run scripts in order** - Follow the workflow guides above
5. **Don't run conflicting scripts** - Don't run multiple seeding scripts simultaneously

---

## 🚀 Best Practices

1. **Daily ETL**: Use the daily workflow scripts
2. **Initial Setup**: Use seeding scripts in order
3. **Data Quality**: Check → Fix → Verify
4. **Backfilling**: Use backfill scripts for historical data
5. **Scraping**: Use as fallback when APIs fail

---

## 📝 Script Status

- ✅ **Production Ready** - Safe to use, has data protection
- ⚠️ **Review Needed** - May be redundant or need updates
- 🔧 **Fixed** - Recently updated with data protection

All scripts marked ✅ are production-ready and safe to use.

