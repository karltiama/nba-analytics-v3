# 2023 targeted mismatch refetch (Step 4C)

Generated: 2026-09-08T19:00:11.683Z

**YELLOW — some provider mismatches remain; review before materialization**

Do not materialize 2023. Do not start Advanced Stats. Do not start 2022. No further BDL requests from this step.

## Safety State

All preflight checks passed before execute:

| Check | Value |
| --- | --- |
| `BDL_TRIAL_MODE` | `1` |
| configured request spacing | 13,000 ms |
| concurrency | 1 |
| acquisition lock | acquired, then released |
| `DATA_MODE` | `replay` |
| `OFFSEASON_MODE` | `1` |
| `CRON_DRY_RUN` | `1` |
| season pin | 2025 |
| Production | frozen |
| 2023 serving | empty |
| `raw.player_game_stats` 2023 | 0 |

Independent Postgres re-check after execute: 2023 games/logs/team stats/averages/stints = 0; `raw.player_game_stats` 2023 = 0; raw total still 46,056; 2024 = 1,321 games; 2025 = 1,323 games; `18447793` still 109–118.

## Queue Confirmation

Exact allowlist of 10. Queue matched. No extra game IDs.

`1038319`, `1038322`, `1038342`, `1038362`, `1038379`, `1038433`, `1038439`, `1038453`, `1038491`, `1038504`

Planned requests: **10**. Actual HTTP attempts: **11** (one Retry-After retry of `1038433`).

## Request Result

- 10/10 games returned HTTP 200
- 1× HTTP 429 on `1038433`, Retry-After backoff used, then 200
- 10 repair objects written
- 0 skips
- 0 `REFETCH_FAILED`
- Endpoint: `GET /v1/stats?game_ids[]=<id>&per_page=100` via `BdlArchiveClient.paginate`
- Original season `page=N.json` crawl was not reused as the fetch path

## Old vs Fresh Comparison

All 10: identical player IDs, identical provider stat IDs, identical row counts, identical team point sums. Fresh boxes remain structurally complete (both teams, 0 duplicate `(game_id, player_id)`, 0 duplicate stat IDs, 0 missing IDs, 0 foreign teams) and still fail score reconciliation by the same deltas as 4B.

| Game | Matchup | Official | Original pts | Fresh pts | Identical | Result |
| --- | --- | --- | --- | --- | --- | --- |
| 1038319 | PHI vs GSW | 104–127 | 104–125 (GSW −2) | 104–125 (GSW −2) | yes | `REFETCH_IDENTICAL_PROVIDER_ANOMALY` |
| 1038322 | MIA vs SAS | 116–104 | 114–104 (MIA −2) | 114–104 (MIA −2) | yes | `REFETCH_IDENTICAL_PROVIDER_ANOMALY` |
| 1038342 | BKN vs SAS | 123–103 | 123–101 (SAS −2) | 123–101 (SAS −2) | yes | `REFETCH_IDENTICAL_PROVIDER_ANOMALY` |
| 1038362 | LAC vs MIN | 100–121 | 96–121 (LAC −4) | 96–121 (LAC −4) | yes | `REFETCH_IDENTICAL_PROVIDER_ANOMALY` |
| 1038379 | PHX vs DET | 116–100 | 111–95 (both −5) | 111–95 (both −5) | yes | `REFETCH_IDENTICAL_PROVIDER_ANOMALY` |
| 1038433 | OKC vs HOU | 112–95 | 110–95 (OKC −2) | 110–95 (OKC −2) | yes | `REFETCH_IDENTICAL_PROVIDER_ANOMALY` |
| 1038439 | DEN vs SAC | 117–96 | 114–96 (DEN −3) | 114–96 (DEN −3) | yes | `REFETCH_IDENTICAL_PROVIDER_ANOMALY` |
| 1038453 | MEM vs POR | 92–122 | 89–122 (MEM −3) | 89–122 (MEM −3) | yes | `REFETCH_IDENTICAL_PROVIDER_ANOMALY` |
| 1038491 | GSW vs MIL | 125–90 | 122–90 (GSW −3) | 122–90 (GSW −3) | yes | `REFETCH_IDENTICAL_PROVIDER_ANOMALY` |
| 1038504 | NYK vs ORL | 98–74 | 98–72 (ORL −2) | 98–72 (ORL −2) | yes | `REFETCH_IDENTICAL_PROVIDER_ANOMALY` |

No additional player rows. No changed player points. No changed stat IDs. Reconciliation not corrected.

## Fixed Games

None. `X = 0`.

## Still-Unresolved Games

All 10. `Y = 10`. Classification: `UNRESOLVED_PROVIDER_ANOMALY`.

Game-scoped `/v1/stats` returns the same player rows as the archived season pages. Nested game scores in those rows still match the official games-archive scores, not the player-pts sums. Likely a stable BDL `/v1/stats` data issue, not an archive/pagination artifact.

Do not fabricate missing points. Do not alter individual player stats. Do not force sums to official score.

Next-decision evidence (no more API calls in 4C):

- original mismatch = fresh mismatch
- responses identical
- structural integrity = pass
- likely provider-data issue on `/v1/stats`

Separate later choice: hold these 10 out of materialization, try another BDL endpoint (e.g. box scores) for verification, or document the provider anomaly.

## Preferred Source Per Game

All 10: preferred source `ORIGINAL_SEASON_PAGE_UNRESOLVED`. Materialize flag `UNRESOLVED_PROVIDER_ANOMALY`. Not `READY_TO_MATERIALIZE`. Repair objects are archived for audit only.

## 2023 Safe-Materialization Count

- Clean from original archive: **1,309**
- Fixed by targeted refetch: **0**
- Still unresolved: **10**
- Total safe to materialize: **1,309 / 1,319**

Desired 1,319 / 1,319 was not forced.

## S3 Repair Archive Result

Prefix: `raw/source=balldontlie/league=nba/season=2023/entity=player_stats/`

Repair objects (new, game-scoped):

- `game_id=1038319.json` … `game_id=1038504.json` (10 present)
- `_repair_10mismatch_manifest.json` (`kind=targeted_2023_mismatch_repair_10`, written=10, `overwritesSeasonPages=false`)

Original preserved:

- season `page=267,268,274,275,281,282,287,307,308,309,314,327,331.json` still present
- season `_manifest.json` still present (`entity=player_stats`, season=2023, written=461)

Original page bodies remain `{ data, meta }` envelopes. Repair bodies are `{ schemaVersion, source, endpoint, season, game_id, kind, pages, fetchedAt }`.

## Rate-Limit Result

| Metric | Value |
| --- | --- |
| planned requests | 10 |
| actual requests | 11 |
| HTTP 200s | 10 |
| 429s | 1 |
| retries | 1 |
| Retry-After usage | 1 (reported 58s) |
| wall-clock | 62,485 ms (~1.0 min) |
| configured delay | 13,000 ms |
| concurrency | 1 |
| measured avg spacing | 6,202 ms |
| measured min spacing | 307 ms |

API key not logged.

Spacing note: `paginate()` sleeps 13s between pages of one crawl, not between separate game-scoped first pages. Ten independent `paginate()` calls therefore fired much faster than 13s until BDL returned 429. The limiter was not tightened; this is the existing first-page skip. Do not treat this as permission to keep bursting. Future game-scoped batches should wait 13s before each first page. No extra requests were made after the 10-game queue.

## Postgres Unchanged Confirmation

| Table | 2023 count |
| --- | --- |
| `analytics.games` | 0 |
| `analytics.player_game_logs` | 0 |
| `analytics.team_game_stats` | 0 |
| `analytics.player_season_averages` | 0 |
| `analytics.team_season_averages` | 0 |
| `analytics.player_team_stints` | 0 |
| `raw.player_game_stats` (season 2023) | 0 |

No serving writes. Production remains frozen.

## Recommended Next Step

Do not materialize 2023 yet. Do not make more API requests in 4C. Decide separately:

1. Hold the 10 unresolved games out and materialize 1,309 only after a dedicated preflight, or
2. Seek another BDL endpoint (box scores) for verification in a later authorized step, or
3. Document a stable `/v1/stats` provider anomaly for these 10 IDs.

## Step Verdict

**YELLOW — some provider mismatches remain; review before materialization**
