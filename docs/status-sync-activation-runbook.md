# Game-status-sync activation runbook (Phase 1B.5C.2B)

Activates the scheduled `/v1/games` status sync only. It does not activate props, the projection ledger, nightly, odds, injuries, boxscore, or shadow jobs. Every production step below needs its own explicit approval. Terraform mechanics: [../infra/README.md](../infra/README.md).

Target window: 2026-10-18 to 2026-10-20. The deadline is 2026-10-21 ET. Status-sync labels only yesterday through tomorrow ET, and games from 2026-10-23 onward are still UNCLASSIFIED, so the 2026-10-22 run must happen live.

## Preconditions (read-only)

- The deployed `game-status-sync` `CodeSha256` equals the reviewed bundle (the one with season-bounded canary validation and the `season_phase_readiness` event).
- All schedules DISABLED, all EventBridge rules disabled, props ESM Disabled, `PROJECTION_LEDGER_WRITES=0`.
- `analytics.games` has both season-phase columns, and `raw.acquisition_requests` matches the last recorded count.
- Limiter env on `game-status-sync`: `BDL_RATE_LIMIT_INTERVAL_MS=500`, `BDL_RATE_LIMIT_MAX_REQUESTS=1`, `BDL_RATE_LIMIT_BURST=5`, `BDL_RATE_LIMIT_MAX_RETRIES=0`.
- IAM policy `game-status-sync-s3-archive` covers `raw/source=balldontlie/league=nba/season=2026/entity=acq_games/*`.

## The only change

In `infra/terraform.tfvars` (local, never committed):

```hcl
game_status_sync_execution_enabled = true
```

`live_ingestion_enabled` is already `true`, and every other family stays gated by its own unset `*_execution_enabled`. Do not set any other `*_execution_enabled`.

Expected `terraform plan` (save it with `-out=infra/<name>.tfplan` and apply only that file):

| Resource | Change |
|---|---|
| `aws_lambda_function.game_status_sync[0]` | env only: `LIVE_INGESTION_ENABLED` 0→1, `DATA_MODE` replay→live_api, `OFFSEASON_MODE` 1→0, `CRON_DRY_RUN` 1→0 |
| `aws_scheduler_schedule.game_status_sync[0]` (`nba-game-status-sync-schedule`, `rate(15 minutes)`, input `{}`) | state DISABLED→ENABLED |
| `aws_cloudwatch_metric_alarm.game_status_sync_missed_cycles[0]` | create (alert after 45 minutes with no invocation) |

Stop if the plan touches any other Lambda, schedule, rule, ESM, IAM policy, the limiter table, or anything under projection-ledger, or if it destroys anything.

## First live execution: monitor

The schedule fires within 15 minutes of apply. Check in this order:

1. **CloudWatch logs for `/aws/lambda/game-status-sync`.** Expect `game_status_sync_started`, `game_status_sync_completed`, and one `season_phase_readiness` event. There must be no `game_status_sync_failed` event. Logs Insights:

   ```
   fields @timestamp, event, ready, horizon, coverage, counts.eligible, counts.unclassified, counts.missing, reason
   | filter event in ["game_status_sync_completed", "game_status_sync_failed", "season_phase_readiness"]
   | sort @timestamp desc | limit 20
   ```

2. **BDL and archive.** Per run, expect 1 request (at most 3 pages); about 96 requests a day.
   - `raw.acquisition_requests` grows by exactly the request count. Every new row has `archive_status='archived'`, `http_status=200`, `parse_ok=true`, `season_type_requested='regular'`.
   - Each new `s3_key` exists in S3, and its `body-sha256`/`envelope-sha256` metadata equals the ledger row.
3. **Result.** `status='success'` (never `partial`), `wroteDb=true`, `acquisition.archivedRequests` equals `bdlHttp`.
4. **Labels.** New labels have `season_phase_source` in (`request_season_type`, `provider_ist_stage`), 0 PRESEASON rows, 0 labels outside season 2026.

## Readiness for today and tomorrow

Every write run evaluates readiness for today and tomorrow ET against its own archived provider pull (`lib/games/season-phase-readiness.ts`). The result also includes the summary under `readiness`.

- `ready=true` requires 0 present-but-UNCLASSIFIED rows, 0 provider games missing from the database, 0 classification anomalies, and a complete (not page-capped) provider pull covering both days.
- A day with no games is ready only when the provider pull confirms there are none (`coverage='provider_verified'`). A database-only empty day is never ready.
- The NBA Cup championship is never eligible and never counted as missing.

Read-only DB cross-check (replace the dates with today and tomorrow ET):

```sql
begin read only;
select season_phase, coalesce(season_phase_source, 'null') as src, count(*)
from analytics.games
where season = '2026'
  and (start_time at time zone 'America/New_York')::date between date 'YYYY-MM-DD' and date 'YYYY-MM-DD'
group by 1, 2 order by 1, 2;
commit;
```

Before 2026-10-20 the horizon has no regular-season games. Expect `ready=true` with `coverage='provider_verified'` and `counts.eligible=0`.

## Idempotency

- On a re-run over the same window, labelled rows stay labelled (the update only fills UNCLASSIFIED rows), and `unchanged` covers rows whose provider data did not change. `seasonPhaseWrites` counts label attempts, not changed rows. Use the database, not that counter.
- Snapshot the label counts by `season_phase`/`season_phase_source` and an md5 over rows outside the run window. Compare the snapshot before and after two consecutive runs: rows outside the window must be byte-identical.
- Final games stay Final (final-preserving upsert).

## Rollback

1. **Fast stop, no Terraform:** `aws lambda put-function-concurrency --function-name game-status-sync --reserved-concurrent-executions 0`. This throttles every invocation. Remove it with `delete-function-concurrency` after step 2.
2. **Re-freeze:** set `game_status_sync_execution_enabled = false`, then plan (schedule DISABLED, the 4 env flags back to the freeze values, missed-cycles alarm destroyed) and apply under approval.
3. Labels and archives stay. They are provider-evidenced and append-only, and keeping them is the audit trail. Do not delete S3 objects or acquisition rows.
4. Verify: schedule DISABLED, env `replay`/`1`/`1`/`0`, no invocations after the stop time.

## Do not activate prematurely

- Leave `player_props_execution_enabled` and every other `*_execution_enabled` unset. The props ESM must stay Disabled.
- `PROJECTION_LEDGER_WRITES` stays `0`. No season pin flip.
- Props and the ledger each need their own phase and approval. Before either, `season_phase_readiness` must have been `ready=true` on every run for at least 24 hours, with no `partial` or failed runs.

## Before later dates

- Add `NBA_CUP_FINAL_ET['2026']` from the official schedule before December 2026.
- Add `POSTSEASON_START_ET['2026']` before April 2027. Until then, 2026 play-in and playoff games are not queried.
