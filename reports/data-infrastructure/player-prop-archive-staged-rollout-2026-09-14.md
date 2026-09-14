# Player-prop staged archive rollout — 2026-09-14

Controlled verification against live AWS + Postgres. Polling was not enabled. Modeling/UI were not changed. Legacy `existing_ingestion` objects were not written.

## Preflight

- Branch: `ui/court-context-shell` @ `a8e0be0` (archive work still uncommitted on this branch)
- Bucket: `nba-analytics-data-260029269390`
- Versioning: **off**
- Lifecycle: **none** (no expiration — archive writes allowed)
- Encryption: SSE-S3 AES256
- Worker before deploy: 2026-09-11, freeze `replay / OFFSEASON=1 / CRON_DRY_RUN=1`, no archive env, no S3 IAM
- Schedules `nba-player-props-0/1/2`: DISABLED
- SQS ESM: Disabled; visibility 330s; maxReceiveCount 4; DLQ empty

## What was applied

1. Additive SQL `MIGRATION_player_prop_snapshot_archive.sql` (columns + check constraint present)
2. Terraform: worker/controller zip, S3 Put/Get IAM on snapshot prefix, archive alarms
3. Worker env: `PLAYER_PROP_S3_ARCHIVE_ENABLED=true`, `NBA_DATA_BUCKET` set, freeze flags unchanged
4. Frozen Lambda invoke skipped (no S3 write)
5. Sentinel E2E `game_id=999000001` pull_run **575** wrote the canonical object

## Sentinel object

`raw/source=balldontlie/league=nba/season=2026/entity=player_prop_snapshots/game_date=2026-09-14/game_id=999000001/snapshot_at=2026-09-14T18-00-00Z__pull=575.json.gz`

- gzip 518 bytes, envelope v1, checksum `3b803642…`, row_count 2, timing pregame
- retry: `already_exists`, still one object
- `existing_ingestion` still **27** objects

## Flags after rollout

| Flag | Value |
| --- | --- |
| PLAYER_PROP_S3_ARCHIVE_ENABLED | true (Lambda) |
| PLAYER_PROP_ARCHIVE_REQUIRED_FOR_PRUNE | false (not flipped on Vercel) |
| worker freeze | still replay / offseason / dry-run |
| props scheduler / ESM | DISABLED |
| player_props_execution_enabled | unset/false |

## Recommendation

Enable `PLAYER_PROP_ARCHIVE_REQUIRED_FOR_PRUNE=true` on Vercel **before** any polling thaw. Do not enable prop polling yet. Consider bucket versioning. Keep 3-day Postgres retention once prune-required is on; until then, unarchived new rows can still be deleted.
