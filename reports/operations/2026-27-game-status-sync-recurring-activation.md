# 2026–27 Game Status Sync Recurring Activation — Step 13C.3B

**Date:** 2026-09-11  
**Predecessor:** 13C.3A `GREEN — deployed status-sync successfully completed a controlled real-provider canary while recurring execution remained frozen`  
**This step:** activate only the 15-minute `game-status-sync` family, observe two scheduler-driven runs, leave every other ingestion family frozen.  
**Not in scope:** other family thaw, postgame / 13F, paid BDL endpoints, `/ops` global live flip, GOAT purchase.

**Step verdict:** `GREEN — game-status-sync is safely active and observed in production`

---

## Safety / Scope

Desired runtime after this step, and observed:

| Family | Target | Observed |
| --- | --- | --- |
| game-status-sync | ACTIVE | Lambda live env + schedule **ENABLED** + 2 scheduled polls |
| nightly | FROZEN | env `replay/1/1`, EventBridge **DISABLED**, 0 invokes |
| odds | FROZEN | env `replay/1/1`, rules 0–8 **DISABLED**, 0 invokes |
| injuries | FROZEN | env `replay/1/1`, **DISABLED**, 0 invokes |
| props controller | FROZEN | env `replay/1/1`, schedulers 0–2 **DISABLED**, 0 invokes |
| props worker | FROZEN | env `replay/1/1`, ESM **Disabled**, 0 invokes |
| BBRef | FROZEN | env `replay/1/1`, **DISABLED**, 0 invokes |
| postgame | NOT_DEPLOYED | queue/function absent |

Authorized provider path: **only** `GET /v1/games`. Product pin **2025**. `STATUS_SYNC_TARGET_SEASON=2026`. GOAT inactive. 13F parked.

---

## Pre-Activation Baseline

Before changing activation variables, a normal full plan (`tfplan-13c3b-baseline.bin`) returned:

```text
No changes. Your infrastructure matches the configuration.
```

Then-current config: `game_status_sync_create=true`, schedule not created, `live_ingestion_enabled=false`, family execution flags unset/false, `postgame_create` not true.

---

## Runtime Isolation Audit

**Hard gate: PASS.** Activating status-sync does **not** require changing shared env on the six unrelated Lambdas.

How the four runtime keys are supplied:

| Key | Other Lambdas | Status-sync |
| --- | --- | --- |
| `DATA_MODE` | `local.ingestion_freeze_defaults` then family tfvars map (`replay`) | freeze defaults, then **last-merge** `family_schedule_enabled.game_status_sync ? live_api : replay` |
| `OFFSEASON_MODE` | same (`1`) | last-merge `? "0" : "1"` |
| `CRON_DRY_RUN` | same (`1`) | last-merge `? "0" : "1"` |
| `LIVE_INGESTION_ENABLED` | **not set** on nightly/odds/injuries/props/boxscore | last-merge `? "1" : "0"` from the same family local |

`family_schedule_enabled.game_status_sync = var.live_ingestion_enabled && var.game_status_sync_execution_enabled`.

Other schedule/ESM state still requires **that family's** execution flag. Global live alone cannot ENABLED-thaw them.

Observed after apply:

- status-sync: `DATA_MODE=live_api`, `OFFSEASON_MODE=0`, `CRON_DRY_RUN=0`, `LIVE_INGESTION_ENABLED=1`
- nightly/odds/injuries/props controller/props worker/boxscore: `replay` / `1` / `1`
- nightly `LIVE_INGESTION_ENABLED`: unset

Not YELLOW: runtime freeze is **not** globally coupled.

---

## Activation Variables

Existing 13I.2 model, no new flags:

```text
live_ingestion_enabled = true
game_status_sync_create = true
game_status_sync_execution_enabled = true
game_status_sync_enable_schedule = true
```

All other `*_execution_enabled` remain unset/false. `postgame_create` remains false.

```text
effective_status_sync_execution =
    live_ingestion_enabled
    AND
    game_status_sync_execution_enabled
```

HCL last-merge also family-gates status-sync `DATA_MODE` / offseason / dry-run so a future apply preserves isolation.

Scheduler Input is explicit `"{}"` (not the 13C.3A canary payload).

---

## Terraform Plan

Saved as `tfplan-13c3b-activate.bin`. No `-target`.

```text
Plan: 4 to add, 1 to change, 0 to destroy.
```

| Operation | Address | Gate |
| --- | --- | --- |
| create | `aws_iam_role.scheduler_game_status_sync_invoke[0]` | AUTHORIZED |
| create | `aws_iam_role_policy.scheduler_game_status_sync_invoke_lambda[0]` | AUTHORIZED |
| create | `aws_lambda_permission.allow_scheduler_game_status_sync[0]` | AUTHORIZED |
| create | `aws_scheduler_schedule.game_status_sync[0]` state **ENABLED**, `rate(15 minutes)`, `input={}` | AUTHORIZED |
| update | `aws_lambda_function.game_status_sync[0]` environment (sensitive) | AUTHORIZED |

**Rejected class (none present):** unrelated Lambda updates, unrelated schedule ENABLE, props ESM enable, postgame create, queue changes, destroys, limiter replacement, paid-provider resources, broad IAM.

**Gate: PASS.** Applied that exact file.

---

## Applied Changes

```text
Apply complete! Resources: 4 added, 1 changed, 0 destroyed.
```

Output `game_status_sync_schedule_name = nba-game-status-sync-schedule`.

---

## Scheduler Verification

| Check | Observed |
| --- | --- |
| Lambda | `game-status-sync` **Active** |
| Schedule | `nba-game-status-sync-schedule` **ENABLED** |
| Cadence | `rate(15 minutes)` UTC, flexible window **OFF** |
| Target | `game-status-sync` |
| Input | `{}` (no `manualCanary`, no confirm token) |

---

## Existing Family Freeze Verification

| Resource | State |
| --- | --- |
| nightly-bdl-updater-daily | DISABLED |
| odds-pre-game-snapshot-schedule-0..8 | DISABLED |
| injuries-snapshot-schedule | DISABLED |
| boxscore-scraper-daily | DISABLED |
| nba-player-props-0..2 | DISABLED |
| props worker ESM | **Disabled** |
| postgame queue / worker | **does not exist** |

Observation window 2026-09-11T04:36Z–04:55Z CloudWatch Invocations: status-sync **2**; all other listed families **0**.

---

## Scheduled Run 1

Scheduler-originated. Distinct from 13C.3A canary (`233a8bb5-…` at 04:17:50Z, Oct 22 window, fetched 2).

| Field | Value |
| --- | --- |
| Time | 2026-09-11T04:37:15.309Z |
| RequestId | `486aa385-5227-4016-af9f-df7e3f32b26a` |
| Domain duration_ms | 1322 |
| REPORT Duration | 1428.50 ms |
| games fetched | 0 |
| inserted / updated / unchanged | 0 / 0 / 0 |
| status_changes | 0 |
| became_final | 0 |
| final_preserved | 0 |
| provider_errors | 0 (completed, not failed) |
| BDL HTTP | 1 |
| limiter | granted, `wait_ms=0`, `acquire_retries=0` |

Empty 2026 ET today±1 window (mid-September) is expected. Not a skip: freeze-skip would not emit `bdl_throttle`.

---

## Scheduled Run 2+

| Field | Value |
| --- | --- |
| Time | 2026-09-11T04:51:47.164Z |
| RequestId | `486aa388-d627-4016-af9f-df7e3f32b26a` |
| Interval from run 1 | ~14.5 minutes |
| Domain duration_ms | 1377 |
| REPORT Duration | 1462.41 ms |
| games fetched | 0 |
| inserted / updated / unchanged | 0 / 0 / 0 |
| became_final / final_preserved | 0 / 0 |
| BDL HTTP | 1 |
| limiter | granted, `wait_ms=0`, `acquire_retries=0` |

No manual invoke was used. Logs contain no `manualCanary`, no `STATUS_SYNC_MANUAL_CANARY`, no `2026-10-22`. No `game_status_sync_failed`. No retry storm (one START per interval).

---

## Provider Request Budget

Certified frequent query unchanged: `seasons[]=2026`, ET yesterday→tomorrow, `per_page=100`, max 3 pages, `/v1/games` only.

| Metric | Value |
| --- | ---: |
| Polls observed | 2 |
| BDL HTTP requests | 2 |
| Average requests/poll | 1.0 |
| Maximum pages | 1 |
| Unexpected pagination | none |
| 401 / 403 / 429 / 5xx | 0 |

Typical ~1 request/poll. Matches budget.

---

## Dynamo Limiter

Both scheduled runs:

```text
{"evt":"bdl_throttle","worker":"game-status-sync","decision":"granted","wait_ms":0,"acquire_retries":0,"attempt":0}
```

Shared table `nba-bdl-rate-limit`. No raw fetch.

---

## Database Results

Fingerprints **identical** before run 1 and after run 2:

| Table | n | max(updated_at) |
| --- | ---: | --- |
| `analytics.games` | 5163 | 2026-09-08 19:34:19.360402+00 |
| `analytics.player_game_logs` | 138296 | 2026-09-08 19:34:19.360402+00 |
| `analytics.team_game_stats` | 7924 | 2026-09-08 19:34:19.360402+00 |
| `analytics.players` | 5534 | 2026-09-08 19:34:19.360402+00 |
| `analytics.game_starters` | 13200 | 2026-09-10 05:24:02.761622+00 |
| `analytics.player_game_advanced` | 104756 | 2026-09-10 05:53:32.823425+00 |
| `analytics.game_flow` | 1322 | 2026-09-10 16:39:44.358861+00 |
| `analytics.player_injury_status_current` | 150 | 2026-05-06 18:00:30.931442+00 |
| `analytics.game_odds_current` | 334 | 2026-09-06 18:00:47.613248+00 |
| `analytics.player_prop_current` | 25812 | 2026-05-02 18:00:16.305881+00 |

Outcome: **UNCHANGED / empty slate**. Healthy. Postgres was used for 0 upserts because 0 provider rows. No other tables written.

---

## Final Detection / Preserve

No 2026 game in the frequent window, so none became Final.

- `became_final=0` on both polls
- Final-preserve not exercised live (fixture-certified)
- No postgame fanout

---

## Ops / Missed-Run State

`npm run ops:aws-ingestion-status`:

| id | deployState | scheduleObserved |
| --- | --- | --- |
| `game_status_sync` | **DEPLOYED** | **ENABLED** |
| nightly / odds / injuries / props controller / boxscore | DEPLOYED | **DISABLED** |
| postgame_stage_worker | NOT_DEPLOYED | UNKNOWN |

Status-sync is no longer NOT_DEPLOYED / frozen-not-expected on the AWS snapshot. Cadence metadata remains 15m + 15m grace. Two successes ~15 minutes apart → missed-run would classify **OK** if config is ACTIVE. `errors24h=0`.

Ops CLI top-level `scheduleObserved=ENABLED` is the rollup (any ENABLED wins). Per-family rows still show other families DISABLED.

Signed-in `/ops` was **not** given a global `LIVE_INGESTION_ENABLED=true` in the Next.js app env. That flag still classifies **all** families together; flipping it would mark disabled families ACTIVE and arm false CONFIG_MISMATCH. AWS CLI is the activation source of truth. Per-family ops config is a 13C.4 documentation/display item, not a runtime defect.

---

## CloudWatch / Alarm State

- `nba-game-status-sync-errors`: **OK**, `treat_missing_data=notBreaching`
- Structured start / `bdl_throttle` / completed on both runs
- No secrets, no provider payload dumps
- No throttles on the snapshot
- No unexpected Errors

---

## Subscription Safety

GOAT remains inactive. Observation logs show only the status-sync job and limiter. Zero calls to `/v1/stats`, injuries, odds, props, lineups, Advanced, or Plays. Those Lambdas were not invoked.

---

## Postgame Isolation

No postgame table, queue, Lambda, SQS send, or ESM. `became_final=0`. 13F parked.

---

## Post-Activation Terraform Plan

Normal full plan (`tfplan-13c3b-post.bin`):

```text
No changes. Your infrastructure matches the configuration.
```

Active status-sync is Terraform-managed, not a console toggle.

Restart/redeploy safety: a future normal apply with the same tfvars keeps status-sync ENABLED + live env, and keeps other families DISABLED + replay/offseason/dry-run. Global live without a family execution flag cannot ENABLED-thaw or live-env those Lambdas.

Rollback (if needed later): set `game_status_sync_execution_enabled=false` (and/or `game_status_sync_enable_schedule=false`). Do **not** set `game_status_sync_create=false` (that destroys the Lambda).

---

## Mutation Summary

Observation period = two scheduled polls after apply (04:37Z–04:51Z).

### AWS

| Metric | Total |
| --- | ---: |
| Resources added | **4** |
| Resources changed | **1** (status-sync env) |
| Resources destroyed | 0 |
| Schedules enabled | **1** (`nba-game-status-sync-schedule`) |
| Scheduled Lambda invocations | **2** |

### BDL

| Metric | Total |
| --- | ---: |
| HTTP | **2** |
| HTTP per poll | **1** |
| 429 / 401 / 403 / 5xx | **0** |

### Database

| Metric | Total |
| --- | ---: |
| inserted | **0** |
| updated | **0** |
| unchanged / empty | **0 rows in window** (fetched 0) |
| became_final | **0** |
| final_preserved | **0** |

### Other systems

| Metric | Total |
| --- | ---: |
| SQS sends | **0** |
| S3 writes | **0** |
| postgame writes | **0** |

---

## Remaining Risks

1. Mid-September frequent window fetches **0** 2026 games until the provider publishes the nearby slate. That is certified frequent-mode, not a bug. Tip-off week will start returning rows without a query redesign.
2. `/ops` web still uses a **global** live/freeze classification. Do not set app `LIVE_INGESTION_ENABLED=true` until per-family config exists, or other families will look ACTIVE while DISABLED.
3. Global live is now true. **Do not** set any other `*_execution_enabled` flag without a dedicated activation step.
4. Scheduler Input must remain `{}`. Never paste the manual-canary confirm JSON.
5. Do not set `game_status_sync_create=false`.
6. Ops CloudWatch `lastInvocationAt` is bucketed (03:55Z shown); logs are source of truth (04:37Z / 04:51Z).

---

## End State

```text
game-status-sync = DEPLOYED + ACTIVE + SCHEDULED + OBSERVED

nightly = FROZEN
odds = FROZEN
injuries = FROZEN
props controller = FROZEN
props worker = FROZEN
BBRef = FROZEN
postgame = NOT_DEPLOYED
```

13F remains parked.

---

## Recommended Next Step

**13C.4 — live status-sync operational signoff + season-monitoring handoff**

Small closure/documentation step, not more architecture. After that, decide whether to purchase GOAT and begin injuries → odds → props, or shift to WOWY/UI/product work while status-sync runs. Do **not** start either automatically.

---

## Verification Checklist

1. `nba-game-status-sync-schedule` is ENABLED, Input `{}`, rate 15 minutes.
2. `game-status-sync` env is `live_api` / `0` / `0` / `LIVE_INGESTION_ENABLED=1`.
3. Nightly (and the other five) remain `replay` / `1` / `1` with DISABLED schedules.
4. Props ESM stays Disabled.
5. Do not enable any other `*_execution_enabled` flag.
6. Do not flip `game_status_sync_create` to false.
7. Do not set Vercel/app `LIVE_INGESTION_ENABLED=true` until `/ops` is per-family.

---

## Step Verdict

`GREEN — game-status-sync is safely active and observed in production`
