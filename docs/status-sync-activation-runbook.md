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

Expected `terraform plan` (save it with `-out=infra/<name>.tfplan` and apply only that file). This assumes the frozen hardening apply below already happened: **2 to add, 2 to change, 0 to destroy.**

| Resource | Change |
|---|---|
| `aws_lambda_function.game_status_sync[0]` | env only: `LIVE_INGESTION_ENABLED` 0→1, `DATA_MODE` replay→live_api, `OFFSEASON_MODE` 1→0, `CRON_DRY_RUN` 1→0 (still 17 keys) |
| `aws_scheduler_schedule.game_status_sync[0]` (`nba-game-status-sync-schedule`, `rate(15 minutes)`, input `{}`) | state DISABLED→ENABLED |
| `aws_cloudwatch_metric_alarm.game_status_sync_missed_cycles[0]` | create (alert after 45 minutes with no invocation) |
| `aws_cloudwatch_metric_alarm.game_status_sync_readiness_not_ready[0]` | create (see alarms below) |

If the hardening apply has not happened, the same plan also creates the two readiness metric filters and the event invoke config: **5 to add, 2 to change, 0 to destroy.** Apply hardening first, frozen, so that activation is only the flag.

Stop if the plan touches any other Lambda, schedule, rule, ESM, IAM policy, the limiter table, or anything under projection-ledger, or if it destroys anything.

## Frozen hardening apply (before activation)

Separate approval. With `game_status_sync_execution_enabled = false`, the plan is **3 to add, 0 to change, 0 to destroy**, and every schedule stays DISABLED:

| Resource | Purpose |
|---|---|
| `aws_cloudwatch_log_metric_filter.game_status_sync_readiness_not_ready[0]` | `ReadinessNotReady-game_status_sync` += 1 per `season_phase_readiness` event with `ready=false` |
| `aws_cloudwatch_log_metric_filter.game_status_sync_readiness_unverified[0]` | `ReadinessUnverified-game_status_sync` += 1 when that event also has `coverage='db_only'` (diagnosis only, no alarm) |
| `aws_lambda_function_event_invoke_config.game_status_sync[0]` | async retries 0, maximum event age 900 s |

Metric filters only count log lines. A frozen Lambda emits no readiness events, and the alarm itself is created only at activation, so nothing can notify while the schedule is disabled.

### Async retry policy: 0 retries, 900 s event age

The scheduler invokes asynchronously. Lambda's default is 2 retries and a 6-hour event age.

- Handled failures (provider 4xx/5xx/429, archive or ledger failure, invalid canary) return a `failed` result and are never retried at any setting. Only an uncaught throw, a 90 s timeout, or OOM is retried.
- Each retry is a new archived BDL request with its own request id and S3 key. Archives are create-only and DB writes are idempotent, so retries are safe but duplicative. With 2 retries, a database outage can cost 3 BDL calls per tick and overlap the next tick.
- Status-sync polls. The next tick 15 minutes later re-reads the same window, so it is the retry. 0 retries keeps exactly one execution per tick, which keeps the 24-hour request count exact.
- Failures stay visible: `nba-game-status-sync-errors` fires on any Lambda error, and repeated misses trip the missed-cycles alarm.
- A 900 s event age (one cadence) drops events that were throttled or queued for longer than one tick, instead of replaying them for up to 6 hours. That is what makes the concurrency-0 rollback below safe.
- 1 retry would recover a single transient DB blip about a minute sooner, at the cost of one more BDL call and archive object. That is not worth breaking the one-execution-per-tick invariant when the next tick arrives in 15 minutes anyway.

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

## Sync success is not downstream readiness

`status` and `readiness` are separate verdicts. `status='success'` only means every page was fetched and archived and the writes ran. `readiness.ready` is the only signal that the operating horizon is fully classified. A run can be `success` with `ready=false`, for example when a game is still UNCLASSIFIED or missing. That run must not count toward enabling props or the ledger. No code path reads `readiness` to enable anything: downstream activation is a manual gate on these events.

Alarms (email through `court-context-ingestion-alerts`):

| Alarm | Fires on |
|---|---|
| `court-context-game_status_sync-run-failed` | `game_status_sync_failed` events in 2 of 3 consecutive 15-minute periods (provider 4xx/5xx/429, archive or ledger failure, timeout) |
| `nba-game-status-sync-errors` | Lambda `Errors` (uncaught throw or timeout) |
| `court-context-bdl-provider-429` / `court-context-bdl-limiter-failure` | limiter `provider_429` or limiter failure decisions |
| `court-context-game-status-sync-missed-cycles` (created at activation) | no invocation for 45 minutes |
| `court-context-game-status-sync-readiness-not-ready` (created at activation) | `ready=false` in 2 of 3 consecutive 15-minute periods |

Readiness alarm semantics:

- A provider-confirmed day with no games emits `ready=true` and never counts. Before 2026-10-20 that is the expected state.
- A successful run with an UNCLASSIFIED, missing, or anomalous game counts (`coverage='provider_verified'`, `ready=false`).
- A run without complete provider evidence (page-capped pull, or columns missing) counts on both `ReadinessNotReady` and `ReadinessUnverified`. When the alarm fires, check `ReadinessUnverified-game_status_sync` to separate "evidence incomplete" from "evidence complete, horizon not classified".
- A run that fails before writing emits no readiness event. The run-failed alarm covers it.

Nothing alarms on `status='partial'` by itself. A partial run also produces `ready=false` with `coverage='db_only'`, so repeated partial runs fire the readiness alarm.

Real Lambda messages are `timestamp<TAB>requestId<TAB>LEVEL<TAB>{json}\n`. JSON metric filter patterns match them: `aws logs test-metric-filter` against exact production messages matches every alarm pattern on its intended lines and on no others. Build test inputs in Node or from `filter-log-events` output, not from PowerShell strings, which corrupt the payload. `CourtContext/Ingestion` has no datapoints only because no matching event has been logged since the filters were created on 2026-10-09.

## 24-hour observation checklist

Run it at +15 minutes, +1 hour, +6 hours, and +24 hours after activation. Every item must hold before any downstream phase.

1. **Runs:** about 4 per hour. Every run has `game_status_sync_completed` with `status='success'`, with 0 `partial` and 0 `game_status_sync_failed`.
2. **Provider requests:** BDL requests equal `bdlHttp` summed over runs (about 1 per run, at most 3), and equal the growth in `raw.acquisition_requests`. There are no duplicate executions per schedule tick: Lambda `Invocations` is about 4 per hour.
3. **Archive integrity:** every new acquisition row is `archived`, HTTP 200, `parse_ok=true`, with `archive_error` and `parse_error` null. For a sample of at least 3 rows (first, middle, latest), `head-object` metadata `body-sha256`/`envelope-sha256` equals the row. The S3 object count under `entity=acq_games/` equals the archived row count.
4. **Preseason:** 0 rows with `season_phase='PRESEASON'`, 0 season-2026 rows before 2026-10-20, 0 labels outside season 2026.
5. **Readiness:** every `season_phase_readiness` event has `ready=true`, `counts.unclassified=0`, `counts.missing=0`, and `coverage='provider_verified'`.
6. **Errors:** all four alarms OK. Lambda `Errors=0` and `Throttles=0`. `nba-player-props-game-queue` and `nba-player-props-game-dlq` stay at 0 visible and 0 in-flight, because props is not activated.
7. **Rate limits:** `BdlProvider429=0` and `BdlLimiterFailure=0`. Any provider 429 is a stop-and-review event.
8. **Freeze elsewhere:** every other schedule, rule and ESM is still DISABLED. `PROJECTION_LEDGER_WRITES=0`. Other Lambdas are still `replay`/`1`/`1`.
9. **Finals preserved:** no game that was Final before activation changed status, scores or tip time.

## Idempotency

- On a re-run over the same window, labelled rows stay labelled (the update only fills UNCLASSIFIED rows), and `unchanged` covers rows whose provider data did not change. `seasonPhaseWrites` counts label attempts, not changed rows. Use the database, not that counter.
- Snapshot the label counts by `season_phase`/`season_phase_source` and an md5 over rows outside the run window. Compare the snapshot before and after two consecutive runs: rows outside the window must be byte-identical.
- Final games stay Final (final-preserving upsert).

## Rollback

1. **Fast stop, no Terraform:** `aws lambda put-function-concurrency --region us-east-1 --function-name game-status-sync --reserved-concurrent-executions 0`. This throttles every execution immediately, so no BDL calls happen. Scheduler invokes asynchronously: throttled events wait in Lambda's async queue for up to 900 s (the invoke config's maximum event age; 6 hours if the hardening apply was skipped), so do not lift the throttle before step 2. The missed-cycles alarm fires while throttled; that is expected.
2. **Re-freeze:** set `game_status_sync_execution_enabled = false` and run `terraform -chdir=infra plan "-var-file=terraform.tfvars" "-out=<name>.tfplan"`. Expect: schedule DISABLED, the 4 env flags back to `replay`/`1`/`1`/`0`, missed-cycles and readiness alarms destroyed, nothing else. The metric filters and invoke config stay. Then apply that file under approval.
3. **Lift the throttle** only after step 2: `aws lambda delete-function-concurrency --region us-east-1 --function-name game-status-sync`. Any queued events now run frozen and skip, with no BDL calls.
4. Labels and archives stay. They are provider-evidenced and append-only, and keeping them is the audit trail. Do not delete S3 objects or acquisition rows.
5. Verify: schedule DISABLED, env `replay`/`1`/`1`/`0`, and every log line after step 3 is `skipped`.

Approvals: step 1 is an emergency action any operator may take and report. Steps 2–3 need the same approval as activation. Deleting labels or archives is out of scope.

## Do not activate prematurely

- Leave `player_props_execution_enabled` and every other `*_execution_enabled` unset. The props ESM must stay Disabled.
- `PROJECTION_LEDGER_WRITES` stays `0`. No season pin flip.
- Props and the ledger each need their own phase and approval. Before either, `season_phase_readiness` must have been `ready=true` on every run for at least 24 hours, with no `partial` or failed runs.

## Live-score roadmap (independent of this activation)

A future preseason scoreboard (live scores for preseason games) is a separate collector, not part of status-sync. It is not implemented.

- This activation neither depends on it nor enables it. Status-sync queries regular-season `/v1/games` only, and readiness concerns regular-season analytics only.
- A scoreboard collector must not write `season_phase` labels and must not loosen the eligibility rules. PRESEASON stays out of `SERVING_SEASON_PHASES` in `lambda/shared/season-eligibility.ts`, so preseason games never enter regular-season analytics, readiness, props, or the ledger.
- It needs its own design, rate-limit budget on the shared BDL limiter, schedule flag, and approval.

## Before later dates

- Add `NBA_CUP_FINAL_ET['2026']` from the official schedule before December 2026.
- Add `POSTSEASON_START_ET['2026']` before April 2027. Until then, 2026 play-in and playoff games are not queried.
