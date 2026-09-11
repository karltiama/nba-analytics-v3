# 2026–27 Game Status Sync Deployment + Manual Canary — Step 13C.3A

**Date:** 2026-09-11  
**Predecessor:** 13I.2A `GREEN — frozen Terraform baseline is clean and ready for status-sync deployment`  
**This step:** deploy status-sync Lambda / IAM / Errors alarm while frozen, then exactly one controlled manual `/v1/games` canary.  
**Not in scope:** recurring schedule create/enable, `live_ingestion_enabled=true`, any other family thaw, `/v1/stats`, 13F / postgame.

**Step verdict:** `GREEN — deployed status-sync successfully completed a controlled real-provider canary while recurring execution remained frozen`

---

## Safety / Scope

Held for the entire step:

| Gate | Value |
| --- | --- |
| `live_ingestion_enabled` | `false` |
| Family `*_execution_enabled` | all `false` |
| `game_status_sync_enable_schedule` | `false` (default; schedule **not created**) |
| `postgame_create` | `false` |
| Lambda freeze env | `DATA_MODE=replay`, `OFFSEASON_MODE=1`, `CRON_DRY_RUN=1` |
| `LIVE_INGESTION_ENABLED` on Lambda | `"0"` |
| Product pin | `2025` (`PINNED_ANALYTICS_SEASON`; canary `productPin=2025`) |
| `STATUS_SYNC_TARGET_SEASON` | `2026` |
| GOAT | inactive |
| 13F / postgame | parked |

Authorized provider path: **only** `GET /v1/games`. No `/v1/stats`, injuries, odds, props, lineups, Advanced, Plays, postgame SQS, or S3.

`game_status_sync_create=true` is now the desired managed production state. It was **not** flipped back to false after the canary.

---

## Clean Baseline

Before changing tfvars, a normal frozen full plan (`terraform plan -out=tfplan-13c3a-baseline.bin`, no `-target`) returned:

```text
No changes. Your infrastructure matches the configuration.
```

`live_ingestion_enabled=false`. Status-sync and postgame were still absent. No unexplained drift. Proceeded.

---

## Deployment Plan

After `game_status_sync_create=true` (still frozen; schedule flags false), a normal full plan was saved as `tfplan-13c3a-deploy.bin`.

```text
Plan: 5 to add, 0 to change, 0 to destroy.
```

| Operation | Address | Gate |
| --- | --- | --- |
| create | `aws_iam_role.lambda_game_status_sync_execution[0]` | AUTHORIZED |
| create | `aws_iam_role_policy_attachment.lambda_game_status_sync_basic_execution[0]` | AUTHORIZED |
| create | `aws_iam_role_policy.game_status_sync_bdl_rate_limit[0]` | AUTHORIZED |
| create | `aws_lambda_function.game_status_sync[0]` | AUTHORIZED |
| create | `aws_cloudwatch_metric_alarm.game_status_sync_errors[0]` | AUTHORIZED |

**Not present:** status-sync Scheduler / invoke role / lambda permission, postgame anything, updates to the six existing Lambdas, props ESM, unrelated alarms, any `DISABLED→ENABLED`, destroys.

Credentials: status-sync env inherits `SUPABASE_DB_URL` / `BALLDONTLIE_API_KEY` from existing `var.lambda_env` via `lookup`. No second secret copy in tfvars. Env block in the plan is `(sensitive value)`.

Outputs added: `game_status_sync_function_name`, `game_status_sync_errors_alarm_name`.

**Gate: PASS.** Applied that exact plan file.

---

## Applied Resources

```text
Apply complete! Resources: 5 added, 0 changed, 0 destroyed.
```

Matches the reviewed plan. Partial-failure path was not needed.

---

## Lambda Verification

`game-status-sync` exists and is **Active**.

| Attribute | Observed |
| --- | --- |
| Runtime | `nodejs22.x` |
| Memory | 256 MB |
| Timeout | 90 s |
| Arch | `x86_64` |
| Handler | `dist/index.handler` |
| Role | `game-status-sync-execution-role` |
| Artifact | local JS **1,445,520 bytes (~1.4 MB)**; sha256 `5d8e8b6c1eb838c2f45dd1b4d4e75fd09ed889aa489ee217a1b0d533372b200e` (identical on two consecutive builds) |
| Bundle | handler + domain + `fetchBdlLive`; no `require('@/`)`; no postgame/SQS/S3 SDK; no secrets in JS |
| Zip on AWS | compressed upload (~272 KB); distinct from JS `source_code_hash` as expected |

---

## Schedule Absence / Freeze

- `nba-game-status-sync-schedule`: **does not exist** (Scheduler `ResourceNotFoundException`)
- EventBridge rule of the same name: **does not exist**
- Status-sync event-source mappings: **none**
- Recurring trigger: **impossible** under the current Terraform model (`game_status_sync_enable_schedule=false`)

Lambda freeze env (values, not secrets):

| Key | Value |
| --- | --- |
| `DATA_MODE` | `replay` |
| `OFFSEASON_MODE` | `1` |
| `CRON_DRY_RUN` | `1` |
| `LIVE_INGESTION_ENABLED` | `0` |
| `STATUS_SYNC_TARGET_SEASON` | `2026` |
| `BDL_RATE_LIMIT_TABLE` | `nba-bdl-rate-limit` |
| `BDL_RATE_LIMIT_BACKEND` | `dynamodb` |
| `BDL_RATE_LIMIT_WORKER` | `game-status-sync` |
| `BDL_RATE_LIMIT_MAX_RETRIES` | `0` |

Env **key names** include `SUPABASE_DB_URL` and `BALLDONTLIE_API_KEY`. Values were not printed.

Errors alarm `nba-game-status-sync-errors`: exists; `treat_missing_data=notBreaching`. Before canary `INSUFFICIENT_DATA` (quiet). After successful canary **OK**. Not in ALARM.

---

## Manual Canary Mechanism

No pre-existing production canary mode. Smallest explicit direct-invoke path was added **before** deploy so the applied artifact includes it.

Contract:

- Payload must include **all** of: `manualCanary: true`, `confirm: "STATUS_SYNC_MANUAL_CANARY"`, `startDate`/`endDate` as `YYYY-MM-DD` in **2026**.
- `source` `aws.events` / `aws.scheduler`, or any `detail-type`, is rejected even if canary fields are stuffed in.
- Bare `handler()` / empty event / missing confirm → existing freeze skip (0 BDL, 0 DB).
- Canary uses `runGameStatusSync` + `fetchBdlLive` + Dynamo `nba-bdl-rate-limit` + `createPostgresGameStatusStore`.
- Fetch-adapter overlay only: `DATA_MODE=live_api`, `OFFSEASON_MODE=0`, `CRON_DRY_RUN=0`. Terraform / Lambda env / `live_ingestion_enabled` stay frozen.
- Date window is explicit (not today±1). Hard cap remains 3 pages.

This is **not** a generic freeze bypass and does not affect other families.

---

## Selected Game / Date

ET date window **2026-10-22** (2 published 2026 games; smallest useful certified window). Featured row:

| Field | 21717860 | 21717861 (same window) |
| --- | --- | --- |
| Matchup | CLE @ PHI | DEN @ OKC |
| `start_time` | 2026-10-22 23:00:00+00 | 2026-10-23 01:30:00+00 |
| Scores | 0–0 | 0–0 |
| Local `status` | `2026-10-22T23:00:00Z` | `2026-10-23T01:30:00Z` |
| Season | 2026 | 2026 |

Normal scheduled slate, not an anomaly, already in the local 2026 provider set. Not 2025.

The ISO-like `status` values are what the provider currently stores/returns for these unpublished games, not a local-only corruption. See Status-Sync Result.

---

## Provider Request

Authorized query (1 page):

```text
GET /v1/games?seasons[]=2026&start_date=2026-10-22&end_date=2026-10-22&per_page=100
```

- Full-season poll: **no**
- Undocumented params: **no**
- HTTP status: **200**
- Requests: **1**
- Pagination: **none** (cap 3 unused)
- Games fetched: **2**

---

## Dynamo Limiter

CloudWatch structured event from the one invocation:

```text
{"evt":"bdl_throttle","worker":"game-status-sync","decision":"granted","wait_ms":0,"acquire_retries":0,"attempt":0}
```

Real shared table `nba-bdl-rate-limit`. No raw `fetch`. Wait 0 ms (token available). Request count 1.

---

## Postgres Connectivity

The deployed adapter ran `getById` against `analytics.games` for both provider ids (otherwise `unchanged` could not be classified). Connection used the Lambda’s existing `SUPABASE_DB_URL`. Credentials were not altered.

`wroteDb=true` means writes were **authorized** on the canary path. Because both rows matched the provider payload, **no upsert ran**.

---

## Status-Sync Result

From the Lambda payload (no secret fields):

| Field | Value |
| --- | --- |
| `status` | `success` |
| `skipped` | `false` |
| `targetSeason` | `2026` |
| `productPin` | `2025` |
| `queryMode` | `frequent` |
| `startDate` / `endDate` | `2026-10-22` / `2026-10-22` |
| `gamesFetched` | 2 |
| `inserted` | 0 |
| `updated` | 0 |
| `unchanged` | 2 |
| `rejected` | 0 |
| `statusChanges` | 0 |
| `becameFinal` | 0 |
| `finalPreserved` | 0 |
| `providerErrors` | 0 |
| `providerStatus` | 200 |
| `durationMs` | 1940 |
| `dryRun` | `false` |
| `wroteDb` | `true` |
| `bdlHttp` | 1 |

Events: `game_status_sync_started`, `game_status_sync_completed`. No payload dumps.

Outcome class: **UNCHANGED**. Acceptable. Goal was infrastructure/runtime certification, not forcing a mutation.

---

## Database Before / After

`analytics.games` rows `21717860` and `21717861` were **byte-identical** before and after (status, start_time, scores, teams, venue, `updated_at=2026-09-04 01:11:52.942679+00`).

Fingerprint tables (count + `max(updated_at)`) unchanged:

| Table | n | max(updated_at) |
| --- | ---: | --- |
| `analytics.games` | 5163 | 2026-09-08 19:34:19.360402+00 |
| `analytics.player_game_logs` | 138296 | 2026-09-08 19:34:19.360402+00 |
| `analytics.team_game_stats` | 7924 | 2026-09-08 19:34:19.360402+00 |
| `analytics.players` | 5534 | 2026-09-08 19:34:19.360402+00 |
| `analytics.player_entities` | 5615 | 2026-09-04 23:56:53.896587+00 |
| `analytics.player_provider_ids` | 6168 | 2026-09-04 23:56:53.896587+00 |
| `analytics.player_injury_status_current` | 150 | 2026-05-06 18:00:30.931442+00 |
| `analytics.game_odds_current` | 334 | 2026-09-06 18:00:47.613248+00 |
| `analytics.player_prop_current` | 25812 | 2026-05-02 18:00:16.305881+00 |
| `analytics.player_prop_market_movement` | 21132 | 2026-09-10 00:27:02.192542+00 |
| `analytics.game_starters` | 13200 | 2026-09-10 05:24:02.761622+00 |
| `analytics.player_game_advanced` | 104756 | 2026-09-10 05:53:32.823425+00 |
| `analytics.game_flow` | 1322 | 2026-09-10 16:39:44.358861+00 |

`analytics.postgame_game_stages`: **does not exist** (`to_regclass` null). `public.games` untouched (`n=2353`, `max(updated_at)=2026-03-08`).

No unexpected field or table writes. Not RED.

---

## Final-Preserve Check

Window contained **no** local certified Final.

- `final_preserved`: **0**
- `became_final`: **0**

Invariant not exercised live (fixtures already cover it). No regression possible on this slate.

---

## CloudWatch Logs

One cold start + one request (`RequestId` `233a8bb5-ed34-4527-89a9-cb2a43606a8f`) at **2026-09-11T04:17:50Z**.

- `game_status_sync_started` (targetSeason 2026)
- `bdl_throttle` granted (`wait_ms=0`)
- `game_status_sync_completed` (fetched 2, unchanged 2)
- REPORT: Duration ~2044 ms, Max Memory 117 MB / 256 MB
- No secret leakage
- No retry storm
- No second START

This is a **manual** invoke, not recurring activation.

---

## Postgame Isolation

Even though nothing became Final:

- no `analytics.postgame_game_stages` table
- no postgame SQS queue (`nba-postgame-stage-queue` does not exist)
- no `postgame-stage-worker` Lambda
- no postgame event-source mapping

Final transition remains informational only. 13F stays parked.

---

## Existing Family Safety

| Family | Observed |
| --- | --- |
| nightly | EventBridge **DISABLED** |
| odds 0–8 | all **DISABLED** |
| injuries | **DISABLED** |
| BBRef / boxscore | **DISABLED** |
| props schedulers 0–2 | **DISABLED** |
| props ESM | **Disabled** |
| postgame | **absent** |

Canary-window CloudWatch Invocations (2026-09-11T04:16Z–04:20Z): `game-status-sync=1`; nightly / odds / injuries / props controller / props worker / boxscore = none.

---

## Post-Canary Terraform Plan

Normal full plan with `game_status_sync_create=true` and `live_ingestion_enabled=false`:

```text
No changes. Your infrastructure matches the configuration.
```

Terraform did **not** plan to destroy status-sync. No unrelated drift.

---

## Ops State

`npm run ops:aws-ingestion-status` (read-only):

| id | deployState | state | scheduleObserved |
| --- | --- | --- | --- |
| `game_status_sync` | **DEPLOYED** | Active | **UNKNOWN** |
| `postgame_stage_worker` | NOT_DEPLOYED | — | UNKNOWN |
| nightly / odds / injuries / props controller / boxscore | DEPLOYED | Active | DISABLED |

`scheduleObserved=UNKNOWN` is the rollup of **schedule not created** (`NOT_FOUND`), not an enabled rule. Family config remains frozen (`live_ingestion_enabled=false`). This is **DEPLOYED + FROZEN + not scheduled**, not MISSED, not ACTIVE, not scheduled.

Ops `lastInvocationAt` is CloudWatch-bucketed (`2026-09-11T03:20:00.000Z`); logs are the source of truth for the 04:17:50Z canary.

Errors 24h on status-sync: **0**.

---

## Mutation Summary

### AWS

| Metric | Total |
| --- | ---: |
| Resources added | **5** |
| Resources changed | 0 |
| Resources destroyed | 0 |
| Lambda invocations (this step) | **1** |
| Schedules enabled | **0** |

### BDL

| Metric | Total |
| --- | ---: |
| HTTP requests | **1** |
| Pages | 1 |
| Paid / blocked endpoints | 0 |

### Database

| Metric | Total |
| --- | ---: |
| Rows inserted | **0** |
| Rows updated | **0** |
| Rows unchanged (classified) | **2** |
| Tables written | **0** |
| Tables read | `analytics.games` only |

### SQS / S3

| Metric | Total |
| --- | ---: |
| SQS messages sent | **0** |
| S3 writes | **0** |

---

## Remaining Risks

1. **No recurring trigger yet.** 13C.3B must create/enable **only** the status-sync schedule (still leaving every other family frozen). Do not set `live_ingestion_enabled=true` as a global thaw if family execution flags can keep others off — follow the 13C.3B contract.
2. **Do not put the canary JSON in Scheduler Input.** EventBridge envelopes are rejected; a raw Scheduler Input that copies `manualCanary` + confirm would still be a live path. Keep schedule Input empty.
3. **Do not set `game_status_sync_create=false`.** That would plan destruction of the certified Lambda.
4. **Provider `status` for this slate is an ISO timestamp**, matching local rows, so the canary was UNCHANGED. A later normalize-to-`Scheduled` pass is out of scope and must not be bolted onto activation.
5. Ops `scheduleObserved=UNKNOWN` for a not-created schedule is noisy but not an incident while frozen. Optional later: treat missing optional schedule as not-scheduled.
6. Pre-existing: many `analytics.*` tables still have RLS disabled (not introduced by this step; not required to change here).

---

## Recommended Next Step

**13C.3B — recurring status-sync activation + observation**

Activate **only** `game-status-sync`. Leave every other ingestion family frozen. Do **not** start 13C.3B from this step. Do not resume 13F.

---

## Verification Checklist

1. Confirm `infra/terraform.tfvars` still has `live_ingestion_enabled = false` and `game_status_sync_create = true`.
2. Confirm AWS Scheduler has **no** `nba-game-status-sync-schedule`.
3. Confirm you will not invoke status-sync again except as an explicit 13C.3B / ops action.
4. Confirm no family `*_execution_enabled` flag was set true.
5. Skim `/aws/lambda/game-status-sync` for a single START/END around 2026-09-11T04:17:50Z and no later unexpected START.
6. Do not flip `game_status_sync_create` back to false on the next plan.

---

## Step Verdict

`GREEN — deployed status-sync successfully completed a controlled real-provider canary while recurring execution remained frozen`

Status-sync remains:

```text
DEPLOYED
+
FROZEN
+
MANUAL_CANARY_CERTIFIED
```
