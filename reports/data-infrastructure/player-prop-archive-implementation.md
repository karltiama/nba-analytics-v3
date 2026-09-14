# Player-prop market archive implementation

Durable, append-only S3 tape for every successfully ingested player-prop snapshot batch. Postgres remains the 3-day operational store. S3 is the historical source of truth.

This work does **not** change production Track A, Track B.1, calibration, prop APIs, betting UI, or polling cadence. Schedulers stay freeze-disabled.

## Current ingestion flow

```
EventBridge Scheduler nba-player-props-* (often DISABLED / freeze)
  → lambda/player-props-snapshot/controller.ts
  → SQS PLAYER_PROPS_QUEUE_URL (batch_size=1, maxReceiveCount=4)
  → lambda/player-props-snapshot/worker.ts
  → fetch.ts (BDL GET /v2/odds/player_props)
  → normalize.ts
  → bulkInsertRawV2 → raw.player_prop_snapshots_v2
  → identity filter → analytics.player_props_current
  → completeGameRun → raw.player_prop_game_runs
  → Daily Vercel cron GET /api/cron/prune-props
  → materializeClosingLines → research.prop_decision_lines (snapshot_at < game_start_time)
  → legacy archive-gate: season dump entity=player_props_raw_v2 (existing_ingestion)
  → DELETE raw older than 3 days
```

The previous “archive” process dumped whatever still remained in Postgres. `raw.player_prop_snapshots_v2` is pruned after ~3 days. Workers had no S3 IAM. Most of 2025–26 market history was lost.

## New archival flow

```
BDL
  → worker fetch + normalize
  → Postgres operational rows (raw v2 + current tables)
  → S3 append-only object per (pull_run_id, game_id)
  → game_run archive_status = archived | failed
  → SQS retry if archive failed after rows_stored > 0
  → prune: age-eligible AND (legacy dump OK OR per-run archive_status=archived)
```

Write order is **Postgres first, then S3**.

Why: boards already depend on DB; a failed S3 write leaves rows inside the 3-day window for SQS retry. The object key uses `raw.player_prop_game_runs.started_at` (controller-created), so retries hit the same immutable key.

Critical invariant: if `PLAYER_PROP_S3_ARCHIVE_ENABLED=true` and `rows_stored > 0` and archive is not verified, the worker **throws** after recording `archive_status=failed`. It never reports a fully successful game run with stored rows and zero archive.

## S3 object schema

Gzip JSON envelope (`player_prop_snapshots.v1`). One object per `(pull_run_id, game_id)`, not per prop row.

Envelope fields: `schemaVersion`, `archiveVersion`, `source`, `league`, `season`, `pull_run_id`, `game_id`, `source_game_id`, `game_date`, `snapshot_at`, `game_start_time`, `timing`, `row_count`, `checksum`, `rows[]`.

Each row keeps normalized market fields plus `raw_json` from the in-memory fetch (even when Postgres samples `raw_json`).

S3 user metadata (also in the envelope): `checksum`, `row-count`, `pull-run-id`, `game-id`, `archive-version`.

`timing` is `pregame | post_tip | unknown`. Post-tip snapshots are archived as raw truth. Research / `prop_decision_lines` still require `fetched_at < game start_time`.

## Key format

UTC, deterministic, immutable:

```
raw/source=balldontlie/league=nba/season={startYear}/entity=player_prop_snapshots/
  game_date={YYYY-MM-DD}/game_id={id}/
  snapshot_at={YYYY-MM-DDTHH-MM-SS}Z__pull={pullRunId}.json.gz
```

Example:

`raw/source=balldontlie/league=nba/season=2026/entity=player_prop_snapshots/game_date=2026-10-21/game_id=12345/snapshot_at=2026-10-21T18-00-00Z__pull=99.json.gz`

Never write under `source=existing_ingestion` or `entity=player_props_raw_v2`.

## Archive state model

On `raw.player_prop_game_runs`:

| `archive_status` | Meaning |
| --- | --- |
| `pending` | Archive flag off, or not yet attempted |
| `archived` | Verified object (written or idempotent skip) |
| `failed` | S3 write/conflict/config error |

DB `status` may be `success` while `archive_status=failed`. That is detectable. Empty fetches (`rows_stored=0`) may mark `archived` with zero objects.

`rows_archived` is the **payload row count** (all normalized rows for that pull/game), not the hourly-unique `rows_stored` count.

## Failure/retry behavior

Primary recovery: SQS retry (maxReceiveCount=4) of the same `pull_run_id` + `game_id` + `started_at` key.

- Same checksum → skip, treat success
- Different checksum → **conflict**, do not overwrite, fail loudly
- After 4 failures → DLQ (`nba-player-props-archive-gap` / worker failures / DLQ alarms)

Secondary recovery during the 3-day Postgres window: reconciliation reports missing tapes. Re-archive from still-retained rows is possible but **lossy** versus the original pull (hourly unique index can drop intra-hour rows). Prefer SQS retry of the original payload.

Do not refetch BDL onto the same key with a different payload.

## Prune safety invariant

When `PLAYER_PROP_ARCHIVE_REQUIRED_FOR_PRUNE` is **false** (default): current behavior. Age-eligible raw rows need the legacy season dump gate (`entity=player_props_raw_v2` / `existing_ingestion`).

When **true**:

- New rows (`pull_run_id IS NOT NULL` and not before cutoff): delete only if `game_runs.archive_status = 'archived'`
- Missing required archives: **do not delete those rows**; log `PruneBlockedArchiveMissing`; still prune verified rows
- Legacy rows: still use the recovered `player_props_raw_v2` dump gate
- The dump gate is **not** applied to 2026–27 balldontlie snapshot objects (different prefix/entity)

`research.prop_decision_lines` materialization still runs first and still blocks raw prune when pending closing-line keys remain.

## Legacy cutoff behavior

Simplest robust rule:

1. `raw.player_prop_snapshots_v2.pull_run_id IS NULL` → **legacy** (old season dump gate)
2. Optional `PLAYER_PROP_ARCHIVE_REQUIRED_AFTER` (ISO UTC). Game runs started before that timestamp are treated as legacy even if they have a pull_run_id
3. After cutoff, archive verification is required before prune

Historical recovered objects (~27 files, Apr 2–May 2 2026, `entity=player_props_raw_v2`) are immutable evidence. This implementation does not list, rename, copy, or delete them.

## IAM changes

Player-props **worker** only, and only when `nba_data_bucket_name` is non-empty:

- `s3:PutObject`
- `s3:GetObject` (HeadObject is authorized by GetObject)

Resource:

`arn:aws:s3:::<bucket>/<nba_raw_prefix>/source=balldontlie/league=nba/season=*/entity=player_prop_snapshots/*`

No `DeleteObject`, no `s3:*`, no bucket admin, no list required for the worker. Controller unchanged.

Terraform defaults:

- `player_prop_s3_archive_enabled = false`
- `player_props_enable_schedule = false` (unchanged)
- `player_props_execution_enabled` / `live_ingestion_enabled` unchanged

## Lifecycle policy

The archive bucket is **not** provisioned by this Terraform stack (`NBA_DATA_BUCKET` is external). Last known audit: versioning off; no Terraform lifecycle rules.

**Operator check before enabling writes:** confirm the `.../entity=player_prop_snapshots/` prefix does **not** inherit object expiration. Do not enable expiration on this tape. Do not change unrelated prefixes (`existing_ingestion`, opening props, etc.).

Recommended (manual, out of band): versioning on the bucket; no expire rule matching `entity=player_prop_snapshots`.

## Reconciliation

```
npm run reconcile:prop-archive -- --date 2026-10-21
npm run reconcile:prop-archive -- --from 2026-10-21 --to 2026-10-22
npm run reconcile:prop-archive -- --date 2026-10-21 --s3
```

Read-only. Compares `raw.player_prop_game_runs` in the UTC date window. Optional `--s3` HeadObject on `archive_key`. Exits non-zero when `rows_stored > 0` without `archive_status=archived`, or when archive_status is `failed`.

Local simulation (no AWS):

```
npm run simulate:prop-archive
```

Research reader: `lib/archive/player-prop-snapshot-reader.ts` (by key / game / date). Does not reload into Postgres.

## Monitoring

Worker EMF namespace `NBA/PlayerProps`:

- Per game (`Component=Worker`): `RowsFetched`, `RowsRawV2`, `RowsArchived`, `ArchiveObjectsWritten`, `ArchiveFailed`, `ArchiveGap`
- Per batch (`Component=WorkerBatch`): `GamesSucceeded`, `GamesFailed`, `ArchiveGap`, `ArchiveFailed`

Alarms (missing metrics = notBreaching):

- `nba-player-props-archive-gap` — `ArchiveGap >= 1`
- `nba-player-props-archive-failed` — `ArchiveFailed >= 1`

Structured error logs:

- `player_prop_archive_gap`
- `PruneBlockedArchiveMissing`

## Cost estimate

Assumptions: ~15 games/night, ~20 snapshots/game/day once cadence is later enabled, ~180 regular-season days.

- Objects / season: ~15 × 20 × 180 ≈ **54,000**
- PUT/HEAD per snapshot: 1–2 requests (idempotent retry extra HEADs)
- Gzip JSON: typically far smaller than uncompressed JSONL dumps; even at 0.5 MB/object → ~27 GB/season
- S3 standard storage at that size is cheap versus losing the tape

No user PII expected in sportsbook snapshots (player names, teams, lines, odds, vendor ids). `raw_json` is provider market payload, not account data.

## Rollout plan

1. Apply `db/schemas/MIGRATION_player_prop_snapshot_archive.sql` (additive). **Required before deploying the worker that writes archive columns.**
2. Deploy Lambda + IAM with `player_prop_s3_archive_enabled = false`. Confirm `player_props_enable_schedule` stays false and family execution stays freeze-disabled.
3. Confirm bucket lifecycle does not expire `entity=player_prop_snapshots`.
4. Staged enable: `player_prop_s3_archive_enabled = true` + `NBA_DATA_BUCKET`. Watch `ArchiveGap` / `ArchiveFailed`.
5. After a clean day of archives: set Vercel `PLAYER_PROP_ARCHIVE_REQUIRED_FOR_PRUNE=true` (and optional `PLAYER_PROP_ARCHIVE_REQUIRED_AFTER`).
6. Run `npm run reconcile:prop-archive -- --date <yesterday>`.
7. Do **not** enable new polling cadence in this change.

## Rollback plan

1. Set `player_prop_s3_archive_enabled = false` (workers stop writing; `archive_status` stays `pending`).
2. Leave `PLAYER_PROP_ARCHIVE_REQUIRED_FOR_PRUNE=false` so prune can use the legacy dump gate for old rows. If prune-required was already on, **keep it on** until remaining new-run rows are archived or you accept 3-day loss of unarchived new rows.
3. Do not delete S3 objects already written.
4. Do not revert the additive migration (columns are unused-safe).

## Remaining risks

- Enabling prune-required before the worker is actually writing archives will retain new-run rows forever (safe, but operational storage grows).
- Enabling archive writes without prune-required still allows the 3-day job to delete unarchived new rows if the legacy dump gate passes for that season.
- SQS exhausted → DLQ; recovery then depends on Postgres retention.
- Bucket lifecycle misconfiguration could still expire the tape (out of Terraform).
- Hourly unique index means S3 can contain more rows than `rows_stored`.
- `STORE_PROP_RAW_JSON` still samples Postgres `raw_json`; S3 always stores `raw_json` from the normalized in-memory payload.
