# 2026–27 Live Ops + Missed-Run Observability — Step 13G.2

**Step verdict:** `YELLOW — observability improved but one activation-critical blind spot remains`

**Date:** 2026-09-10  
**Depends on:** 13G.1 ingestion observability foundation (approved)  
**13F provider work:** parked (`BOX_PROVIDER_ENTITLEMENT=BLOCKED_BY_SUBSCRIPTION`)

---

## Safety / Scope

Read-only operational instrumentation only. Confirmed:

| Gate | Result |
| --- | --- |
| `live_ingestion_enabled` | **false** (`infra/terraform.tfvars`) |
| EventBridge / Scheduler | **DISABLED** (live DescribeRule / GetSchedule) |
| Lambda freeze env | `DATA_MODE=replay`, `OFFSEASON_MODE=1`, `CRON_DRY_RUN=1` |
| `PINNED_ANALYTICS_SEASON` | **2025** |
| BDL HTTP | **0** |
| Provider `/v1/stats`, lineups, Advanced, Plays | **not called** |
| Lambda invoke / SQS send / S3 write / serving writes | **none** |
| Schedule enable / EventBridge change | **none** |
| Terraform apply | **none** (props DLQ alarm is CODE_ONLY) |
| GOAT / postgame thaw | **none** |
| Postgame SQL / Lambda / SQS consumer | still **NOT_APPLIED / NOT_DEPLOYED / NOT_ACTIVE** |

AWS access used: **GetFunction, GetMetricStatistics, DescribeRule, GetSchedule, GetQueueUrl, GetQueueAttributes**. No mutating APIs.

---

## Existing Blind Spots

13G.1 left:

- `/ops` did not show live Lambda last invocation
- `/ops` did not show live queue depth
- missed-run-when-ACTIVE not implemented
- nightly BDL lacked a pull-run table
- reserved concurrency unapplied
- GOAT subscription was only a hint

This step closes the first three in application code, uses Lambda + serving freshness instead of a new nightly table, and surfaces reserved concurrency + known provider capability as metadata.

---

## AWS Telemetry Provider

One bounded internal service: `lib/ops/aws-ingestion-status.ts` (`ingestionAwsResources` name list).

- Court Context Lambdas, EventBridge rules, Scheduler names, and two queues only — **no account scan**
- Parallel reads, 8s timeout, 60s cache
- Failure → `UNKNOWN`; `/ops` still renders
- `OPS_SKIP_AWS=1` skips the snapshot
- Tests inject ports; production uses dynamic AWS SDK imports
- New deps (read-only): `@aws-sdk/client-cloudwatch`, `client-lambda`, `client-eventbridge`, `client-scheduler`. SQS client already present. Simpler alternative (CLI-only) would not satisfy `/ops` last-run.

`/ops` and `GET /api/ops/health` call this via `getCachedPlatformHealth`. `collectPlatformHealth` stays injectable so unit tests never hit AWS.

---

## Lambda Visibility

Per function:

- exists / `Active` / `NOT_DEPLOYED`
- last Invocations datapoint (7d, hourly) — **not log-body parsing**
- Errors / Throttles (24h)
- Duration average when present
- `lastInvocationSuccess = UNKNOWN` (Invocations ≠ success; do not fabricate)

Live CLI (this step, read-only): nightly, odds, injuries, props controller/worker, boxscore **DEPLOYED**; postgame worker **NOT_DEPLOYED**. All queried schedules **DISABLED**.

---

## Queue / DLQ Visibility

Cards for props and postgame:

- configured / `DEPLOYED` / `NOT_DEPLOYED` / `UNKNOWN`
- visible, in-flight, oldest age, DLQ depth
- DLQ > 0 → `DEGRADED` even while frozen
- `NOT_DEPLOYED` → `FROZEN_EXPECTED`, not an incident

Live CLI: postgame queue **NOT_DEPLOYED**. Props queue attributes returned **UNKNOWN** (likely missing `sqs:GetQueueUrl` / `GetQueueAttributes` on the operator identity — not treated as unhealthy).

Reserved concurrency: `RESERVED_CONCURRENCY_UNAPPLIED` (quota 10; desired 4 not applied). Not requested, not configured.

---

## Schedule Visibility

Per-family EventBridge / Scheduler state rolled up: any **ENABLED** wins; else **DISABLED** if at least one rule exists disabled; else **UNKNOWN**.

Mismatch classifier (unchanged, now fed by live AWS when queried):

| Intended | AWS | Health |
| --- | --- | --- |
| frozen | DISABLED | FROZEN_EXPECTED |
| frozen | ENABLED | DEGRADED |
| active | DISABLED | FAILED |
| active | ENABLED | HEALTHY |
| either | UNKNOWN | UNKNOWN (not a site failure) |

Live: **intended frozen + DISABLED**.

---

## Missed-Run Model

Armed only when `config === ACTIVE`:

```text
if intended != ACTIVE → NOT_EXPECTED
else if schedule UNKNOWN → UNKNOWN
else if schedule DISABLED → CONFIG_MISMATCH / FAILED
else if cadence unset → CADENCE_UNSET (no alarm)
else if no invocation within cadence + grace → MISSED
else OK
```

Frozen jobs cannot be MISSED/STALE/FAILED from this detector.

---

## Cadence / Grace Configuration

Centralized in `lib/ops/ingestion-cadence.ts` (not inferred from Lambda names):

| Family | Interval | Grace | Notes |
| --- | --- | --- | --- |
| `schedule_nightly_bdl` | 24h | 6h | daily 08:00 UTC |
| `bbref_boxscore` | 24h | 6h | daily 08:00 UTC |
| `player_props_controller` | 0.5h | 0.5h | `rate(30 minutes)` default |
| injuries / odds | **CADENCE_UNSET** | — | 2–3x / multi-cron not pin-certified |
| props worker | unset | — | SQS-driven |
| Advanced / starters / plays / role / game_flow / MM | not expected | — | MANUAL_ONLY / NOT_DEPLOYED |

---

## Freshness Correlation

| Situation | Grade |
| --- | --- |
| frozen | FROZEN |
| Lambda ran + data fresh | HEALTHY |
| Lambda ran + data did not advance | PARTIAL |
| ACTIVE + overdue invocation | MISSED |
| AWS unknown + data fresh | HEALTHY / AWS_UNKNOWN |
| volume below feed-specific min while ACTIVE | PARTIAL (existing 13G.1 gate) |

Nightly BDL: **no new pull-run table**. Uses Lambda last invocation + `max(updated_at)` on `analytics.games` season `2026`. Residual gap: that timestamp is serving freshness, not a job-result row (`success` vs `partial`).

---

## Provider Capability State

Config/evidence catalog only. **`/ops` does not probe BDL.**

| Capability | State |
| --- | --- |
| `/v1/games` | AVAILABLE (13C) |
| `/v1/stats` | BLOCKED_BY_SUBSCRIPTION (13F.3A 401) |
| lineups | BLOCKED_BY_SUBSCRIPTION (not probed) |
| Advanced / Plays | NOT_IMPLEMENTED |

BLOCKED ≠ FAILED. No subscription account details on the page.

---

## Postgame State

Ops metadata, schema **not applied**:

- queue **NOT_DEPLOYED**
- worker **NOT_DEPLOYED**
- `analytics.postgame_game_stages` **NOT_APPLIED** (missing relation → not an incident)
- box provider **BLOCKED_BY_SUBSCRIPTION**

13F is not represented as active.

---

## Ops Surface

Signed-in `/ops` extended (still compact):

- family: intended config, AWS schedule, last invocation, freshness, missed-run, correlation
- AWS telemetry queried/available
- queues / DLQ including postgame NOT_DEPLOYED
- provider capability
- postgame schema/queue/worker/box

`GET /api/ops/health` still uses `requireBettingAuth` → **401** unauthenticated. No AWS ARNs, keys, or quarantine player ids.

---

## CloudWatch / Alarm Audit

Existing: Lambda Errors (nightly, odds, injuries, boxscore) + props EMF + postgame DLQ; all `treat_missing_data=notBreaching`.

**CODE_ONLY added (not applied):** `nba-player-props-dlq-not-empty` (same quiet DLQ pattern).

**Not added:** missed-run CloudWatch alarm (would need custom metric / evaluator). Detection stays in app/ops.

No noisy alarms attached to intentionally frozen functions.

---

## CLI

```bash
npx tsx scripts/ops/aws-ingestion-status.ts
```

Read-only JSON: Lambda existence, schedule, last invocation, errors/throttles, queues/DLQs. Refuses to print if the payload looks like secrets. `invokedJobs: false`, `bdlHttp: 0`, `mutated: false`.

---

## Tests

Covered:

- Frozen → no missed-run
- ACTIVE + recent invocation → OK / HEALTHY
- ACTIVE + enabled + overdue → MISSED
- ACTIVE + schedule disabled → CONFIG_MISMATCH FAILED
- Frozen + AWS ENABLED → DEGRADED mismatch, missed-run still NOT_EXPECTED
- AWS unavailable → UNKNOWN, report still renders
- DLQ > 0 → DEGRADED
- Queue NOT_DEPLOYED → not FAILED
- Provider BLOCKED ≠ FAILED
- Postgame NOT_DEPLOYED / schema NOT_APPLIED
- `/api/ops/health` unauthenticated **401**
- Props DLQ alarm present in Terraform source; missing-data still notBreaching

---

## Test Results

`npx vitest run lib/ops infra/__tests__/ingestion-alarms.test.ts`

**8 files, 74 tests, passed.** No BDL HTTP. No job invocation. No Terraform apply.

Live read-only CLI ran successfully against Court Context resources (schedules DISABLED, postgame NOT_DEPLOYED).

---

## Readiness Matrix

| Capability | State |
| --- | --- |
| Config-state visibility | READY |
| Lambda invocation visibility | READY |
| Missed-run detection | PARTIAL |
| Queue visibility | PARTIAL |
| DLQ visibility | PARTIAL |
| Provider capability visibility | READY |
| Postgame visibility | READY |
| Automatic remediation | NOT_IMPLEMENTED |
| Production ingestion | FROZEN |

---

## Files Changed

- `lib/ops/ingestion-observability.ts` — missed-run, correlation, queue NOT_DEPLOYED, reserved concurrency
- `lib/ops/ingestion-cadence.ts`
- `lib/ops/provider-capability.ts`
- `lib/ops/aws-ingestion-resources.ts`
- `lib/ops/aws-ingestion-status.ts`
- `lib/ops/platform-health.ts`
- `lib/ops/cloudwatch-queries.ts` (comment)
- `lib/ops/__tests__/*`
- `app/ops/PlatformHealthView.tsx`
- `app` API test for `/api/ops/health`
- `scripts/ops/aws-ingestion-status.ts`
- `scripts/ops/ingestion-health-report.ts`
- `infra/monitoring.tf` / `infra/outputs.tf` / `infra/__tests__/ingestion-alarms.test.ts`
- `package.json` / `.env.example`

---

## Remaining Blind Spots

1. **Activation-critical:** CloudWatch `Invocations` cannot prove last **success**. Errors/Throttles are separate; `lastInvocationSuccess` stays UNKNOWN.
2. Injuries and odds **CADENCE_UNSET** — thaw will not auto-MISSED those families until cadences are certified.
3. Props **SQS read** may be UNKNOWN without `sqs:GetQueueUrl` + `GetQueueAttributes` on the `/ops`/CLI identity (observed on this operator identity).
4. `/ops` live AWS requires IAM on the Next host; otherwise cards stay UNKNOWN (page still loads).
5. Nightly has serving `updated_at` but still no job-result row (`partial` / rows stored).
6. Missed-run is **app/ops only** — no CloudWatch missed-run alarm.
7. Reserved concurrency still unapplied (quota 10). Visibility only.

---

## Recommended Next Step

**Option A — frequent `/v1/games` status-sync foundation while frozen.**

13F.1 already showed nightly-only status sync cannot meet 10–20 minute Final detection. That work is GOAT-independent and does not require Box/Starters/Advanced/Plays entitlement.

Do **not** return to Box/Starters/Advanced/Plays unless entitlement changes.  
Do **not** start that step in this slice.

---

## Verification Checklist

1. Confirm `live_ingestion_enabled=false` and schedules still DISABLED.
2. Signed-in `/ops`: families FROZEN / missed-run NOT_EXPECTED; postgame NOT_DEPLOYED; `/v1/stats` BLOCKED not FAILED.
3. `GET /api/ops/health` without session still 401.
4. `npx tsx scripts/ops/aws-ingestion-status.ts` is read-only (no invoke).
5. Re-run the vitest command above; expect pass.
6. Confirm Terraform was not applied (props DLQ alarm exists in code only).
7. Confirm product pin is still `PINNED_ANALYTICS_SEASON=2025`.

---

## Step Verdict

`YELLOW — observability improved but one activation-critical blind spot remains`
