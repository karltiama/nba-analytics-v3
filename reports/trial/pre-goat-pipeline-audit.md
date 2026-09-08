# Pre-GOAT Pipeline & 2025–26 Completeness Audit

Generated: 2026-09-08T04:14:53.641Z  
Mode: **read-only**. No GOAT activation, no `/v1/stats` pagination, no Production writes, no freeze/season-pin changes.

Companion artifacts:

- `reports/trial/2025-repair-manifest.json`
- `reports/trial/pre-goat-completeness.json`
- `reports/trial/bdl-games-2025.json` (cached `/v1/games` inventory)

Reusable command:

```bash
npx tsx scripts/ops/pre-goat-pipeline-audit.ts
npx tsx scripts/ops/pre-goat-pipeline-audit.ts --from-cache=reports/trial/bdl-games-2025.json
```

---

## Executive Summary

The live 2025–26 corpus is **almost complete through early May 2026**, then **stops**. BallDontLie currently lists **1,322** `season=2025` games, all `status_state=final`. Local analytics has **1,297** season-2025 games and **1,289** games with player logs and team stats.

The gap is the **2026 playoff tail**: **33 Final games** from **2026-05-06 through 2026-06-13** have **no raw player stats, no analytics logs, and no team stats**. **26** of those IDs are missing from `analytics.games` entirely. **7** exist locally with frozen/stale statuses (`1st Qtr`, `2nd Qtr`, or a tipoff timestamp) and 0–0 or partial scores.

Those 33 games **cannot be repaired without GOAT `/v1/stats`**. Games-endpoint data is already sufficient to upsert the missing `analytics.games` rows.

The 2024 → 2023 historical path is **partially built, not wired end-to-end**. `bdl-to-serving.ts` implements Option B (`S3 → analytics`, `stagingMode: none`). The orchestrator `backfill-historical-season-serving.ts` **probes, then exits** even when access would succeed (`Live archive/materialize is gated`). It also **hard-fails any season other than 2024**. Using the older `seed-raw-balldontlie` / `transform-raw-to-analytics` path for 2024 **would write `raw.player_game_stats`** and is the wrong trial path.

**GOAT trial overall readiness: YELLOW.** Safe to activate GOAT for a **2025 playoff-tail repair + S3 historical archive**. Not safe to execute 2024/2023 **analytics materialization** until the orchestrator is un-gated and season-scoped writers are actually called.

Storage baseline re-verified: **318,712,979 bytes / 304 MB**. Hard stop **450 MB** still valid.

---

## Current Pipeline Diagram

### 2025 current / live path (what actually ran)

```text
EventBridge (documented 08:00 UTC) / CLI seed-raw-balldontlie
       ↓
Independent BDL fetchers (no shared limiter)
  nightly-bdl-updater  OR  refresh-schedule-from-bdl  OR  seed-raw-balldontlie
       ↓
BDL /v1/games  (schedule + Final filter)
BDL /v1/stats  (box scores; currently unauthorized for backfill)
       ↓
raw.games  (upsert on id)
raw.player_game_stats  (upsert on id)   ← 2025 still depends on this
raw.players
       ↓
transform-raw-to-analytics.ts
  AND nightly-bdl-updater steps 6–9
       ↓
analytics.games
analytics.players
analytics.player_game_logs     PK (game_id, player_id)
       ↓
derived from player logs + games (not fetched)
analytics.team_game_stats      PK/conflict (team_id, game_id)
analytics.team_season_averages
analytics.player_season_averages
       ↓
player-team stints (separate roster reconstruction; season-scoped DELETE of inferred_pgl only)
       ↓
S3 source=existing_ingestion (props/odds/injuries/games archives) — parallel, not this box-score path
```

Nightly stats fetch is **only ET yesterday/today Final games**, not a full-season repair.

### 2024+ intended historical path (library exists; CLI does not execute it)

```text
CLI backfill-historical-season-serving.ts --season=2024
       ↓
probe /games and /stats  →  if /stats 401: exit 2, no writes
       ↓
TODAY: fatal even if probe succeeds
       ↓
PLANNED (not called):
  scripts/archive/backfill-balldontlie-season.ts
       ↓
  S3 raw/source=balldontlie/league=nba/season=<S>/entity=games|player_stats/page=N.json
  + _manifest.json
       ↓
  assertCompleteHistoricalArchive (fail-closed)
       ↓
  lib/ingestion/historical-serving/bdl-to-serving.ts
       ↓
  analytics.games / players / player_game_logs   (season window Oct 15–Jun 30)
       ↓
  season-scoped team_game_stats + averages + inferred_pgl stints
       ↓
  NEVER writes raw.player_game_stats   (stagingMode: none)
```

### Wrong path if used for 2024 (do not use in trial)

```text
ingest-previous-season.ts → S3 balldontlie + curated parquet (not analytics serving)
seed-raw-balldontlie --season=2024 --stats → raw.player_game_stats  (mixes with 2025)
transform-raw-to-analytics.ts → ALL raw rows, unscoped
```

---

## Current 2025–26 Provider Inventory

Fetched with `BdlArchiveClient.paginate('/games', seasons[]=2025, per_page=100)`. 14 pages, 1,322 games. `/v1/stats` was **not** called.

| Metric | Count |
| --- | ---: |
| All provider games | **1,322** |
| `status_state=final` / `status=Final` | **1,322** |
| Scheduled | 0 |
| Postponed (`postponed=true`) | 0 |
| Canceled | 0 |
| Other lifecycle | 0 |
| `postseason=true` | 85 (field present on payload) |
| NBA Cup | `ist_stage` on payload; not stored locally |

Two 429s occurred during this games-only crawl at default 200 ms delay (60 s backoff, no `Retry-After` parsing). Evidence the current key is not GOAT-rate, and limiters are per-client.

---

## Current Local Inventory

Re-measured live (matches the storage probe):

| Object | Count |
| --- | ---: |
| Postgres | **318,712,979 bytes / 304 MB** |
| `analytics.games` all | 2,497 |
| `analytics.games` season 2025 | **1,297** |
| Local `status=Final` season 2025 | **1,290** |
| `analytics.player_game_logs` | **45,066** rows / **1,289** distinct games |
| `analytics.team_game_stats` | **2,578** rows / **1,289** distinct games |
| `analytics.player_season_averages` 2025 | 603 |
| `analytics.team_season_averages` 2025 | 30 |
| `analytics.player_team_stints` 2025 / 2026 | 697 / 578 |
| `raw.player_game_stats` | **45,066**, all season **2025** |
| Season 2024 / 2023 / 2022 analytics serving | **0** |

`analytics.games` season 2026 = 1,200 schedule-seed rows (not in the BDL 2025 inventory). Expected.

Team-stat identity: **2,578 = 1,289 × 2**. That is exactly one missing **local Final** relative to 1,290 Finals (`21708677`), plus 32 additional BDL Finals that are not local Finals (26 missing games + 6 stale-status rows).

---

## Exact Missing Games

### BDL → analytics missing (26)

Present at BDL, absent from `analytics.games`:

`21708303`, `21709227`, `21707975`, `21708680`, `21708305`, `21709231`, `21709235`, `21707977`, `21709238`, `21709241`, `21713528`, `21713895`, `21713529`, `21713897`, `21713530`, `21713899`, `21713531`, `21713901`, `21713532`, `21713533`, `21713534`, `21716134`, `21716135`, `21716136`, `21716137`, `21716138`

All `postseason=true`, dates **2026-05-09 through 2026-06-13** (conference finals / Finals).

### Analytics → BDL unexpected (1)

| game_id | local status | note |
| --- | --- | --- |
| `21681993` | `2026-04-30T04:00:00Z` | Not in BDL `seasons[]=2025` inventory. Do not guess. `OTHER`. |

### Lifecycle mismatches (6 exist locally, not Final)

BDL `final`; local still scheduled / in-progress:

| game_id | date | matchup | local status |
| --- | --- | --- | --- |
| 21707973 | 2026-05-06 | MIN @ SAS | `2026-05-07T01:30:00Z` |
| 21708674 | 2026-05-06 | PHI @ NYK | `2026-05-06T23:00:00Z` |
| 21708301 | 2026-05-07 | LAL @ OKC | `2026-05-08T01:30:00Z` |
| 21709223 | 2026-05-07 | CLE @ DET | `2nd Qtr` |
| 21707974 | 2026-05-08 | SAS @ MIN | `1st Qtr` |
| 21707976 | 2026-05-12 | MIN @ SAS | `2026-05-13T00:00:00Z` |

### Team mismatches

None (BDL home/visitor IDs match local where the game exists).

### Date/datetime mismatches

None after comparing BDL `date` to `analytics.games.start_time` in America/New_York.

---

## Exact Suspect/Partial Games

### Missing player logs (33)

The 26 missing games + the 6 stale-status games + **`21708677`** (NYK @ PHI 2026-05-08), which **is** local Final but has zero logs/raw/team stats.

### Score mismatch with complete logs (1) — not a stats gap

| game_id | date | matchup | BDL | local |
| --- | --- | --- | --- | --- |
| 18446941 | 2025-11-07 | CLE @ WAS | 115–148 | 114–148 |

One-point home-score drift. Raw and logs exist. Repair = upsert game scores from BDL. **Does not require GOAT.**

### Score reconciliation suspect (1)

| game_id | date | matchup | summed player pts | official | delta |
| --- | --- | --- | --- | --- | --- |
| 18447793 | 2026-03-14 | SAC @ LAC | 88–99 | 109–118 | −21 / −19 |

36 log rows, both teams present, no duplicate keys. Raw and analytics keys match. Box is **incomplete in both layers**. **Requires GOAT refetch** of `/v1/stats?game_ids[]=18447793`.

No duplicate `(game_id, player_id)` rows. No foreign team IDs on logged Finals. Null core IDs: none flagged.

---

## Game-by-Game Completeness Matrix

| game_id | date | matchup | BDL final | analytics.games | raw stats | player logs | team stats | problem |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 18446941 | 2025-11-07 | CLE @ WAS | Y | Y | Y | Y | 2 | SCORE_MISMATCH |
| 18447793 | 2026-03-14 | SAC @ LAC | Y | Y | Y | Y | 2 | SCORE_RECONCILIATION_SUSPECT |
| 21707973 | 2026-05-06 | MIN @ SAS | Y | Y stale | 0 | 0 | 0 | STATUS/SCORE + MISSING raw/logs/team |
| 21708674 | 2026-05-06 | PHI @ NYK | Y | Y stale | 0 | 0 | 0 | STATUS/SCORE + MISSING raw/logs/team |
| 21708301 | 2026-05-07 | LAL @ OKC | Y | Y stale | 0 | 0 | 0 | STATUS/SCORE + MISSING raw/logs/team |
| 21709223 | 2026-05-07 | CLE @ DET | Y | Y stale | 0 | 0 | 0 | STATUS/SCORE + MISSING raw/logs/team |
| 21707974 | 2026-05-08 | SAS @ MIN | Y | Y stale | 0 | 0 | 0 | STATUS/SCORE + MISSING raw/logs/team |
| 21708677 | 2026-05-08 | NYK @ PHI | Y | Y Final | 0 | 0 | 0 | MISSING raw/logs/team |
| 21708303 | 2026-05-09 | OKC @ LAL | Y | **N** | 0 | 0 | 0 | MISSING_GAME + raw/logs/team |
| 21709227 | 2026-05-09 | DET @ CLE | Y | **N** | 0 | 0 | 0 | MISSING_GAME + raw/logs/team |
| 21707975 | 2026-05-10 | SAS @ MIN | Y | **N** | 0 | 0 | 0 | MISSING_GAME + raw/logs/team |
| 21708680 | 2026-05-10 | NYK @ PHI | Y | **N** | 0 | 0 | 0 | MISSING_GAME + raw/logs/team |
| 21708305 | 2026-05-11 | OKC @ LAL | Y | **N** | 0 | 0 | 0 | MISSING_GAME + raw/logs/team |
| 21709231 | 2026-05-11 | DET @ CLE | Y | **N** | 0 | 0 | 0 | MISSING_GAME + raw/logs/team |
| 21707976 | 2026-05-12 | MIN @ SAS | Y | Y stale | 0 | 0 | 0 | STATUS/SCORE + MISSING raw/logs/team |
| 21709235 | 2026-05-13 | CLE @ DET | Y | **N** | 0 | 0 | 0 | MISSING_GAME + raw/logs/team |
| 21707977 | 2026-05-15 | SAS @ MIN | Y | **N** | 0 | 0 | 0 | MISSING_GAME + raw/logs/team |
| 21709238 | 2026-05-15 | DET @ CLE | Y | **N** | 0 | 0 | 0 | MISSING_GAME + raw/logs/team |
| 21709241 | 2026-05-17 | CLE @ DET | Y | **N** | 0 | 0 | 0 | MISSING_GAME + raw/logs/team |
| 21713528 | 2026-05-18 | SAS @ OKC | Y | **N** | 0 | 0 | 0 | MISSING_GAME + raw/logs/team |
| 21713895 | 2026-05-19 | CLE @ NYK | Y | **N** | 0 | 0 | 0 | MISSING_GAME + raw/logs/team |
| 21713529 | 2026-05-20 | SAS @ OKC | Y | **N** | 0 | 0 | 0 | MISSING_GAME + raw/logs/team |
| 21713897 | 2026-05-21 | CLE @ NYK | Y | **N** | 0 | 0 | 0 | MISSING_GAME + raw/logs/team |
| 21713530 | 2026-05-22 | OKC @ SAS | Y | **N** | 0 | 0 | 0 | MISSING_GAME + raw/logs/team |
| 21713899 | 2026-05-23 | NYK @ CLE | Y | **N** | 0 | 0 | 0 | MISSING_GAME + raw/logs/team |
| 21713531 | 2026-05-24 | OKC @ SAS | Y | **N** | 0 | 0 | 0 | MISSING_GAME + raw/logs/team |
| 21713901 | 2026-05-25 | NYK @ CLE | Y | **N** | 0 | 0 | 0 | MISSING_GAME + raw/logs/team |
| 21713532 | 2026-05-26 | SAS @ OKC | Y | **N** | 0 | 0 | 0 | MISSING_GAME + raw/logs/team |
| 21713533 | 2026-05-28 | OKC @ SAS | Y | **N** | 0 | 0 | 0 | MISSING_GAME + raw/logs/team |
| 21713534 | 2026-05-30 | SAS @ OKC | Y | **N** | 0 | 0 | 0 | MISSING_GAME + raw/logs/team |
| 21716134 | 2026-06-03 | NYK @ SAS | Y | **N** | 0 | 0 | 0 | MISSING_GAME + raw/logs/team |
| 21716135 | 2026-06-05 | NYK @ SAS | Y | **N** | 0 | 0 | 0 | MISSING_GAME + raw/logs/team |
| 21716136 | 2026-06-08 | SAS @ NYK | Y | **N** | 0 | 0 | 0 | MISSING_GAME + raw/logs/team |
| 21716137 | 2026-06-10 | SAS @ NYK | Y | **N** | 0 | 0 | 0 | MISSING_GAME + raw/logs/team |
| 21716138 | 2026-06-13 | NYK @ SAS | Y | **N** | 0 | 0 | 0 | MISSING_GAME + raw/logs/team |

---

## Raw vs Analytics Reconciliation

| Check | Result |
| --- | --- |
| Row counts | raw 45,066 = analytics logs 45,066 |
| Distinct games | 1,289 = 1,289 |
| `(game_id, player_id)` raw-only | **0** |
| `(game_id, player_id)` analytics-only | **0** |
| Transform defects (raw yes, logs no) | **0** |
| Provider ingest gaps (raw no and logs no, BDL Final) | **33** |

Conclusion: the 2025 transform from `raw.player_game_stats` → `analytics.player_game_logs` is **consistent**. The hole is **ingestion**, not transform.

---

## Team Stats Reconciliation

`analytics.team_game_stats` is **derived**, not fetched. Built from `player_game_logs` ⨝ `games` in:

- `lambda/nightly-bdl-updater/index.ts` (scoped to affected `game_id`s)
- `scripts/compute-team-stats.ts` (**all seasons**, unscoped)

| Class | Count | IDs |
| --- | ---: | --- |
| Complete (exactly 2 correct teams) | 1,289 | — |
| Missing (0 rows) | 33 | same 33 as missing logs |
| Partial (1 row) | 0 | — |
| Invalid (dupes / wrong teams) | 0 | — |

The 2,578 vs 1,290 Final baseline is **exactly one missing local-Final game** (`21708677`) plus 32 BDL Finals that are not local Finals. Not a scatter of partial rows.

---

## 2025 Repair Manifest Summary

`reports/trial/2025-repair-manifest.json`

| | |
| --- | ---: |
| Provider Final games | 1,322 |
| Local fully clean Finals | 1,287 |
| Repair queue | **35** |
| Requires GOAT `/v1/stats` | **34** |
| Games-only (no GOAT) | **1** (`18446941` score upsert) |

---

## Minimum Repair Operations

### 33 playoff-tail games (no raw, no logs, no team stats)

GOAT required.

1. Upsert `analytics.games` (and `raw.games`) from `/v1/games` payload already in `bdl-games-2025.json` — **does not need GOAT**.
2. `GET /v1/stats?game_ids[]=<id>` (batch) — **needs GOAT**.
3. Archive raw pages to S3 `source=balldontlie` (optional but wanted for trial).
4. For 2025, existing live architecture may still land in `raw.player_game_stats` then `transform-raw-to-analytics` / nightly steps 7–9.
5. Rebuild team stats **for those game IDs only**.
6. Recompute 2025 player/team season averages (season-scoped).

Do **not** refetch provider stats for games that already have matching raw+analytics keys.

### `18447793` SAC @ LAC

Raw exists but is incomplete (~20 pts/side missing). Minimum: GOAT refetch that `game_id`, overwrite raw+logs, rebuild that game’s team stats.

### `18446941` CLE @ WAS

Do **not** refetch stats. Upsert `home_score` from BDL 115 vs local 114. Optionally recompute that game’s team `result` if it used the game score.

### Team stats only

Does not occur in this corpus. If it did: re-run the nightly team-stat CTE for those `game_id`s; no `/stats` call.

Existing execute wrapper: `scripts/ingestion/backfill-season-tail.ts --season=2025 --start 2026-05-06 --end 2026-06-30 --execute --allow-live-api` calls `seed-raw-balldontlie --stats` then **unscoped** `transform-raw-to-analytics.ts`. That is acceptable for **2025-only** repair because 2024 is not in raw. Do not use that wrapper once 2024 raw exists.

---

## Current Ingestion Pipeline Audit

### Games

| Item | Actual |
| --- | --- |
| Provider | BallDontLie `https://api.balldontlie.io/v1/games` |
| Clients | `lambda/nightly-bdl-updater/index.ts`, `lib/balldontlie/refresh-schedule-from-bdl.ts`, `scripts/seed-raw-balldontlie.ts`, `lib/balldontlie/archive-client.ts` |
| Scheduler | Documented EventBridge daily 08:00 UTC / 03:00 ET (`nightly-bdl-updater` header). Freeze currently no-ops live calls (`DATA_MODE=replay`, `OFFSEASON_MODE=1`, `CRON_DRY_RUN=1`). |
| Env | `BALLDONTLIE_API_KEY`, `SUPABASE_DB_URL`, `BALLDONTLIE_REQUEST_DELAY_MS` (default **200**), `MAX_RETRIES` (default 3), `CURRENT_ANALYTICS_SEASON` pin **2025**, `BDL_SCHEDULE_SYNC_DAYS_FORWARD` (default 14), freeze flags |
| Season | BDL `seasons[]=<start year>`; stored as text start year |
| Pagination | cursor (`next_cursor`) for games/stats; page for teams |
| Retries | 429/5xx exponential from **60s** base; **does not read Retry-After** |
| Upsert key | `raw.games.id`; `analytics.games.game_id` (text of BDL id) |
| Idempotency | `ON CONFLICT DO UPDATE` |
| Failure | skip game if home/away team id missing; freeze skips provider |

### Player stats

| Item | Actual |
| --- | --- |
| Endpoint | `/v1/stats` |
| Live path | nightly fetches Finals in the ET window, upserts `raw.player_game_stats` on **stat `id`**, then SELECT from raw ⨝ `raw.games` into `analytics.player_game_logs` |
| **raw.player_game_stats dependency** | **`lambda/nightly-bdl-updater/index.ts` step 7** (`from raw.player_game_stats s join raw.games g`) **and `scripts/transform-raw-to-analytics.ts` step 4** (same join, **unscoped**). Also `scripts/ingestion/backfill-season-tail.ts` execute path. Historical Option B **does not** use it. |
| Cannot delete 2025 raw stats | until nightly + `transform-raw-to-analytics` stop reading it |

### Team stats

Derived from player logs + games. Not a BDL team-stats fetch.

### Season averages

| | Player | Team |
| --- | --- | --- |
| Source | `analytics.player_game_logs` | `analytics.team_game_stats` |
| Nightly | affected **player_ids**, groups by `(player_id, season)` — will also rewrite that player’s **other** seasons if they had logs | affected **seasons** from the Finals just ingested |
| CLI `compute-player-season-averages.ts` | **all seasons** present in logs | — |
| CLI `compute-team-stats.ts` | — | **all seasons** (`where g.season is not null`) |
| Historical plan SQL | `PLAYER_SEASON_AVERAGES_SQL` has `where season = $1` | `TEAM_GAME_STATS_SEASON_PREDICATE = g.season = $1` |
| Rebuild 2024 touching 2025? | Unscoped CLI **re-upserts** 2025 averages from remaining 2025 logs (does not delete). Unsafe only if 2025 **logs** were deleted. Nightly player-average query is **not season-filtered**, so a 2024 backfill that reused nightly code with overlapping player IDs would recompute 2025 avgs too (benign upsert). |

### Player-team stints

Source: PGL appearances via `lib/roster/historical-stint-reconstruct.ts` / `stints-from-logs.ts`. Apply path `scripts/roster/reconstruct-stints-2025-26.ts` **DELETE … WHERE season = $1 AND source = inferred_pgl** then insert. Season-scoped. Does not truncate 2026 `nba_stats` seeds. Fail-closed on key collision with `nba_stats`.

### S3 archive (box scores / BDL)

`scripts/archive/backfill-balldontlie-season.ts`

- Key: `raw/source=balldontlie/league=nba/season=<S>/entity=<games\|player_stats\|teams\|players>/page=<n>.json`
- Manifest: `_manifest.json` (`status`, `pageCount`, `recordCount`)
- Resume: skip-existing pages, harvest `next_cursor` from last page
- Overwrite: `--overwrite`
- Never writes Postgres
- Verification helper: `assertCompleteHistoricalArchive` in `lib/ingestion/historical-serving/archive-gate.ts`
- Current bucket: **no** `season=2024` BDL prefix (storage probe)

---

## Historical Backfill Pipeline Audit

| Claim | Evidence |
| --- | --- |
| Option B `stagingMode: none` | `lib/ingestion/historical-serving/plan.ts` types it as `'none'`; tests assert it |
| Mapper S3 payloads → serving rows without raw stats | `lib/ingestion/historical-serving/bdl-to-serving.ts` — **implemented** |
| Fail-closed identity | exact BDL team id, else unique abbreviation; ambiguous → issue, row skipped |
| Cross-season game id collision | `assertGameSeasonIsolation` skips and records `cross_season_game` |
| Season window | Oct 15–Jun 30 of start year (`season-window.ts`) |
| Archive script | **implemented**, resumable, Postgres-free |
| Orchestrator execute | **NOT implemented**. After a successful probe it still `process.exit(1)` with “Live archive/materialize is gated until WP7.2 provider access is restored.” |
| `--season=2023` | **blocked** (`WP7.2 allows --season=2024 only`) |
| `ingest-previous-season.ts` | archives + **curated parquet**, not compact analytics |

**Verdict:** S3 → analytics without `raw.player_game_stats` is **genuinely implemented as a library + plan**, **not** as a runnable trial job.

---

## S3 Archive/Manifest Audit

| Behavior | Actual |
| --- | --- |
| Object naming | `page=<n>.json` 1-indexed |
| Season prefix | `season=<YYYY>` start year |
| Cursor identity | stored in each page `meta.next_cursor`; resume reads it |
| Retry | 60s × 2^attempt; no `Retry-After` |
| Idempotency | skip-existing unless `--overwrite` |
| Completeness | manifest `success` + pageCount matches listed `page=N` objects |
| Partial archive | detectable (`status=partial` / page count mismatch / missing pages) |
| 2024 BDL prefix | **absent** |

---

## Idempotency & Resume Audit

| Stage | Safe rerun? | Upsert? | Duplicate risk | Cursor persisted? | Partial detectable? | Manual cleanup? |
| --- | --- | --- | --- | --- | --- | --- |
| Games (analytics/raw) | Yes | Yes on id | Low | N/A (full season list) | Yes (ID diff) | No |
| Stats fetch | Yes if upsert on stat id | Yes | Low if same BDL stat ids | No (nightly is date-window, not cursor) | Yes (missing game_ids) | No |
| S3 BDL archive | Yes | skip-existing | Low | Yes (from last page) | Yes (manifest) | No |
| Manifest | Rewritten at finalize | overwrite manifest | N/A | N/A | Yes | No |
| Analytics materialize (2025 transform) | Yes | conflict keys | Low | N/A | Yes (this audit) | No |
| Analytics materialize (2024 Option B) | **Not callable** | mapper is idempotent in tests | N/A until wired | N/A | N/A | N/A |
| Averages | Yes | conflict `(player,season)` / `(team,season)` | Low | N/A | Count drift | No |
| Stints | Yes if season+source DELETE | insert after scoped delete | Low | N/A | Season row counts | No |

**Full restart forced by:** running `--overwrite` on a huge S3 entity; using unscoped `transform-raw-to-analytics` after mixing 2024 into raw; orchestrator stub (cannot resume what never started).

---

## Rate-Limit Audit

There is **no process-wide BDL limiter**. Each of these sleeps independently on `BALLDONTLIE_REQUEST_DELAY_MS` (default 200 ms ≈ 300 req/min):

- `lib/balldontlie/archive-client.ts`
- `lambda/nightly-bdl-updater/index.ts`
- `lib/balldontlie/refresh-schedule-from-bdl.ts`
- `scripts/seed-raw-balldontlie.ts`

None parse `Retry-After`. 429 handling is 60s × 2^n.

This audit hit **429 twice** on `/v1/games` alone.

If archive + seed-raw + nightly + schedule refresh overlap: **`TRIAL_BLOCKER`**.

**Smallest fix (do not implement now):** run trial phases **strictly serially**, and set `BALLDONTLIE_REQUEST_DELAY_MS` to a conservative GOAT value (e.g. 150–250 ms) in one shell. Optional later: honor `Retry-After` in `archive-client.fetchWithRetry` only.

---

## Season Isolation Audit

### Safe if Option B is used as designed

- Mapper refuses to emit a 2024 row whose `game_id` already exists as 2025.
- Planned averages SQL filters `season = $1`.
- Stint DELETE is `season = $1 AND source = inferred_pgl`.
- Raw cleanup planner refuses unscoped DELETE and refuses overlap with protected 2025 game ids (`raw-cleanup.ts`). **Not invoked** by the current orchestrator.

### Unsafe / TRIAL_BLOCKER if the wrong CLI is used

| Path | Risk |
| --- | --- |
| `transform-raw-to-analytics.ts` | Reads **all** `raw.games` and **all** `raw.player_game_stats`. `ON CONFLICT` would **insert 2024 games into analytics** and refresh 2025 from raw. Does not DELETE 2025, but **breaks isolation of “2024-only materialize.”** |
| `compute-team-stats.ts` | Aggregates **every** season. Re-upserts 2025 team games from 2025 logs (usually benign) while adding 2024. |
| `compute-player-season-averages.ts` | All seasons in logs. |
| `backfill-season-tail.ts --execute` | Calls the two unscoped scripts above. |
| `ingest-previous-season.ts` | Not serving tables, but will call `/stats` for 2024. |
| Orchestrator season lock | 2023 cannot run until the `season !== 2024` fatal is removed **after** writers exist. |

No TRUNCATE found on analytics serving tables in the historical-serving module. No hardcoded wipe of 2026 schedule in that module.

**`CURRENT_ANALYTICS_SEASON` pin remains 2025.** Historical scripts take `--season=` explicitly. Nightly uses the pin — keep freeze on so nightly does not fight the trial.

---

## Provider Identity Audit

| ID | Mapping |
| --- | --- |
| BDL game id | stored as `analytics.games.game_id` text; same as raw integer id |
| BDL player id | `analytics.players.player_id` text; logs FK |
| BDL team id | `analytics.teams.team_id` text; nightly `mapTeamId` uses a DB map then falls back to raw id |
| Historical mapper | id exact, else unique abbreviation; **no name fallback**; ambiguous → `ambiguous_team` issue |

This audit: **0 team ID mismatches** on overlapping games. Unmapped players for the 33 missing games are unknown until `/stats` returns. Fail closed: do not invent mappings.

Legacy/defunct franchises: not exercised (2025–26 only uses current 30). Abbreviation collision pool in `buildTeamResolver` prefers ids 1–30.

---

## Storage Checkpoint Integration

Command works (verified previous probe + this run’s `pg_database_size`).

```bash
npx tsx scripts/ops/storage-checkpoint.ts --label=pre-trial --out=reports/storage/pre-trial.json
npx tsx scripts/ops/storage-checkpoint.ts --label=after-2025-repair --out=reports/storage/after-2025-repair.json
npx tsx scripts/ops/storage-checkpoint.ts --label=after-2024 --out=reports/storage/after-2024.json
npx tsx scripts/ops/storage-checkpoint.ts --label=after-2023 --out=reports/storage/after-2023.json
npx tsx scripts/ops/storage-checkpoint.ts --label=end-of-trial --out=reports/storage/end-of-trial.json
```

JSON fields that encode the gates:

- `postgres.bytes` / `postgres.mb`
- `postgres.thresholds.hardStopMb` (450) / `remainingToHardMb`
- `liveReserve.projections.plus2024.dbLowMb` / `dbHighMb`
- `seasonConfirmation["2024"].player_logs` etc.

Stop rules (**not auto-exiting** — operator compares consecutive files):

- After 2024: stop if `mb > 340` or Δmb > 35
- After 2023: expected 338–354; no PG 2022 if ≥ 375
- Hard stop 450 MB

**GREEN** for measurement. **YELLOW** because the script does not `exit 1` on a violated gate.

---

## Trial Phase Readiness Matrix

| Phase | Ready? | Blocking issue |
| --- | --- | --- |
| GOAT access probe | **Yes** | `scripts/ingestion/probe-bdl-historical-access.ts` exists. Do not treat `/stats` 401 as a surprise. |
| 2025 repair | **Mostly** | Manifest is the queue. Needs GOAT `/stats`. Tail wrapper is unscoped but safe **while raw is 2025-only**. |
| 2024 basic backfill (S3) | **Yes** | `backfill-balldontlie-season.ts --season=2024 --entities=games,player_stats` |
| 2024 analytics materialize | **No** | Orchestrator never calls mapper/archive after probe. **TRIAL_BLOCKER** for this phase. |
| 2024 validation | **Partial** | Completeness audit pattern exists; no dedicated 2024 validator wired to serving. |
| 2023 basic backfill | **No** | Orchestrator rejects `season≠2024`. S3 archive script **would** accept 2023. |
| 2022 S3-only archive | **Yes** | Same archive script; do not materialize PG. |
| Advanced Stats V2 archive | **No script** | Safely implement during trial as a thin archive job **or** skip. Prefer prebuild if volume is high. |
| Opening player props | **No historical script** | Live props archive is 2025 `existing_ingestion` only. Needs new GOAT endpoint job. |
| Opening game odds | **No historical script** | Same. |
| 2025 lineups | **Library only** | `lib/balldontlie/lineups.ts`. Tiny probe sufficient first. |
| Optional endpoint probes | **Yes** | One-page probes via `BdlArchiveClient`. |

---

## Trial Blockers

1. **`backfill-historical-season-serving.ts` does not materialize** even with GOAT access. 2024 compact analytics cannot run as documented.
2. **Orchestrator hard-coded `season=2024` only** — blocks 2023 serving.
3. **No shared BDL rate limiter**; overlapping jobs are a 429/`TRIAL_BLOCKER`. Serial execution is the workaround.
4. **Wrong-path risk:** `transform-raw-to-analytics.ts` / `seed-raw-balldontlie --season=2024 --stats` would dump historical stats into `raw.player_game_stats` beside 2025.

These do **not** block activating GOAT for **2025 repair + S3 archives**. They block the **full** 2024→2023 **Postgres** plan.

---

## Non-Blocking Issues

- Nightly frozen (`FROZEN_EXPECTED`) — expected; trial uses explicit admin CLIs.
- `Retry-After` ignored.
- `compute-team-stats.ts` unscoped — do not use it as the 2024 writer.
- One unexpected local game `21681993`.
- One 1-point score drift `18446941`.
- Incomplete box `18447793`.
- `/ops` S3 manifests on Vercel still deferred; CLI is enough.
- `ist_stage` (NBA Cup) not stored on `analytics.games`.
- `analytics.games` has no `postseason` column.
- Default 200 ms delay 429’d this games crawl on the **current** (non-GOAT) key.

---

## Exact Actions Required Before GOAT Activation

Must do (full acquisition plan):

1. Wire `backfill-historical-season-serving.ts` to call archive → verify → `transformBdlArchiveToServing` → **season-scoped** upserts. Remove the post-probe fatal.
2. Allow `--season=2023` only after (1), still default 2022 to S3-only.
3. Document/enforce: **never** `seed-raw-balldontlie --stats` for 2024/2023 during trial.
4. Run trial BDL jobs **one at a time**.
5. Keep Production freeze as-is for Lambdas; admin scripts are explicit.

Should do (2025 repair only, can activate GOAT without 1–2):

1. Use `2025-repair-manifest.json` as the execution queue.
2. Upsert the 26 missing games from the cached `/games` payload (no GOAT needed).
3. After GOAT: fetch `/v1/stats` for the 34 `requiresGoat` IDs.
4. Checkpoint storage after 2025 repair before starting 2024 S3.

Nice to have: honor `Retry-After`; add `exit 1` storage-gate helper.

**Do not repair now.** This audit stops here.

---

## Final GOAT Trial Readiness Grade

| Area | Grade | Why |
| --- | --- | --- |
| 2025 dataset completeness | **YELLOW** | 1,289/1,322 Finals have logs+team stats; playoff tail missing |
| Current ingestion pipeline | **YELLOW** | Live path is real and consistent, but frozen and windowed; 2025 repair needs GOAT + tail CLI |
| Historical S3 archive path | **GREEN** | Script exists, skip-existing, manifests, no PG writes |
| Historical analytics materialization | **RED** | Mapper+tests exist; orchestrator does not execute; 2023 rejected |
| Idempotency/resume | **YELLOW** | 2025 upserts + S3 resume are real; 2024 serving resume unproven in CLI |
| Season isolation | **YELLOW** | Option B is fail-closed; unscoped transform/seed is a foot-gun |
| Rate-limit readiness | **YELLOW** | Independent limiters; 429 observed; serial jobs mitigate |
| Storage checkpoint readiness | **GREEN** | Live command + JSON thresholds |
| **GOAT trial overall** | **YELLOW** | Activate for 2025 repair + S3 history; do not PG-materialize 2024/2023 until wired |

---

## Explicit answers

1. **How many authoritative 2025–26 Final games exist?**  
   **1,322** (`status_state=final` on every BDL `seasons[]=2025` game).

2. **How many have complete player-game logs?**  
   **1,289** (zero logs on **33** Finals).

3. **How many have complete team-game stats?**  
   **1,289** (exactly two rows). **33** have zero.

4. **Which exact BDL game IDs need repair?**  
   35 IDs in `reports/trial/2025-repair-manifest.json`. Core 33: `21707973`, `21708674`, `21708301`, `21709223`, `21707974`, `21708677`, `21708303`, `21709227`, `21707975`, `21708680`, `21708305`, `21709231`, `21707976`, `21709235`, `21707977`, `21709238`, `21709241`, `21713528`, `21713895`, `21713529`, `21713897`, `21713530`, `21713899`, `21713531`, `21713901`, `21713532`, `21713533`, `21713534`, `21716134`, `21716135`, `21716136`, `21716137`, `21716138`. Plus `18446941`, `18447793`.

5. **For each game, what is missing?**  
   See matrix. 33 playoff games: raw stats + logs + team stats (26 also missing `analytics.games`). `18446941`: 1-pt score. `18447793`: incomplete box (~20 pts/side).

6. **Which repairs require GOAT?**  
   **34 / 35.** Only `18446941` is games-table score upsert. All 33 tail games and `18447793` need `/v1/stats`.

7. **Can the 2024 historical backfill run safely without touching 2025?**  
   **S3 archive: yes. Analytics materialize: not with the current orchestrator.** If someone uses `seed-raw` + `transform-raw-to-analytics`, **no**.

8. **Can the 2023 historical backfill run safely after 2024?**  
   **S3: yes. Serving CLI: no** (`season=2024` only). Same isolation caveats as 2024.

9. **Can every acquisition phase resume after interruption without duplicating data?**  
   **S3 archive and 2025 upserts: yes.** 2024 serving CLI: **cannot resume because it never starts.**

10. **Is there any pipeline issue that should prevent us from starting the 48-hour GOAT trial?**  
    **Do not start the full 2024/2023 Postgres materialization plan until the orchestrator is wired.**  
    **You may activate GOAT** to repair the 2025 playoff tail and to archive 2024/2023/2022 raw pages to S3, with serial jobs and storage checkpoints. Freeze stays unchanged.
