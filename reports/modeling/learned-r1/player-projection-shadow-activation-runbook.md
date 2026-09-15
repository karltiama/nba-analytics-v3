# Activation runbook — PTS C / REB C shadow + context collection

This slice **does not activate**. Collectors are not running until a deployed successful pull exists.

## 1. Frozen artifacts

```bash
npx tsx scripts/modeling/freeze-learned-shadow-bundle.ts
npx tsx scripts/modeling/verify-learned-shadow-bundle.ts
npx tsx scripts/modeling/upload-learned-shadow-bundle.ts
```

Local verification is checksum + Python rescoring of `sample_features.jsonl`. This slice **did** persist the bundle to `s3://nba-analytics-data-260029269390/research/models/player-projection-shadow-pts-reb-c-r1/` (`written`, skip-if-exists). That is separate from packaging. Re-runs will report `exists` rather than overwrite.

Required local files: `reports/modeling/shadow-pts-reb-c-r1/{manifest.json,c_points.cbm,c_rebounds.cbm,feature_order.json}`.

## 2. Migration (not applied here)

```bash
# Review, then apply only after an explicit activation decision:
# psql "$SUPABASE_DB_URL" -f db/schemas/MIGRATION_context_collection_snapshots.sql
```

Do not apply during freeze. Rollback of the migration is a DBA action; collected `raw.injury_pull_runs` / `raw.player_injuries` rows must be kept.

## 3. Environment / flags (verified behavior)

| Flag | Actual effect |
| --- | --- |
| `DATA_MODE=replay` (or missing/unknown) | `shouldSkipLiveMutations` true. Injuries Lambda returns `skipped: true` and does **not** call BDL or write. |
| `OFFSEASON_MODE=1` or `CRON_DRY_RUN=1` | Same skip, even if `DATA_MODE=live_api`. |
| `DATA_MODE=live_api` and freeze flags `0` | Provider calls and DB writes **are allowed**. Replay does not magically block every script; research report files can still be written. |
| `SHADOW_SNAPSHOT_WRITES=1` | Required **in addition** to live mode before production `prediction_snapshots` writes. |
| `injuries_execution_enabled` | Terraform EventBridge ENABLED only when this is true **and** live ingestion is on. Default false. |

Activation would require all of: applied migration, `DATA_MODE=live_api`, `OFFSEASON_MODE=0`, `CRON_DRY_RUN=0`, family execution flags true, artifacts readable by the scorer host, `SHADOW_SNAPSHOT_WRITES=1` for snapshot persistence.

## 4. Provider entitlements

- **Verified in repo:** injuries collector uses BallDontLie `GET /nba/v1/player_injuries` (existing key). BDL lineups for 2026 postgame starters require `BDL_GOAT_SUBSCRIPTION=1`; without it the starters stage is blocked. Those lineups are **post-tip confirmed**, not pregame provider lineups.
- **Unverified here:** whether the live BDL key still has injuries quota; whether GOAT is paid; AWS permission to put the research prefix; EventBridge/Scheduler IAM for a new shadow poller (no shadow schedule exists today).

## 5. Proposed collection cadence (estimate only)

Existing injuries example cron: `cron(0 13,18,22 * * ? *)` (3×/day). Shadow scoring: poll every 15 minutes and generate for games in their own `due` window (cutoff−15m through cutoff). Request volume: injuries ~3 full report pulls/day; shadow scoring is local CatBoost, no extra BDL if logs/TGS are already in Postgres. Do not enable these schedules in this slice.

## 6. Read-only AWS check

```bash
npm run ops:aws-ingestion-status
```

Never invokes Lambda or mutates schedules. If credentials are missing, treat scheduler state as unknown — not “disabled with proof.”

## 7. Successful-run verification and stale-data alerts (after activation)

- Injuries: new `raw.injury_pull_runs` row with `status=success`, completeness reason stored, membership persisted, current table not mass-cleared on the next failed pull, `RemovedFromReport` distinct from Available.
- Shadow: `prediction_snapshots` rows with real `generated_at`, on-time rate, missing coverage; settlements do not update snapshots.
- Alert if latest successful injury pull age exceeds 36h, or if shadow `missing` for tonight’s due games is >0 at tip.

## 8. Rollback / disable

Set `CRON_DRY_RUN=1` and/or `injuries_execution_enabled=false` / disable any future shadow schedule. Freeze skips **new** provider calls and writes. Existing raw observations, history, and snapshots stay. Do not DELETE collected evidence.

## 9. Remaining activation decisions

1. Apply the SQL migration or keep extras in `metadata` only.
2. Thaw `DATA_MODE` / offseason / dry-run.
3. Flip Terraform `injuries_execution_enabled` (and any new shadow poller).
4. Confirm BDL injuries + GOAT entitlements in the target account.
5. Confirm `NBA_DATA_BUCKET` upload of the frozen bundle (`remote.succeeded`).
6. Set `SHADOW_SNAPSHOT_WRITES=1` only when Postgres snapshot tables exist.
7. Name the first regular-season tip that starts the 60-day window.
8. Decide who pages on missing/late predictions vs collection health.
