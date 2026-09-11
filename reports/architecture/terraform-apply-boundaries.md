# Terraform apply boundaries (Step 13I.2)

**Date:** 2026-09-10  
**Source of truth:** `reports/architecture/terraform-aws-architecture-overview.md` (13I.1)  
**This step:** make the Court Context Terraform root module safe to plan/apply **one infrastructure family at a time** while production remains frozen.  
**Apply:** **not performed.** No status-sync deploy, no postgame deploy, no schedule enable, no BDL calls.

**Verdict:** `YELLOW — apply isolation improved but unrelated drift remains`

---

## Safety / Scope

Confirmed from gitignored `infra/terraform.tfvars`, repo `.env`, HCL defaults, and frozen plans (`-lock=false -refresh=false`). No AWS mutations.

| Gate | State |
| --- | --- |
| `live_ingestion_enabled` | **false** (tfvars + variable default) |
| EventBridge / Scheduler ingestion schedules | **DISABLED** in Scenario A plan (no `state` updates) |
| `DATA_MODE` | `replay` (tfvars Lambda env maps + `.env`) |
| `OFFSEASON_MODE` | `1` |
| `CRON_DRY_RUN` | `1` |
| Product pin | `PINNED_ANALYTICS_SEASON = '2025'` in `lib/season.ts` |
| GOAT | Inactive (`BDL_GOAT_SUBSCRIPTION` is not `1`; postgame HCL pins `"0"`) |
| 13F / postgame | Parked: `postgame_create=false` (default); absent from frozen plan |
| status-sync | `CODE_ONLY_NOT_DEPLOYED`: `game_status_sync_create=false`; absent from frozen plan |
| Family execution flags | All default **false**; not set true in tfvars |

Creation flags are **not** `live_ingestion_enabled`. New variables: `game_status_sync_create`, `postgame_create`, plus per-family `*_execution_enabled`.

---

## Previous Apply Risk

13I.1 classified a full apply as **RISKY** because a frozen plan would still:

1. Create unfinished **status-sync** Lambda/IAM/alarm
2. Create unfinished **postgame** SQS/DLQ/worker/ESM/alarm
3. Push **zip-hash** updates onto live Lambdas (`archive_file` over whole directories including `node_modules`)
4. Create HCL-only alarms for missing CODE_ONLY resources

Activation was already fail-closed (`schedules DISABLED` while `live_ingestion_enabled=false`), but **resource creation was not isolated**.

---

## Creation Boundary Model

Repo-native names (not `create_status_sync` / `create_postgame`):

```text
game_status_sync_create = false  → no status-sync AWS resources in baseline plan
postgame_create         = false  → no postgame AWS resources in baseline plan
```

`enable_schedule` / `odds_enable_schedule` / `injuries_enable_schedule` / `player_props_enable_schedule` / `boxscore_enable_schedule` / `game_status_sync_enable_schedule` remain **resource-existence** (`count`) flags. They do not set `ENABLED`.

`live_ingestion_enabled` is **not** a create flag.

---

## Activation Boundary Model

```text
effective_family_execution =
    live_ingestion_enabled
    && family_execution_enabled
```

Implemented as `local.family_schedule_enabled` in `infra/lambda.tf`. Each schedule `state` uses its family local (`local.nightly_schedule_state`, `local.odds_schedule_state`, …), not a single global ENABLED mapping.

Global live **alone** cannot ENABLED-thaw nightly, odds, injuries, props, BBRef, or status-sync.

---

## Status-Sync Isolation

| Flag | Frozen default | Authorized future deploy while frozen |
| --- | --- | --- |
| `game_status_sync_create` | false | **true** |
| `live_ingestion_enabled` | false | **false** |
| `game_status_sync_execution_enabled` | false | false |
| `game_status_sync_enable_schedule` | false | false unless the Scheduler should exist DISABLED |

When create is true and execution is false:

- Lambda, IAM, limiter policy, Errors alarm **may** be created
- Scheduler is **not** created unless `game_status_sync_enable_schedule=true`
- Even if the schedule exists, `state` stays **DISABLED** until live **and** `game_status_sync_execution_enabled`

Not deployed in this step.

---

## Postgame Isolation

`postgame_create=false` counts out queue, DLQ, worker, IAM, ESM, and DLQ alarm.

Status-sync create **does not** pull postgame into the plan (Scenario B).

ESM, when created later: `enabled = local.family_schedule_enabled.postgame` (live **and** `postgame_execution_enabled`). Queue messages are not purged by this flag.

---

## Alarm Lifecycle

| Alarm | Lifecycle |
| --- | --- |
| `nba-game-status-sync-errors` | `count = var.game_status_sync_create` |
| `nba-postgame-stage-dlq-not-empty` | `count = var.postgame_create` |
| `nba-injuries-snapshot-errors` | Always on — deployed injuries family observability |
| `nba-player-props-dlq-not-empty` | Always on — deployed props queue observability |
| Existing nightly / odds / boxscore / props custom alarms | Unchanged; already in state |

Do not create alarms for nonexistent CODE_ONLY resources. Injuries Lambda and props DLQ **exist** in AWS; those two alarms are intentional deployed-family gaps (still **creates** on a frozen apply until authorized).

---

## Lambda Packaging / Hash Churn

**Root cause (13I.1):** `data.archive_file` zipped entire `lambda/<name>/` trees. Local `node_modules` / `dist` mtimes made `output_base64sha256` change even when source did not.

**Deployed functions affected:** nightly, odds, injuries, props controller, props worker, boxscore. Status-sync was already `.package`-based but its entry re-export produced an **empty** CJS bundle (`handler → undefined`). Postgame is not deployed; left on directory zip behind `postgame_create`.

**Not used:** `ignore_changes = [source_code_hash]` (would hide real code updates).

**Fix:** esbuild bundle → `lambda/<name>/.package/dist/…` → Terraform `source_dir = …/.package` and `source_code_hash = filebase64sha256(<js>)` (props: combined hash of controller + worker). Shared BDL limiter / identity / provider client changes **still** change the hash because they are bundled.

Status-sync entry now uses a local import/re-export so esbuild includes `lib/games/status-sync-lambda.ts` (~1.4 MB artifact, previously ~1 KB).

Build: `npm run build:ingestion-lambdas` and `npm run build:game-status-sync-lambda`.

---

## Deterministic Build Results

Two consecutive `node scripts/ops/bundle-ingestion-lambda.mjs --all` runs produced **identical** SHA-256:

| Artifact | sha256 |
| --- | --- |
| `nightly-bdl-updater/dist/index.js` | `40b7933736d3df187a86785a0059805c1f49446b8d7981a0b40fd4b7b8bba473` |
| `odds-pre-game-snapshot/dist/index.js` | `04bcadf4b5189599666681e8dd2661d0f4b2e66195ccc55d7e723b2763e7c8b9` |
| `injuries-snapshot/dist/index.js` | `864084a77e0822fc6d97dd8fc80a7c70c0c7a3960d29105f5ce728b3e5eb626d` |
| `player-props-snapshot/dist/controller.js` | `3879fc3151cbc879f4afa30023fec1f0e4207653e35d374a2fdc3dd1ca74d569` |
| `player-props-snapshot/dist/worker.js` | `5d9c17e3aa465c2421d0b3076aeb3bbb6773f7d80b90f9dfda97992035b6b8b9` |
| `boxscore-scraper/dist/index.js` | `6b92fdc4d8877047ff081d35e7fd408f878e777305cc62584601900c9806c1ce` |

Automated: `scripts/ops/__tests__/ingestion-lambda-bundle-stability.test.ts` (build twice, assert equal hashes).

---

## Props ESM Freeze Model

**Decision:** disable the props worker event-source mapping unless live **and** `player_props_execution_enabled`.

```text
live_ingestion_enabled=false
  → aws_lambda_event_source_mapping.player_props_worker_queue.enabled = false
```

Queued messages are **preserved** (no `sqs:PurgeQueue`, no message delete). Application freeze (`DATA_MODE=replay` / `OFFSEASON_MODE=1` / `CRON_DRY_RUN=1`) remains a second layer.

**Operational caveat (accepted):** while ESM is disabled, messages sit until the mapping is re-enabled. Retention on the game queue is 86400 seconds; a message sitting longer than that would expire. 13I.1 observed the worker idle (last invocation well before this step, schedules already DISABLED), so freeze-disable is safe for the current empty/idle queue. If a future freeze happens with a backlog, drain or accept retention risk **before** leaving ESM off for >1 day.

When `live_ingestion_enabled && player_props_execution_enabled`, ESM stays **enabled** (matches current AWS); Scenario C3 showed no ESM change.

---

## Ops Resource Metadata Fix

`lib/ops/aws-ingestion-resources.ts` (no AWS changes):

| Catalog (before) | Terraform / AWS (production) | Catalog (after) |
| --- | --- | --- |
| odds rules `0–4` | `odds-pre-game-snapshot-schedule-0..8` | `OPS_ODDS_RULE_COUNT` default **9** → `0..8` |
| `nba-player-props-schedule` plus `0..2` | Scheduler `nba-player-props-0..2` only | default `nba-player-props-0..2`; `OPS_PROPS_SCHEDULE` override only if set |

---

## Scenario A — Frozen Baseline Plan

`terraform plan -lock=false -refresh=false` with current tfvars (live false, create flags default false).

**Absent:** status-sync family, postgame family, schedule ENABLED, destroys.

**Remaining diffs (2 to add, 8 to change, 0 to destroy):**

| Action | Resource | Why |
| --- | --- | --- |
| **create** | `injuries_snapshot_errors` | Deployed-family observability; not in state |
| **create** | `player_props_dlq_not_empty` | Deployed-family observability; not in state |
| **update** | `player_props_controller_low_coverage` `treat_missing_data` `breaching` → `notBreaching` | Pre-existing HCL/AWS alarm drift (13G) |
| **update** | props worker ESM `enabled` `true` → `false` | Requested freeze consistency |
| **update** | six deployed Lambdas `source_code_hash` | **One-time packaging migration** (bundle JS hash vs old directory zip) |

Schedules: no `state` changes (remain DISABLED).

Classification: **SAFE_BUT_REVIEW** (no CODE_ONLY creates; remaining items are explicit).

---

## Scenario B — Status-Sync Frozen Deploy Plan

Same freeze, plus `-var=game_status_sync_create=true`. **Not applied.**

**Added vs A:** status-sync Lambda, execution role, basic-execution attachment, limiter IAM, Errors alarm.

**Not added:** status-sync Scheduler (`game_status_sync_enable_schedule` still false), postgame anything, other family ENABLED.

**Still present:** the same 8 baseline updates (packaging hashes, ESM disable, alarm drift) plus the two deployed-family alarm creates.

A **normal** apply of Scenario B is therefore **not** status-sync-only until the Scenario A hygiene diffs are applied (or a temporary `-target` is used).

---

## Scenario C — Activation Truth Table

Plans only (`-refresh=false`). Family flags default false unless overridden.

| Inputs | Schedules / ESM | Result |
| --- | --- | --- |
| `live=true`, all `*_execution_enabled=false` | No schedule `state` updates; ESM still `true→false` (props family false) | Global live **does not** thaw families |
| `live=true`, `nightly_execution_enabled=true` | **Only** `nightly-bdl-updater-daily` `DISABLED→ENABLED` | Other families stay DISABLED |
| `live=true`, `player_props_execution_enabled=true` | **Only** `nba-player-props-0..2` `DISABLED→ENABLED`; ESM already enabled → no ESM diff | Nightly/odds/injuries/boxscore stay DISABLED |

Effective rule confirmed: live ∧ family.

---

## Terraform Validation

- `terraform fmt -recursive infra` — applied (`lambda.tf` alignment)
- `terraform validate` — **Success**
- No `terraform apply`
- No `terraform state rm` / `mv` / import

---

## Tests

| Area | File |
| --- | --- |
| Creation vs activation, packaging paths | `infra/__tests__/apply-boundaries.test.ts` |
| Fail-closed + family AND | `infra/__tests__/ingestion-schedule-fail-closed.test.ts` |
| Status-sync create gate | `infra/__tests__/game-status-sync.test.ts` |
| Postgame create gate | `infra/__tests__/postgame-queue.test.ts` |
| Alarm lifecycle | `infra/__tests__/ingestion-alarms.test.ts` |
| Ops names | `lib/ops/__tests__/aws-ingestion-resources.test.ts` |
| Bundle hash stability | `scripts/ops/__tests__/ingestion-lambda-bundle-stability.test.ts` |
| Status-sync artifact (real bundle) | `lib/games/__tests__/game-status-sync-artifact.test.ts` |

All of the above passed in this step.

---

## Full Apply Assessment

**SAFE_BUT_REVIEW**

CODE_ONLY isolation is complete: a frozen full apply **will not** create status-sync or postgame. Schedules stay DISABLED. Global live alone does not enable families.

A frozen full apply **will** still:

1. Publish new **bundled** Lambda code (legitimate packaging cutover, not `node_modules` mtime noise)
2. Disable props ESM
3. Create injuries Errors + props DLQ alarms
4. Flip props controller coverage alarm `treat_missing_data` to `notBreaching`

Those are understood and freeze-safe, but they are **not** a no-op. Until that hygiene apply lands, a status-sync create plan **shares** those unrelated updates (isolation incomplete for “family-only apply”).

---

## Deferred Infrastructure Hardening

Intentionally **not** done in 13I.2. Ranked by operational risk:

| Rank | Topic | Why later |
| --- | --- | --- |
| 1 | Remote encrypted state + locking | Local gitignored state; no lock; laptop is the control plane |
| 2 | Secrets Manager / SSM | BDL key + DB URL still in gitignored tfvars → Lambda env |
| 3 | `.terraform.lock.hcl` policy | File is gitignored today; pin vs ignore is a team choice |
| 4 | Lambda shared-code cleanup | Copies under `lambda/*/bdl-live-rate-limit*` vs bundle-from-lib; bundling reduced zip noise but copies remain |
| 5 | AWS tags | Zero tags on audited resources |
| 6 | CloudWatch log-group retention | Default log groups unmanaged |
| 7 | Staging / environment isolation | Single root module, single account/region |
| 8 | Modules, resource renames, feature-file reorganization | Address churn; needs a dedicated state-move window |

---

## Recommended Deployment Strategy

Do **not** make `terraform -target` the permanent workflow.

Preferred after this step:

```text
1. Frozen hygiene apply (optional but unblocks family-only plans)
   live_ingestion_enabled=false
   game_status_sync_create=false
   postgame_create=false
   → packaging hashes, props ESM disable, deployed-family alarms
        ↓
2. Create status-sync family
   game_status_sync_create=true
   live_ingestion_enabled=false
   game_status_sync_execution_enabled=false
   game_status_sync_enable_schedule=false
        ↓
3. Normal terraform plan (expect only status-sync family if step 1 landed)
        ↓
4. Normal terraform apply
        ↓
5. Resource exists while frozen
        ↓
6. Manual canary (CLI / invoke), still no schedule
        ↓
7. Family-specific activation later
   live_ingestion_enabled=true
   AND game_status_sync_execution_enabled=true
   AND (optional) game_status_sync_enable_schedule=true
```

Use `-target` only as a **temporary** fallback if step 1 has not been applied and an operator must create status-sync without publishing the six Lambda bundles.

---

## Recommended Next Step

**Do not apply, deploy status-sync, resume 13F, or enable ingestion automatically.**

Operator choice:

1. **13I.3 (suggested):** authorized frozen hygiene apply of Scenario A’s SAFE_BUT_REVIEW diffs only.
2. **13C.3A:** status-sync create while frozen — prefer after (1), otherwise accept packaging/ESM/alarm diffs in the same plan or use `-target` as fallback.

This step **stops** here.

---

## Verification Checklist

1. Confirm `infra/terraform.tfvars` still has `live_ingestion_enabled = false` and no `*_execution_enabled = true`.
2. Run `npx vitest run infra/__tests__/apply-boundaries.test.ts infra/__tests__/ingestion-schedule-fail-closed.test.ts infra/__tests__/game-status-sync.test.ts infra/__tests__/postgame-queue.test.ts`.
3. Run `npm run build:ingestion-lambdas` twice and confirm SHA-256 lines match.
4. Run `terraform -chdir=infra validate` (no apply).
5. Run a frozen `terraform plan -lock=false -refresh=false` and confirm **no** `game_status_sync` / `postgame` creates.
6. Confirm ops catalog lists odds `0..8` and props `nba-player-props-0..2` (`npx vitest run lib/ops/__tests__/aws-ingestion-resources.test.ts`).
7. Do **not** `terraform apply` until an explicit later step.

---

## Step Verdict

`YELLOW — apply isolation improved but unrelated drift remains`
