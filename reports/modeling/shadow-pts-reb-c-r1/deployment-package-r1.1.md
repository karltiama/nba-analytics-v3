# PTS C / REB C shadow — deployment package r1.1

This package is **implementation complete**. It is **not deployed** and **not running**. Frozen models were not retrained or overwritten.

| State | This slice |
| --- | --- |
| Implementation complete | Yes |
| Deployed disabled | No — Terraform was not applied |
| Running with successful evidence | No — no live collection, no shadow writes |

S3 model objects at `s3://nba-analytics-data-260029269390/research/models/player-projection-shadow-pts-reb-c-r1/` were already persisted in the freeze slice (`skip_if_exists`). This slice does not re-upload them.

## 1. Source provenance

Preserved original freeze record: `reports/modeling/shadow-pts-reb-c-r1/manifest.v1.json` (HEAD `43af63fa`, `working_tree_dirty: true`).

New versioned record: `reports/modeling/shadow-pts-reb-c-r1/manifest.v1.1.json` (written after the scoped commit). `manifest.json` is updated to the same provenance so loaders keep working. Model and dataset hashes are unchanged.

Checksummed source archive (no credentials, no `rows.jsonl`, no `.cbm`):

- `reports/modeling/shadow-pts-reb-c-r1/source/shadow-source-r1.1.txt`
- `reports/modeling/shadow-pts-reb-c-r1/source/inventory.json`

Local schema evidence: `reports/modeling/shadow-pts-reb-c-r1/local-schema-verification.json`.

## 2. Deployable worker (disabled by default)

| Piece | Path |
| --- | --- |
| Node orchestration Lambda | `lambda/shadow-projection/index.ts` |
| Python CatBoost scorer | `lambda/shadow-projection-scorer/handler.py` |
| Cycle logic | `lib/betting/player-projection-shadow-worker.ts` |
| Terraform | `infra/shadow-projection.tf` |
| Package | `npm run build:shadow-projection-lambda` / `npm run build:shadow-scorer-lambda` |

Scheduler: EventBridge `rate(5 minutes)`, created only when `shadow_create=true` **and** `shadow_enable_schedule=true`. **State is DISABLED** unless `live_ingestion_enabled && shadow_execution_enabled`.

Default event `{}` runs score then settle. `{ "action": "score" }` or `{ "action": "settle" }` select one path. Settlement is this Lambda, not the GOAT post-tip lineup worker.

## 3. T−60 amendment (protocol r1.1)

Documented in `player-projection-shadow-protocol-r1.md`. Not a silent redefinition of late as on-time.

| Item | Value |
| --- | --- |
| Feature cutoff | scheduled tipoff − 60 minutes |
| Scheduler interval | 5 minutes |
| Due window | [cutoff − 5 minutes, cutoff] |
| Allowable execution latency | 90 seconds to **start** a due cycle (ops SLA only) |
| On-time | `generated_at <= intended_cutoff_at` |
| Primary evaluation | on-time only |
| Window start | first scheduled regular-season tipoff in `analytics.games` season 2026 with ET date ≥ 2026-10-15, captured in `analytics.shadow_window_anchors`. Tipoff revisions append. |

## 4. Local migration / DB verification

Ran against disposable Docker `postgres:16-alpine` (not production).

Results in `local-schema-verification.json`: **passed**.

Covered: optional missing schema exposes `schema_enrichment=unavailable`; required missing schema fails preflight; SAVEPOINT recovers an aborted subtransaction; migration applies; snapshot unique-key retry; required writes after migration.

## 5. Dependency and guard matrix

| Need | Family / flag | Effective ENABLED condition | Planned scheduler | GOAT? | Live provider probe? |
| --- | --- | --- | --- | --- | --- |
| Tipoff / status revisions | `game_status_sync` | `live_ingestion_enabled && game_status_sync_execution_enabled` | existing 15 min (already ENABLED in AWS before this slice) | No | Previously certified `/v1/games` |
| Fresh box logs + TGS + settlement inputs | `nightly` (`nightly-bdl-updater`) | `live_ingestion_enabled && nightly_execution_enabled` | daily 08:00 UTC, currently DISABLED | No | `/v1/stats` historically 401; nightly uses existing BDL stats path — **probe not run this slice** |
| Injury collection | `injuries` | `live_ingestion_enabled && injuries_execution_enabled` | 2–3x daily cron, currently DISABLED | **No** (independent of GOAT lineups) | `/nba/v1/player_injuries` **UNKNOWN until live probe** |
| Shadow prediction writes | `shadow_*` + `SHADOW_SNAPSHOT_WRITES` | `live_ingestion_enabled && shadow_execution_enabled` (HCL last-merge sets writes=1 and `COLLECTION_SCHEMA_MODE=required`) | 5 min DISABLED until those flags | No | None (scores frozen local/S3 models) |
| Optional post-tip lineups | `postgame` | `live_ingestion_enabled && postgame_execution_enabled` | SQS ESM, NOT a shadow dependency | Yes (`/nba/v1/lineups`) | **Do not enable for PTS/REB shadow** |
| Odds | `odds` | keep false | unchanged | Yes | Not this slice |
| Player props | `player_props_*` | keep false | unchanged | Yes | Not this slice |
| BBRef boxscore scraper | `boxscore` | keep false | not required if nightly BDL logs are the settlement source | No | Not this slice |

**Do not** set `live_ingestion_enabled=true` alone. That cannot ENABLE any family; each family still needs its own `*_execution_enabled`. Do not turn on odds/props/postgame for this work.

Migration `db/schemas/MIGRATION_context_collection_snapshots.sql` must be applied **before** `COLLECTION_SCHEMA_MODE=required` / shadow writes. This slice does not apply it to production.

## 6. Ordered deploy / activate / rollback

### A. Implementation only (this slice — already the current state)

No AWS apply. No production SQL. No live collection.

### B. Deploy disabled (CODE_ONLY — not done here)

1. `npm run build:shadow-projection-lambda`
2. `npm run build:shadow-scorer-lambda` (pip install catboost into `.package`; confirm zip unzipped size &lt; 250MB)
3. Apply SQL to the **target** database (not done here): `db/schemas/MIGRATION_context_collection_snapshots.sql`
4. Terraform with `shadow_create=true`, `shadow_enable_schedule=true`, all `*_execution_enabled=false`, `live_ingestion_enabled=false`.
5. Confirm EventBridge rule state **DISABLED**, Lambda env `DATA_MODE=replay`, `SHADOW_SNAPSHOT_WRITES=0`, `COLLECTION_SCHEMA_MODE=optional`.

Rollback B: `shadow_create=false` (destroys CODE_ONLY resources) or leave created with schedule DISABLED.

### C. Activate (explicit later decision — not done here)

Order matters. Smallest thaw, not a global thaw:

1. Confirm injury entitlement independently (live GET `/nba/v1/player_injuries`) — **not done**.
2. `injuries_execution_enabled=true` and injuries env `DATA_MODE=live_api`, `OFFSEASON_MODE=0`, `CRON_DRY_RUN=0`, `COLLECTION_SCHEMA_MODE=required` **after** migration. Keep `BDL_GOAT_SUBSCRIPTION` unset unless post-tip lineups are intended.
3. `nightly_execution_enabled=true` and nightly env live flags, for box freshness + settlement. Do not enable odds/props/boxscore/postgame.
4. `shadow_execution_enabled=true` and `live_ingestion_enabled=true` (needed as the master AND-gate). Keep odds/props/postgame/boxscore execution false.
5. Capture `analytics.shadow_window_anchors` for season 2026 after the authoritative schedule is present. Window starts at that first RS tipoff, not the first successful prediction.

Rollback C: set `shadow_execution_enabled=false` (and/or `live_ingestion_enabled=false` if no other family should run). Does not delete immutable snapshots. Does not restore overwritten models (none were overwritten).

## 7. Remaining decisions (not made)

- Live `/nba/v1/player_injuries` entitlement probe.
- Whether nightly BDL `/v1/stats` is entitled for 2026 box freshness (prior canary was 401 on a related path).
- Notification destination: no SNS topic / `OPS_ALERT_SNS_TOPIC_ARN`. CloudWatch Errors alarm is visibility-only (`treat_missing_data=notBreaching`, no `alarm_actions`). Alerts are prepared disabled; no messages sent.
- Whether to apply the snapshot migration to production.
- Whether to Terraform-apply `shadow_create`.

## 8. Monitoring

`GET /api/ops/health` / `npm run ops:health-snapshot` now includes `shadow`: last successful run age, failed/incomplete, unresolved/ineligible, due/on-time/late/failed/missing, stale feature inputs, settlement backlog, schema enrichment, window start. Frozen + missing schema is exposed as unavailable, not a silent skip. Required writes + missing schema is FAILED.
