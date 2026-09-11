# Frozen Terraform hygiene apply (Step 13I.2A)

**Date:** 2026-09-10 (apply completed 2026-09-11 03:51–03:52 UTC)  
**Predecessor:** 13I.2 `YELLOW — apply isolation improved but unrelated drift remains`  
**This step:** apply only the reviewed Scenario A hygiene set so a later status-sync deploy can be a normal isolated plan.  
**Not in scope:** 13C.3A, status-sync deploy, postgame, schedule enable, Lambda invoke, BDL HTTP.

**Verdict:** `GREEN — frozen Terraform baseline is clean and ready for status-sync deployment`

---

## Safety / Scope

Frozen configuration was verified **before** plan/apply and remains true **after**:

| Gate | Value | Source |
| --- | --- | --- |
| `live_ingestion_enabled` | `false` | `infra/terraform.tfvars` |
| `game_status_sync_create` | `false` (default; not set in tfvars) | `infra/variables.tf` |
| `postgame_create` | `false` (default; not set in tfvars) | `infra/variables.tf` |
| Family `*_execution_enabled` | all `false` (defaults; not set in tfvars) | `infra/variables.tf` |
| `DATA_MODE` / `OFFSEASON_MODE` / `CRON_DRY_RUN` | `replay` / `1` / `1` | tfvars Lambda maps + AWS GetFunctionConfiguration |
| `PINNED_ANALYTICS_SEASON` | `2025` | `lib/season.ts` |
| GOAT | inactive | not set to `1` |
| 13F / postgame | parked | `postgame_create=false`; queue/function absent in AWS |

No `-target`. No schedule enable. No status-sync/postgame create. No BDL. No manual Lambda invoke.

---

## Authorized Change Set

| # | Change | Resource |
| --- | --- | --- |
| 1 | Publish deterministic bundles | six already-deployed Lambdas |
| 2 | Freeze props consumer | `aws_lambda_event_source_mapping.player_props_worker_queue` `enabled: true → false` |
| 3 | Create injuries Errors alarm | `aws_cloudwatch_metric_alarm.injuries_snapshot_errors` |
| 4 | Create props DLQ alarm | `aws_cloudwatch_metric_alarm.player_props_dlq_not_empty` |
| 5 | Quiet missing-data on props coverage alarm | `player_props_controller_low_coverage` `treat_missing_data: breaching → notBreaching` |

---

## Pre-Apply Verification

tfvars contains `live_ingestion_enabled = false` and freeze env maps. It does **not** set `game_status_sync_create`, `postgame_create`, or any `*_execution_enabled` (Terraform defaults `false`). Product pin 2025. No status-sync or postgame creation requested.

---

## Tests

Serial pre-apply run (`--fileParallelism=false`), 48 passed / 0 failed:

- `infra/__tests__/ingestion-schedule-fail-closed.test.ts`
- `infra/__tests__/apply-boundaries.test.ts`
- `infra/__tests__/game-status-sync.test.ts`
- `infra/__tests__/postgame-queue.test.ts`
- `infra/__tests__/ingestion-alarms.test.ts`
- `lib/ops/__tests__/aws-ingestion-resources.test.ts`
- `scripts/ops/__tests__/ingestion-lambda-bundle-stability.test.ts`
- `lib/games/__tests__/game-status-sync-artifact.test.ts`

A parallel first run flaked on props worker hash (two esbuild processes). Isolated and serial reruns were identical. **Did not apply until serial suite passed.**

---

## Deterministic Build Verification

Two consecutive `npm run build:ingestion-lambdas` runs, identical SHA-256:

| Artifact | sha256 |
| --- | --- |
| `nightly-bdl-updater/dist/index.js` | `40b7933736d3df187a86785a0059805c1f49446b8d7981a0b40fd4b7b8bba473` |
| `odds-pre-game-snapshot/dist/index.js` | `04bcadf4b5189599666681e8dd2661d0f4b2e66195ccc55d7e723b2763e7c8b9` |
| `injuries-snapshot/dist/index.js` | `864084a77e0822fc6d97dd8fc80a7c70c0c7a3960d29105f5ce728b3e5eb626d` |
| `player-props-snapshot/dist/controller.js` | `3879fc3151cbc879f4afa30023fec1f0e4207653e35d374a2fdc3dd1ca74d569` |
| `player-props-snapshot/dist/worker.js` | `5d9c17e3aa465c2421d0b3076aeb3bbb6773f7d80b90f9dfda97992035b6b8b9` |
| `boxscore-scraper/dist/index.js` | `6b92fdc4d8877047ff081d35e7fd408f878e777305cc62584601900c9806c1ce` |

No secrets in artifacts (bundled JS only under `.package/dist`).

---

## Terraform Validation

- `terraform fmt -check -recursive` — pass
- `terraform validate` — **Success**

---

## Reviewed Plan

Full frozen plan (refresh on, no `-target`), saved as `tfplan-13i2a-hygiene.bin` (gitignored; deleted after apply).

**Plan: 2 to add, 8 to change, 0 to destroy.**

| Operation | Address | Gate |
| --- | --- | --- |
| create | `aws_cloudwatch_metric_alarm.injuries_snapshot_errors` | AUTHORIZED |
| create | `aws_cloudwatch_metric_alarm.player_props_dlq_not_empty` | AUTHORIZED |
| update | `aws_cloudwatch_metric_alarm.player_props_controller_low_coverage` (`treat_missing_data`) | AUTHORIZED |
| update | `aws_lambda_event_source_mapping.player_props_worker_queue` (`enabled true→false`) | AUTHORIZED |
| update | `aws_lambda_function.nightly_bdl_updater` (`source_code_hash`) | AUTHORIZED |
| update | `aws_lambda_function.odds_pre_game_snapshot` (`source_code_hash`) | AUTHORIZED |
| update | `aws_lambda_function.injuries_snapshot` (`source_code_hash`) | AUTHORIZED |
| update | `aws_lambda_function.player_props_controller` (`source_code_hash`) | AUTHORIZED |
| update | `aws_lambda_function.player_props_worker` (`source_code_hash`) | AUTHORIZED |
| update | `aws_lambda_function.boxscore_scraper` (`source_code_hash`) | AUTHORIZED |

Rejected class (none present): status-sync/postgame creates, schedule `DISABLED→ENABLED`, destroys, queue/Dynamo replacement, IAM broadening, env thaw, season change, reserved-concurrency, S3, backend.

Output-only: new alarm name outputs; `postgame_stage_worker_event_source_enabled = false` (no postgame resource).

**Gate: PASS.** Applied that exact plan file (`terraform apply tfplan-13i2a-hygiene.bin`). No `-auto-approve`.

---

## Applied Changes

```text
Apply complete! Resources: 2 added, 8 changed, 0 destroyed.
```

Matches the reviewed plan. Partial-failure path was not needed.

---

## Schedule Verification

Read-only `describe-rule` / `get-schedule`: **all DISABLED**.

- `nightly-bdl-updater-daily`
- `odds-pre-game-snapshot-schedule-0` … `-8`
- `injuries-snapshot-schedule`
- `boxscore-scraper-daily`
- `nba-player-props-0` … `-2`

`nba-game-status-sync-schedule`: **does not exist** (`ResourceNotFoundException`).

---

## Props ESM Verification

UUID `5c1c500e-1f9a-42bc-8de7-9d9aa0a0bf28`: **State = Disabled**. Still mapped to the props game queue. Queue and DLQ remain. **No purge.**

Approximate depths (read-only):

| Queue | visible | in-flight |
| --- | --- | --- |
| `nba-player-props-game-queue` | 0 | 0 |
| `nba-player-props-game-dlq` | 0 | 0 |

---

## Lambda Verification

Six functions **Active**, freeze env unchanged, runtime `nodejs22.x`. Memory/timeout unchanged vs HCL. LastModified all ~2026-09-11 03:51–03:52 UTC (code publish). No invokes from this step.

| Function | Memory | Timeout | AWS CodeSha256 (zip) |
| --- | --- | --- | --- |
| `nightly-bdl-updater` | 512 | 300 | `vMsAMM5Ps4abL5cFcnDTCmrpGvjVm3T7OPAEyCRgNqc=` |
| `odds-pre-game-snapshot` | 512 | 300 | `WnmzleVLmrc8dKbYd8kvliY/YIeJ1EaeHGE8iaaLlR0=` |
| `injuries-snapshot` | 256 | 120 | `0LF9OoAYncAdS9uzLsTGIqDH5KOFZND188Y135kHsYY=` |
| `nba-player-props-controller-lambda` | 256 | 120 | `hDM8CfAsokvBMt9VPoRnyPBZul9kv9BNbjciKDZ+B+I=` |
| `nba-player-props-ingestion-lambda` | 512 | 300 | `hDM8CfAsokvBMt9VPoRnyPBZul9kv9BNbjciKDZ+B+I=` |
| `boxscore-scraper` | 1024 | 900 | `yz2oJRNZZjeWBddZ6QtxQkCaugYysL3T30HXulkrqNg=` |

Terraform `source_code_hash` hashes the bundled JS; AWS `CodeSha256` hashes the zip. They differ by design. Post-apply plan no-op confirms Terraform hashes match state.

IAM roles were not in the plan (unchanged).

---

## Alarm Verification

| Alarm | Present | `treat_missing_data` | State |
| --- | --- | --- | --- |
| `nba-injuries-snapshot-errors` | yes (new) | `notBreaching` | OK |
| `nba-player-props-dlq-not-empty` | yes (new) | `notBreaching` | OK |
| `nba-player-props-controller-low-coverage` | yes | `notBreaching` | OK |
| `nba-game-status-sync-errors` | **absent** | — | — |
| `nba-postgame-stage-dlq-not-empty` | **absent** | — | — |

---

## Freeze Verification

GetFunctionConfiguration (freeze keys only, no secrets):

All six: `DATA_MODE=replay`, `OFFSEASON_MODE=1`, `CRON_DRY_RUN=1`.

---

## Status-Sync / Postgame Absence

| Resource | AWS |
| --- | --- |
| Lambda `game-status-sync` | **NOT_DEPLOYED** (`ResourceNotFoundException`) |
| Schedule `nba-game-status-sync-schedule` | **NOT_DEPLOYED** |
| Lambda `postgame-stage-worker` | **NOT_DEPLOYED** |
| Queue `nba-postgame-stage-queue` | **NOT_DEPLOYED** (`NonExistentQueue`) |

Terraform state has **no** `game_status_sync` / `postgame` addresses.

---

## Post-Apply Full Plan

Normal full frozen plan with refresh, no `-target`, artifacts not rebuilt:

```text
No changes. Your infrastructure matches the configuration.
```

Lambda hashes do not churn. ESM stays disabled. Deployed-family alarms are in state. Status-sync/postgame absent. Schedules unchanged (DISABLED).

---

## Ops Verification

`npm run ops:aws-ingestion-status` (read-only, `bdlHttp: 0`, `invokedJobs: false`, `mutated: false`):

- `scheduleObserved: DISABLED`
- Recurring families `DEPLOYED` + Active
- `game_status_sync` / `postgame_stage_worker`: **NOT_DEPLOYED**
- postgame queue: **NOT_DEPLOYED**
- Props worker has no EventBridge/Scheduler (ESM freeze verified via AWS API `Disabled`; ops `scheduleObserved: UNKNOWN` for that row is expected — it is not a schedule)

Props queue row `deployState: UNKNOWN` is the existing ops telemetry gap (script/IAM), not absence: CLI confirmed the queue exists with depth 0.

Last CloudWatch invocation timestamps for nightly/odds/injuries are **before** this apply (2026-09-10 ~19:53 UTC). Props worker last invocation remains 2026-09-06. UpdateFunctionCode does not invoke.

---

## Provider / Data Mutation Check

| Action | This step |
| --- | --- |
| BDL HTTP | 0 |
| SQS send / purge | 0 |
| Manual Lambda invoke | 0 |
| Serving DB mutation from jobs | 0 |
| S3 writes | 0 |
| Terraform Lambda **code update** | authorized, executed |
| Lambda **execution** | not authorized, not performed |

---

## Terraform State Check

State now includes (among existing families):

- `aws_cloudwatch_metric_alarm.injuries_snapshot_errors`
- `aws_cloudwatch_metric_alarm.player_props_dlq_not_empty`
- `aws_lambda_event_source_mapping.player_props_worker_queue` (still the same UUID)

No `state rm` / `mv` / import / manual edit.

---

## Remaining Drift

**None** in Terraform vs AWS for this root module (post-apply plan no-op).

Ops props-queue UNKNOWN is a **read-path telemetry** limitation, not infrastructure drift.

---

## Baseline Classification

**CLEAN** — normal frozen full plan is a no-op.

---

## Recommended Next Step

**13C.3A — frozen game-status-sync deployment + one-shot canary**

That future step should:

1. set `game_status_sync_create=true`
2. keep `live_ingestion_enabled=false` and all `*_execution_enabled=false`
3. normal plan/apply (expect only status-sync family)
4. verify no schedule activation (`game_status_sync_enable_schedule` remains false unless explicitly creating a DISABLED schedule)
5. manually run one controlled scoped `/v1/games` canary
6. inspect DB/log effects
7. leave recurring schedule disabled

**Do not start 13C.3A in this step.**

---

## Verification Checklist

1. `live_ingestion_enabled=false` still in tfvars.
2. Post-apply `terraform plan` shows **No changes**.
3. All listed EventBridge/Scheduler names are DISABLED.
4. Props ESM State is Disabled; queues exist; depths recorded; no purge.
5. Six Lambdas Active with replay/offseason/dry-run.
6. Status-sync and postgame still NOT_DEPLOYED.
7. Do not invoke Lambdas or enable schedules until 13C.3A is explicitly authorized.

---

## Step Verdict

`GREEN — frozen Terraform baseline is clean and ready for status-sync deployment`
