# Data Seeding Guide

How to populate the NBA Analytics database from scratch or backfill missing data.

## Prerequisites

Environment variables in `.env`:

```
SUPABASE_DB_URL=postgresql://...          # Required for all scripts
BALDONTLIE_API_KEY=...                    # Required for teams + game schedule
APISPORTS_API_KEY=...                     # Required for player rosters
```

All scripts are run with `npx tsx scripts/<script>.ts`.

---

## Data Sources

| Source | What it provides | Rate limit |
|--------|-----------------|------------|
| **BallDontLie API** | Teams, game schedule, scores, statuses | 5 req/min (free tier, 12s delay) |
| **API-Sports** | Player rosters | ~1 req/sec |
| **Basketball Reference** | Box scores, detailed player stats | 15 req/min (4s delay) |

---

## Database Tables

```
teams                      ← seed-teams.ts (BallDontLie)
players                    ← seed-players.ts (API-Sports)
provider_id_map            ← links external IDs to internal IDs

games                      ← seed-full-season-schedule.ts / seed-games-bdl.ts
bbref_schedule             ← scrape-bbref-schedule.ts
bbref_games                ← backfill-boxscores-bbref.ts (auto-created)
bbref_player_game_stats    ← backfill-boxscores-bbref.ts
bbref_team_game_stats      ← populate-bbref-stats.ts
game_validation_results    ← validate-player-stats.ts
```

---

## Step-by-Step: Full Season Setup

### Step 1 — Seed Teams

Fetches all 30 NBA teams from BallDontLie and populates `teams` + `provider_id_map`.

```bash
npx tsx scripts/seed-teams.ts
```

Run once. Takes ~10 seconds.

### Step 2 — Seed Players

Fetches player rosters from API-Sports and populates the `players` table.

```bash
npx tsx scripts/seed-players.ts
```

Run once per season (or when rosters change). Iterates through all teams.

### Step 3 — Seed Game Schedule

Fetches the full season schedule from BallDontLie. Populates `games` with all scheduled matchups (status = "Scheduled").

```bash
npx tsx scripts/seed-full-season-schedule.ts --season 2025
```

- `--season 2025` = the 2025-26 NBA season (uses the start year)
- Default date range: Oct 1 to Jun 30
- Optional: `--start-date 2025-10-21 --end-date 2026-04-15` for a custom range
- Takes ~5-15 minutes depending on rate limits

### Step 4 — Update Scores for Past Games

For games that have already been played, update their scores and status from BallDontLie.

```bash
npx tsx scripts/seed-games-bdl.ts --date 2025-10-21 --end-date 2026-02-20
```

- Processes one date per API call (12s between calls on free tier)
- Updates `games.status` to "Final" and fills in scores
- Also fixes games that had timestamps stored as status values
- ~18 minutes per month of games

Other usage patterns:

```bash
npx tsx scripts/seed-games-bdl.ts --yesterday          # Just yesterday
npx tsx scripts/seed-games-bdl.ts --date 2025-12-25    # Single date
npx tsx scripts/seed-games-bdl.ts --date 2025-12-01 --week  # One week
```

### Step 5 — Backfill Box Scores

Scrapes detailed player stats from Basketball Reference for all "Final" games missing box scores.

```bash
npx tsx scripts/backfill-boxscores-bbref.ts --max-games 200
```

- Automatically finds games in the `games` table that are Final but have no `bbref_player_game_stats`
- Deduplicates: only processes one entry per matchup+date (prefers BDL game IDs)
- Skips games that already have BBRef stats
- ~4 seconds per game (rate limited)
- 200 games ≈ 15 minutes

Options:

```bash
--max-games 100                  # Limit batch size (default: 100)
--team CLE                       # Only backfill one team's games
--start-date 2025-12-01          # Start from a specific date
--end-date 2026-01-31            # End at a specific date
--dry-run                        # Preview without making changes
```

### Step 6 — Populate Team Game Stats (for historical data)

Aggregates player stats into team-level game stats in `bbref_team_game_stats`.

> **Note:** As of the latest update, `backfill-boxscores-bbref.ts` now auto-generates team stats
> when scraping new games. This step is only needed to backfill team stats for games that were
> scraped before this change, or if `bbref_team_game_stats` is out of sync with `bbref_player_game_stats`.

```bash
npx tsx scripts/populate-bbref-stats.ts
npx tsx scripts/populate-bbref-stats.ts --players-only   # Just player stats
npx tsx scripts/populate-bbref-stats.ts --teams-only     # Just team aggregates
```

### Step 7 — Validate Player Stats

Runs 7 automated checks against `bbref_player_game_stats` to verify data accuracy.
Results are stored in `game_validation_results` and surfaced on the admin data check page.

```bash
npx tsx scripts/validate-player-stats.ts
```

Checks performed:
1. **Score reconciliation** — player points sum matches game score
2. **Cross-source scores** — BDL vs BBRef game scores agree
3. **Points formula** — `pts = 2*FGM + 3PM + FTM` per player
4. **Shooting math** — FGA >= FGM, FTA >= FTM, 3PA >= 3PM, 3PM <= FGM
5. **Minutes sanity** — team total ~240 min, individual 0-60
6. **Stat bounds** — no negatives, reasonable maximums
7. **Completeness** — 8-15 active players per team per game

Options:

```bash
--start-date 2025-12-01          # Validate from a date
--end-date 2026-02-01            # Validate up to a date
--team CLE                       # Only one team's games
--game-id bbref_...              # Single game
--unvalidated                    # Only games not yet validated
```

---

## Quick Reference: Common Operations

### Daily update (catch up on yesterday's games)

```bash
npx tsx scripts/seed-games-bdl.ts --yesterday
npx tsx scripts/backfill-boxscores-bbref.ts --max-games 20
npx tsx scripts/validate-player-stats.ts --unvalidated
```

### Catch up after being away for a while

```bash
# Update scores/status for the date range you missed
npx tsx scripts/seed-games-bdl.ts --date 2026-01-15 --end-date 2026-02-20

# Backfill box scores for all newly-final games
npx tsx scripts/backfill-boxscores-bbref.ts --max-games 500

# Validate the new data
npx tsx scripts/validate-player-stats.ts --unvalidated
```

### Start fresh (empty database)

Run steps 1-7 in order. The full process takes about 1-2 hours depending on how many past games need box scores.

---

## Architecture Notes

### Dual Game ID System

Games can exist with different ID formats from different sources:

| Format | Source | Example |
|--------|--------|---------|
| 8-digit `184xxxxx` | BallDontLie API | `18447178` |
| 13-digit `184YYYYMMDD##` | BBRef schedule sync | `1842026010603` |
| 10-digit `002xxxxxxx` | NBA Stats | `0022500391` |

The backfill script deduplicates these automatically, preferring BDL IDs (shorter, more reliable dates).

### BBRef Stats vs Canonical Stats

Stats are stored in two parallel systems:

- **`bbref_player_game_stats`** — populated by the BBRef scraper (primary source of truth)
- **`bbref_team_game_stats`** — aggregated from player stats (auto-generated during backfill, or via `populate-bbref-stats.ts`)
- **`player_game_stats`** — canonical table (mostly empty, intended for future use)

The BBRef tables (`bbref_games`, `bbref_player_game_stats`, `bbref_team_game_stats`) are the ones used by the app's API queries.

**Important:** The backfill script (`backfill-boxscores-bbref.ts`) writes to all three BBRef tables.
If you see player stats but missing team stats for older games, run `populate-bbref-stats.ts --teams-only` to backfill them.

### Date/Timezone Handling

- **BallDontLie** returns dates as Eastern Time dates, stored at midnight UTC (e.g., a Dec 18 ET game is stored as `2025-12-18T00:00:00Z`)
- **Basketball Reference** URLs use the ET date (e.g., `202512180OKC.html`)
- **NBA Stats games** store actual start times in UTC (e.g., `2025-12-19T01:00:00Z` for an 8pm ET game on Dec 18)
- The scraper handles both formats: midnight UTC dates use the UTC date directly, actual timestamps use ET conversion

### Rate Limits

| API | Limit | Script delay |
|-----|-------|-------------|
| BallDontLie (free) | 5 req/min | 12 seconds |
| Basketball Reference | 20 req/min | 4 seconds (conservative) |
| API-Sports | ~10 req/min | 800ms |

All scripts include retry logic with exponential backoff for 429 (rate limit) errors.

### Lambda (Automated Daily)

The `lambda/boxscore-scraper/` function runs daily at 03:00 ET via AWS EventBridge to automatically scrape box scores for yesterday's games. It uses the same logic as `backfill-boxscores-bbref.ts`.
