# 2026–27 Frequent Game Status Sync Activation Readiness — Step 13C.3

**Step verdict:** `GREEN — frequent status sync is deployment-ready while frozen`

**Date:** 2026-09-10  
**Depends on:** 13C.2 domain GREEN (`reports/operations/2026-27-frequent-game-status-sync-foundation.md`)

13C.2 left Lambda as a freeze shell (`CODE_ONLY_NOT_BUNDLED`). This slice packages the real status-sync path, wires Terraform to the built artifact, and keeps production frozen.

**Not done (by design):** Terraform apply, Lambda deploy, schedule enable, live `/v1/games`, 13F resume, product-pin flip.

---

## Safety / Scope

| Gate | Result |
| --- | --- |
| `live_ingestion_enabled` | **false** (`infra/terraform.tfvars`) |
| Ingestion schedules | remain **DISABLED** (frozen plan no-op) |
| `/v1/stats`, lineups, Advanced, Plays, injuries, odds, props, GOAT | **not called** |
| Postgame scanner / SQS / worker | **not invoked / not applied** |
| S3 / serving-stat writes / pin | **unchanged** (`PINNED_ANALYTICS_SEASON=2025`) |
| Terraform apply / Lambda deploy | **none** |
| BDL HTTP | **0** |
| `DATA_MODE` / offseason / dry-run | `replay` / `1` / `1` |

Preferred HTTP used: **0**. Provider query shape remains the 13C.2 certified `/v1/games` window. No live canary in this step.

---

## Packaging Audit

13C.2 zip was `source_dir = lambda/game-status-sync` (TypeScript freeze shell only). Root `tsconfig` excludes `lambda/`, so `@/` aliases would not resolve at Lambda runtime.

13C.3:

- Single domain remains `lib/games/status-sync.ts` (no duplicated planner in `lambda/`).
- Entry `lambda/game-status-sync/index.ts` re-exports `lib/games/status-sync-lambda.ts`.
- `esbuild` bundles `@/*` → repo root into `.package/dist/index.js` (CJS, Node 22).
- `pg-native` is external (optional); `pg` and `@aws-sdk/client-dynamodb` are bundled so the zip does not depend on Next.js or a Lambda `node_modules` tree.
- Terraform now zips `.package`, not the source freeze shell.

---

## Lambda Build

Documented command (no AWS / BDL / Postgres required):

```bash
npm run build:game-status-sync-lambda
```

Equivalent: `npx tsx scripts/ops/build-game-status-sync-lambda.ts` → `node lambda/game-status-sync/build.mjs`.

Must run before a future `terraform plan/apply` so `archive_file` hashes the real bundle.

---

## Artifact Inspection

| Check | Result |
| --- | --- |
| Path | `lambda/game-status-sync/.package/dist/index.js` |
| Size | **1,443,705 bytes (~1.4 MB)** |
| Handler | `dist/index.handler` (`exports.handler`, `exports.runLambdaGameStatusSync`) |
| Domain | `game_status_sync_*` events, `/v1/games`, Final-preserve SQL, `fetchBdlLive` present |
| Aliases | no `require('@/` at runtime |
| Freeze shell | `CODE_ONLY_NOT_BUNDLED` **removed** |
| Postgame / S3 / SQS | not in bundle |
| Secrets | no `.env`, `terraform.tfvars`, `AKIA…`, private keys, or `postgres://user:pass@` literals |

Size is reasonable (AWS SDK DynamoDB client + `pg` + domain in one file).

---

## Runtime Simulation

**Frozen artifact** (`DATA_MODE=replay`, `OFFSEASON_MODE=1`, `CRON_DRY_RUN=1`, `LIVE_INGESTION_ENABLED=false`):

- handler loads
- `status=skipped`, `bdlHttp=0`, `wroteDb=false`

**Mocked thawed artifact** (injected fetch/store, no network):

- Scheduled → Final: `becameFinal=1`, `game_became_final` emitted, query includes `seasons[]=2026` + date window
- Final + provider Scheduled: `finalPreserved=1`, no `game_became_final`
- Final + corrected Final score: update allowed
- New 2026 game with team IDs: insert; missing team IDs: reject

---

## Environment Contract

Exact repo names. No new duplicate knobs.

### required

| Name | When |
| --- | --- |
| `STATUS_SYNC_TARGET_SEASON` | Lambda live path (fail closed if missing/invalid/protected) |
| `BALLDONTLIE_API_KEY` (alias `BALDONTLIE_API_KEY`) | thawed, if fetch is not injected |
| `SUPABASE_DB_URL` | thawed, if store is not injected |

Set secrets via `game_status_sync_lambda_env` in tfvars (do not commit). Terraform already pins `STATUS_SYNC_TARGET_SEASON=2026`.

### optional/default

| Name | Default / source |
| --- | --- |
| `BDL_RATE_LIMIT_TABLE` | `nba-bdl-rate-limit` (`local.bdl_rate_limit_env` + explicit merge) |
| `BDL_RATE_LIMIT_BACKEND` | `dynamodb` |
| `BDL_RATE_LIMIT_WORKER` | `game-status-sync` |
| `BDL_RATE_LIMIT_INTERVAL_MS` / `MAX_REQUESTS` / `BURST` | shared limiter locals (13000 / 1 / 1) |
| `BDL_RATE_LIMIT_ACQUIRE_TIMEOUT_MS` | **20000** (status-sync override; shared default is 90000) |
| `BDL_RATE_LIMIT_MAX_RETRIES` | **0** (fail closed on 429; next 15m poll retries) |
| `DB_CONNECTION_TIMEOUT_MS` | 10000 |
| `DB_STATEMENT_TIMEOUT_MS` | 15000 |
| `OPS_LAMBDA_STATUS_SYNC` | `game-status-sync` |
| `OPS_STATUS_SYNC_SCHEDULE` | `nba-game-status-sync-schedule` |

### safety-critical

| Name | Frozen production |
| --- | --- |
| `LIVE_INGESTION_ENABLED` | `0` / `false` |
| `DATA_MODE` | `replay` (only `live_api` is live) |
| `OFFSEASON_MODE` | `1` |
| `CRON_DRY_RUN` | `1` |

Do **not** derive the live sync target from `PINNED_ANALYTICS_SEASON` or `CURRENT_ANALYTICS_SEASON`. Product pin stays **2025**.

---

## Target Season Safety

`parseRequiredStatusSyncTargetSeason`:

- missing → fail closed
- not `YYYY` → fail closed
- `2023` / `2024` / `2025` (`PROTECTED_HISTORY_SEASONS`) → refuse live mutation
- `2026` accepted

No BDL/DB on those failures. CLI helper `resolveStatusSyncTargetSeason` still defaults to 2026 for dry-run scripts; the Lambda live path does not.

---

## Freeze Gates

Both layers remain:

1. **Infrastructure:** `state = local.ingestion_schedule_state` → `DISABLED` while `live_ingestion_enabled=false`. Create flag `game_status_sync_enable_schedule` defaults **false** (resource not created). Frozen apply cannot invoke the job.
2. **Application:** `shouldSkipGameStatusSync` (live switch + `shouldSkipLiveMutations` + `shouldSkipLiveBdlHttp`) skips before fetch/store.

Tests cover both. Neither layer was weakened because the other exists.

---

## Terraform Resource Audit

`infra/game-status-sync.tf` (CODE_ONLY; not applied):

| Resource | Present |
| --- | --- |
| Lambda `game-status-sync` | yes — handler `dist/index.handler`, runtime nodejs22.x, arch x86_64 |
| Zip / hash | `lambda/game-status-sync/.package` → `source_code_hash` |
| IAM role + basic logs | yes |
| Limiter policy | `local.bdl_rate_limit_iam` (GetItem/PutItem/UpdateItem on limiter table only) |
| Env | freeze defaults + limiter + `STATUS_SYNC_TARGET_SEASON=2026` |
| Timeout | **90s** |
| Memory | **256 MB** |
| EventBridge Scheduler | created only if `game_status_sync_enable_schedule=true`; name `nba-game-status-sync-schedule` |
| Invoke role + `aws_lambda_permission` | yes, gated on the same flag |
| CloudWatch log group | **not managed** (same as other ingestion Lambdas) |
| SQS / S3 / Step Functions / postgame | **none** |

---

## Scheduler Semantics

Expression remains **`rate(15 minutes)`**.

**Chosen create behavior: Option B** (consistent with injuries/odds/nightly *variable defaults*):

- `count = var.game_status_sync_enable_schedule` default **false** → scheduler **not created**
- even if created, `state = local.ingestion_schedule_state` → **DISABLED** while frozen

A normal frozen Terraform apply **cannot trigger execution**. Future DEPLOY (13C.3A) should set `game_status_sync_enable_schedule=true` with `live_ingestion_enabled=false` so the rule exists DISABLED (Option A at apply time, still not invoking).

---

## IAM

Least privilege:

- `AWSLambdaBasicExecutionRole` (CloudWatch logs)
- DynamoDB GetItem/PutItem/UpdateItem on `nba-bdl-rate-limit` only

No S3, SQS, Step Functions, EventBridge mutation, or unrelated tables. Postgres is outbound TLS, not IAM.

---

## Limiter Integration

Reuses shared table **`nba-bdl-rate-limit`**. No new table. Worker name `game-status-sync`. Acquire timeout 20s; `BDL_RATE_LIMIT_MAX_RETRIES=0` so a 429 does not enter the 60s×3 sleep loop inside `fetchBdlLive`.

---

## DB Adapter

`lib/games/status-sync-db.ts`:

- `pg` Pool `max: 1`, SSL for Supabase, timeouts
- **does not import `lib/db.ts`** (that module throws at load without `SUPABASE_DB_URL`, which would break freeze)
- lazy-created only after thaw + env validation; `pool.end()` in `finally`
- `SELECT` by `game_id` then `ANALYTICS_GAMES_FINAL_PRESERVE_UPSERT_SQL`
- **Per-statement autocommit** (no slate-wide transaction): one bad row cannot roll back unrelated successful upserts. A thrown connection error still fails the invocation after some rows may have committed.
- Venue on update: keep local venue when provider venue is null (prevents wiping `analytics.games.venue` on status-only refreshes)

No live DB write in this step.

---

## Final-Preserve Runtime Regression

Packaged handler:

- local Final + provider Scheduled → `final_preserved += 1`, no `became_final`
- Final + corrected Final score → update allowed (13C.1/13C.2 semantics)

Historical Explorer Final header tests still pass.

---

## Observability / Ops Mapping

Events unchanged: `game_status_sync_started` | `game_status_changed` | `game_became_final` | `game_final_preserved` | `game_status_sync_completed` | `game_status_sync_failed`. JSON logs; no payloads or credentials.

| Catalog / ops | Terraform |
| --- | --- |
| family `game_status_sync` | — |
| cadence 0.25h + grace 0.25h | `rate(15 minutes)` |
| Lambda `game-status-sync` | `var.game_status_sync_lambda_function_name` default `game-status-sync` |
| schedule `nba-game-status-sync-schedule` | scheduler `name` |
| `deployedLambda: false` | remains false until an authorized deploy |

Missed-run with this family’s cadence:

- Frozen → `NOT_EXPECTED`
- Active + recent → `OK` / healthy
- Active + schedule disabled → `CONFIG_MISMATCH` / `FAILED`
- Active + overdue → `MISSED`

---

## Alarm Coverage

CODE_ONLY `aws_cloudwatch_metric_alarm.game_status_sync_errors` (`nba-game-status-sync-errors`), AWS/Lambda Errors, `treat_missing_data=notBreaching`. Not applied.

---

## Build Reproducibility

```bash
npm run build:game-status-sync-lambda
```

No manual zip copies.

---

## CI Suitability

The artifact test file runs the build inside Vitest. No AWS credentials, BDL key, or Postgres required. Runtime integration is mocked. No GitHub workflow file exists in this repo to wire; the test is CI-ready when Vitest runs.

---

## Terraform Validation

`terraform validate` → **Success** (local providers already initialized; no remote-backend init). `terraform fmt` on touched infra files (no reformatting needed).

---

## Frozen Terraform Plan

Ran `terraform plan -lock=false -refresh=false` against **local** state. **Did not apply.** Plan file deleted after inspection.

Status-sync safety:

| Assertion | Result |
| --- | --- |
| game-status schedule ENABLED | **no** — resource absent (`enable_schedule` default false) |
| existing EventBridge / Scheduler rules stay DISABLED | **yes** (all no-op, `state=DISABLED`) |
| postgame ESM enabled | **no** — would *create* mapping with `enabled=false` if applied; **not applied** |
| destroys | **0** |
| season pin / freeze env thaw | **no** (env remains sensitive freeze merge) |
| reserved concurrency failure | **no** (`reserved_concurrent_executions = -1`) |

### Unrelated drift (not normalized in 13C.3)

A full apply of this plan would also:

- **create** postgame queue/DLQ/worker/IAM/ESM (13F CODE_ONLY leftovers)
- **create** several CODE_ONLY alarms (injuries Errors, props DLQ, postgame DLQ, status-sync Errors)
- **update** source_code_hash on nightly/injuries/boxscore/props (local `archive_file` re-zip)
- **update** `player_props_controller_low_coverage` `treat_missing_data` breaching → notBreaching

Do **not** apply this plan to “get status-sync out.” 13C.3A should be a **narrow** apply of status-sync resources only, with `live_ingestion_enabled=false`.

---

## Secret Scan

Package walk + bundle content scan: **clean**. No `.env`, tfvars, credential filenames, `AKIA…`, PEM keys, or URL passwords. Scan does not print secret values.

---

## Historical Regression

Passed: Final-preserve, Historical Explorer Final header/timeline, status normalization, postgame scanner, ingestion schedule fail-closed, provider-capability cadence (15m / 15m grace).

---

## Activation Checklist

**Do not execute now.** Separate phases:

### DEPLOY (resources exist, schedule disabled)

1. Re-verify `/v1/games` entitlement (last certified in 13C.1; no need to call it for packaging).
2. Confirm `SUPABASE_DB_URL` + `BALLDONTLIE_API_KEY` in `game_status_sync_lambda_env` (uncommitted tfvars).
3. `npm run build:game-status-sync-lambda`
4. Set `game_status_sync_enable_schedule = true` **and keep** `live_ingestion_enabled = false`.
5. Apply **only** status-sync Lambda + IAM + DISABLED scheduler + quiet Errors alarm. Do not apply unrelated postgame/hash-churn resources.
6. Confirm scheduler state **DISABLED** and no invocations.

### CANARY (manual one-shot)

7. Confirm DB connectivity from the deployed function (still frozen env → skip). Then temporarily run with live flags **only on this function** *or* invoke a controlled one-shot that uses scoped `/v1/games` for season 2026.
8. Inspect CloudWatch events + `analytics.games` diffs (status/scores/start_time only).
9. Confirm Final-preserve on any certified Final already in DB.
10. Leave the recurring schedule **DISABLED**.

### ACTIVATE (schedule enabled)

11. Enable **only** the `game_status_sync` family (`live_ingestion_enabled` still must not blindly enable nightly/odds/injuries/props). If the global switch would enable other families, do **not** flip it until those families are intentionally in scope — prefer a dedicated status-sync enable path or accept that 13C.3A must document how to enable this schedule without thawing others.
12. Verify 15-minute invocations.
13. Confirm Final detection (`game_became_final`) on a live slate.
14. Monitor Errors alarm + missed-run (should be OK, not MISSED) before anything downstream (postgame / 13F).

**Note on step 11:** Today every scheduler uses `local.ingestion_schedule_state` from the **global** `live_ingestion_enabled` switch. Turning that switch true would ENABLE nightly/odds/injuries/props as well. 13C.3A must therefore either (a) enable this schedule with a **family-specific** state override while the global switch stays false, or (b) keep using manual invoke until a family-level enable exists. That is a 13C.3A design point, not this slice.

Safer 13C.3A default: **deploy DISABLED + manual invoke canary; do not flip `live_ingestion_enabled`.**

---

## Readiness Matrix

| Component | State |
| --- | --- |
| Domain logic | READY |
| Lambda package | READY |
| Handler runtime | READY |
| Shared limiter integration | READY |
| DB adapter | READY |
| IAM | READY |
| Scheduler Terraform | READY |
| Ops resource mapping | READY |
| Terraform validation | PASS |
| Frozen plan | PASS |
| Provider entitlement | AVAILABLE |
| Deployment | NOT_DEPLOYED |
| Activation | FROZEN |

---

## Files Changed

- `lib/games/status-sync.ts` — preserve venue on status-only updates
- `lib/games/status-sync-query.ts` — required target-season parser
- `lib/games/status-sync-lambda.ts` — freeze-gated Lambda runtime
- `lib/games/status-sync-fetch.ts` — `fetchBdlLive` adapter
- `lib/games/status-sync-db.ts` — `pg` Pool + Final-preserve upsert
- `lambda/game-status-sync/index.ts` — bundle entry (re-export)
- `lambda/game-status-sync/build.mjs` — esbuild
- `lambda/game-status-sync/package.json`, `tsconfig.json`, `.gitignore`
- `scripts/ops/build-game-status-sync-lambda.ts`
- `package.json` — `build:game-status-sync-lambda`
- `infra/game-status-sync.tf` — zip `.package`, timeout 90, IAM permission, retries=0
- `infra/monitoring.tf` — quiet Errors alarm
- `infra/outputs.tf` — alarm output
- `infra/terraform.tfvars.example` — 13C.3 comments
- tests under `lib/games/__tests__/`, `infra/__tests__/`, `lib/ops/__tests__/`, `lib/runtime/__tests__/`
- this report

---

## Remaining Risks

- Real Dynamo limiter + Postgres paths are packaged but only **mocked** at runtime until 13C.3A canary.
- Global `live_ingestion_enabled` would enable **all** existing schedules; do not flip it to activate status-sync.
- Unrelated local-plan drift (postgame CODE_ONLY, zip hash churn) must not ride along with a status-sync apply.
- `deployedLambda` stays false until AWS actually has the function; 13G will show NOT_DEPLOYED until 13C.3A.

---

## Recommended Next Step

**13C.3A — frozen infrastructure deployment + one-shot status-sync canary**

That future step should:

- deploy status-sync resources while the global switch is false
- confirm the schedule remains disabled (or uncreated until the create flag is set, then DISABLED)
- manually invoke one scoped `/v1/games` sync
- inspect DB/log result
- leave the recurring schedule disabled afterward

Do **not** start 13C.3A in this slice. Do **not** resume 13F while `/v1/stats` remains `BLOCKED_BY_SUBSCRIPTION`.

---

## Verification Checklist

1. `live_ingestion_enabled=false`
2. all ingestion schedules still DISABLED
3. BDL HTTP = 0
4. `/v1/stats` not called
5. GOAT endpoints not called
6. product pin still 2025
7. no Terraform apply
8. no Lambda deploy
9. no postgame activation
10. built status-sync artifact contains real handler/domain code
11. built artifact contains no secrets
12. ops catalog names match Terraform resource names

---

## Step Verdict

`GREEN — frequent status sync is deployment-ready while frozen`
