# NBA Roster Seeding Workflow

This document captures the one-time roster seeding pipeline built for the MVP ingest. It covers data sources, validation, transformations, persistence, and operational knobs.

---

## Overview

We use the official NBA Stats API (via the `nba_api` Python package) to pull 2025-26 season rosters and populate:

- `players`: canonical player metadata.
- `provider_id_map`: provider-to-canonical ID mapping (`provider='nba'`).

Stage data writes to `staging_events` are optional; in production we bypass them unless the table is available.

---

## Data Sources

| Provider | Endpoint | Driver | Notes |
| --- | --- | --- | --- |
| NBA Stats | `commonteamroster` | `nba_api.stats.endpoints.commonteamroster` | Requires NBA Team ID (numeric). Season string in format `YYYY-YY` (e.g., `2025-26`). |

**Provider Team IDs**  
`provider_id_map` must contain all NBA Stats team IDs (e.g. `1610612737` for ATL). These were inserted via a Supabase SQL script aligning `teams.abbreviation` to provider IDs.

---

## Environment + Dependencies

```
nba_api>=1.10.2,<2
pydantic>=2.7,<3
psycopg[binary]>=3.1,<4
python-dotenv>=1.0,<2
requests>=2.31,<3
```

Environment variables:

| Name | Required | Description |
| --- | --- | --- |
| `SUPABASE_DB_URL` | ✅ | Connection string for Supabase Postgres. |
| `NBA_STATS_SEASON` | Optional | Override target season. Default `2025-26`. |
| `NBA_STATS_TEAM_ID` | Optional | Restrict processing to a single provider team ID (useful for testing). |
| `NBA_STATS_REQUEST_DELAY_SECONDS` | Optional | Rate limiting between requests (default `0.7`). |
| `NBA_STATS_STAGE_EVENTS` | Optional | Write raw payloads to `staging_events`. Defaults to `true`; script disables automatically if table missing. |

Activate virtualenv and install deps:

```bash
python -m venv .venv
.venv/Scripts/activate
pip install -r scripts/python-requirements.txt
```

---

## Flow Summary

1. **Load Config**: `dotenv` reads `.env`; script sets `TARGET_SEASON`, etc.
2. **Fetch Mappings**: Query `provider_id_map` for teams with `provider='nba'`.
3. **Iterate Teams**:
   - Fetch roster via `CommonTeamRoster`.
   - Validate & normalize with Pydantic models:
     - Handles mixed-case keys (`TEAM_ID` vs `TeamID`).
     - Parses birth dates like `"NOV 08, 2002"` into `date` objects.
     - Normalizes optional strings and jersey numbers.
   - Optionally stage raw JSON (skipped if table absent).
   - Upsert into:
     - `players` (idempotent `INSERT ... ON CONFLICT`).
     - `provider_id_map` (`provider='nba'`, metadata includes raw payload).
4. **Transaction Handling**: Each team runs inside a transaction (`begin/commit`). On error, roll back and continue to next team.
5. **Rate Limiting**: Sleep `REQUEST_DELAY_SECONDS` between teams to avoid hitting NBA stats rate caps.

---

## Schema Touchpoints

- `players.sql`
  - Allows nullable `position`, `height`, `weight`, `dob`, `active`.
  - Timestamps default to `now()`; update triggered by upsert.
- `provider_id_map.sql`
  - Primary key `(entity_type, provider, provider_id)`.
  - Stores `metadata` JSONB with `source`, `team_id`, `season`, raw payload.
- `player_team_rosters.sql`
  - Primary key `(player_id, season)`.
  - Links players to canonical team IDs per season with optional `active` and `jersey`.
- `player_game_stats.sql`
  - Primary key `(game_id, player_id)`.
  - Stores per-game box score metrics mapped to canonical player/team IDs.

---

## Games & Box Score Backfill

- Script: `scripts/seed_games_nba.py`
- Environment:
  - `NBA_STATS_START_DATE` / `NBA_STATS_END_DATE` (required, YYYY-MM-DD)
  - Reuses `NBA_STATS_SEASON` and `NBA_STATS_REQUEST_DELAY_SECONDS`
- Flow:
  1. Fetch daily schedule via `nba_api.live.nba.endpoints.scoreboard.ScoreBoard`.
  2. Normalize and upsert games into `games`, mapping provider team IDs via `provider_id_map`.
  3. For games with status live/final, pull box scores (`boxscoretraditionalv2`), validate, and upsert into `player_game_stats`.
  4. Ensure players exist in `players`/`provider_id_map`; auto-create stubs for new provider IDs.
- Usage example:
  ```powershell
  $env:NBA_STATS_STAGE_EVENTS="false"
  $env:NBA_STATS_START_DATE="2025-10-01"
  $env:NBA_STATS_END_DATE="2025-11-10"
  .\.venv\Scripts\python.exe scripts/seed_games_nba.py
  ```

Re-running is idempotent; games and box scores update in place.

Indexes to support lookups:
- `players_full_name_idx`
- `players_last_first_idx`
- `provider_map_internal_idx`

---

## Running the Script

```bash
$env:NBA_STATS_STAGE_EVENTS="false"   # optional
$env:NBA_STATS_SEASON="2025-26"       # optional (default already 2025-26)
.\.venv\Scripts\python.exe scripts/seed_players_nba.py
```

Expected log snippet:

```
INFO Upserted 18 players for provider team 1610612747
INFO NBA roster seed complete.
```

Re-running is safe; upserts are idempotent. Runtime ~90 seconds for all 30 teams with default rate limit.

---

## Error Handling

- **Missing `provider_id_map` entries**: Script aborts with descriptive error; ensure mappings exist before running.
- **Missing `staging_events` table**: Script logs a warning and disables staging writes automatically.
- **Validation Failures**: Pydantic exceptions logged with payload context; offending players skipped without impacting transaction.
- **HTTP Issues**: Any `nba_api` request exceptions bubble up; rerun after network resolves. Consider wrapping with retry/backoff if needed longer-term.

---

## Next Steps / Future Enhancements

- Cache raw roster payloads once `staging_events` table is created.
- Extend normalization to capture jersey numbers / experience if needed.
- Add CLI args (click/typer) to make seeding team or season specific without env setup.
- Introduce unit tests for normalization logic using saved payload fixtures.

---

_Last updated: 2025-11-11_

