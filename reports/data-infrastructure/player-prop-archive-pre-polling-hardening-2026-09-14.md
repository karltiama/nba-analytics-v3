# Player-prop archive pre-polling hardening (2026-09-14)

Durability rollout finished except a real BDL canary and a human Vercel env paste. Recurring polling was not enabled.

Cutoff: `PLAYER_PROP_ARCHIVE_REQUIRED_AFTER=2026-09-14T07:00:00.000Z`

## Starting state (confirmed before mutations)

| Control | Observed |
| --- | --- |
| Lambda `PLAYER_PROP_S3_ARCHIVE_ENABLED` | true |
| Vercel prune-required | not flipped (no Vercel token in this environment) |
| Worker freeze | `DATA_MODE=replay`, `OFFSEASON_MODE=1`, `CRON_DRY_RUN=1` |
| Schedulers `nba-player-props-0/1/2` | DISABLED |
| SQS ESM | Disabled |
| Bucket versioning | Off → then Enabled |
| Lifecycle | none (no expiration) |
| Snapshot prefix objects | 1 (sentinel) |
| `existing_ingestion` objects | 27 |
| Props DLQ | 0 messages, 4-day retention |

## S3 versioning

Enabled on `nba-analytics-data-260029269390`. No lifecycle rules exist, so enabling versioning did not expire history. Existing objects were not rewritten. Worker IAM still has no `DeleteObject`.

Cost: append-only unique archive keys create versions only on overwrite or delete. Expected incremental cost is near zero until polling writes many unique objects; then cost tracks object count, not extra versions.

After enable + sentinel purge: `existing_ingestion` still 27, `opening_player_props` still 136, current snapshot prefix empty.

## Sentinel cleanup

Identified only:

- 2 `raw.player_prop_snapshots_v2` rows (`game_id=999000001`, `pull_run_id=575`)
- 1 `raw.player_prop_game_runs` row
- 1 `raw.player_prop_pull_runs` row (`game_ids_queried=['999000001']` only)
- 1 S3 object (pre-versioning `VersionId=null`)
- 0 analytics current/history/research rows

Deleted those artifacts via `scripts/ops/cleanup-sentinel-prop-archive.ts --execute`. Version-id delete was used so a delete marker was not left behind. Recon `--date 2026-09-14 --s3`: 0 game runs.

## Prune invariant

Documented for Vercel Production (must be pasted; CLI token not available here):

```
PLAYER_PROP_ARCHIVE_REQUIRED_FOR_PRUNE=true
PLAYER_PROP_ARCHIVE_REQUIRED_AFTER=2026-09-14T07:00:00.000Z
```

Live audit (`npx tsx scripts/ops/audit-prop-archive-prune.ts --after 2026-09-14T07:00:00.000Z`): 0 snapshot rows, 0 deletes. Helper proofs:

- new after cutoff, `archive_status=failed` → blocked
- new after cutoff, `archived` → eligible
- started before cutoff → legacy-before-cutoff
- `pull_run_id` null → legacy-null-pull-run

Destructive prune was not run. `PRUNE_ENABLED` remains off.

## DLQ recovery

SQS body is `{runId, gameId, bdlGameId, date}`, not the BDL JSON. `STORE_PROP_RAW_JSON=false`. After a Postgres write, repair from snapshots, do not blindly redrive.

```
archive failure
→ worker records archive_status=failed, throws
→ SQS retries (maxReceiveCount=4, visibility 330s)
→ DLQ nba-player-props-game-dlq
→ alarms nba-player-props-archive-failed / archive-gap / dlq-not-empty
→ reconcile:prop-archive --s3
→ repair-prop-archive-from-postgres.ts --pull-run-id --game-id
→ archive_status=archived
→ later prune allowed
```

Inspect: `npx tsx scripts/ops/redrive-player-props-dlq.ts`  
Redrive (do not run while frozen): same command with `--execute`, or Console SQS → DLQ → Start DLQ redrive to `nba-player-props-game-queue`. ESM must be enabled and freeze off or the worker drains without writes.

Terraform now sets DLQ retention to 14 days (`1209600`). Live queue is still 4 days until that change is applied.

## Retention

Recommend **KEEP 3 DAYS** now. Do not change `RETENTION_DAYS` before polling.

Primary safety is prune-required, not extra days. `snapshots_v2` is currently 0 rows / 112 kB. Unarchived post-cutoff rows cannot be deleted when the Vercel flag is on. Optional first-week polling cushion: 7 days, not 14.

## Real canary

**NOT AVAILABLE.** Opening NBA games start 2026-10-20. Worker-key probe of `/odds/player_props` for `21717855/6/7` returned HTTP 401. Schedules left DISABLED. Freeze left on. No invented board.

## Archive health

2026-09-14 recon: missing=0, failed=0. Alarms OK. Simulation still proves missing archive is not prune-eligible (`pruneWithoutArchive=false`).
