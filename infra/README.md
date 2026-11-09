Terraform is the source of truth for ingestion infrastructure (reconciled 2026-11-03). See `/AGENTS.md`. No console edits to Lambda env, schedules or rules; change tfvars/.tf and apply through a reviewed plan.

# Terraform – AWS Lambdas (ingestion jobs)

Terraform setup to manage the **nightly-bdl-updater**, **odds-pre-game-snapshot**, **injuries-snapshot**, **player-props** (controller + worker), and **boxscore-scraper** Lambdas and their optional schedules.

## Prerequisites

- **AWS CLI** configured (credentials and region).
- **Terraform** installed (>= 1.0).
- **Node.js 22** for building the Lambdas.

## Secrets

- Copy `terraform.tfvars.example` → `terraform.tfvars` and fill real values locally.
- `*.tfvars` is gitignored (except the `.example`). **Never commit** real DB URLs or API keys.
- Prefer AWS Secrets Manager / SSM for production Lambda env when you harden further; today vars are injected via `terraform.tfvars` / `TF_VAR_*` at apply time.
- If credentials were ever committed historically, rotate them at Supabase / BallDontLie / etc. Removing them from the working tree does not invalidate old secrets.

## Build the Lambdas before apply

Terraform packages each Lambda from the existing source tree. Build before apply (at least the functions you are changing):

```bash
cd lambda/nightly-bdl-updater && npm install && npm run build
cd ../odds-pre-game-snapshot && npm install && npm run build
cd ../injuries-snapshot && npm install && npm run build
cd ../player-props-snapshot && npm install && npm run build
cd ../boxscore-scraper && npm install && npm run build
cd ../..
```

If you skip this step, the zips may be missing or outdated and the deployed functions may fail.

## Run Terraform

From the repo root:

```bash
cd infra
terraform init
terraform plan -var-file=terraform.tfvars
terraform apply -var-file=terraform.tfvars
```

If you don’t use a `terraform.tfvars` file, set variables via `-var` or `TF_VAR_*` (e.g. `TF_VAR_aws_region=us-east-1`). Copy `terraform.tfvars.example` to `terraform.tfvars` and fill in real values (do not commit `terraform.tfvars`).

## Variables

**Shared:** **aws_region** – Region for all resources (default: `us-east-1`).

**nightly-bdl-updater:** **lambda_function_name**, **lambda_timeout**, **lambda_memory_size**, **lambda_env** (sensitive), **enable_schedule**, **schedule_cron**.

**boxscore-scraper:** **boxscore_lambda_function_name**, **boxscore_lambda_timeout** (default 900), **boxscore_lambda_memory_size** (default 1024), **boxscore_lambda_env** (sensitive; `SUPABASE_DB_URL` + freeze flags), **boxscore_enable_schedule**, **boxscore_schedule_cron** (`cron(0 8 * * ? *)` = 03:00 ET).

## Optional: enable EventBridge schedules

**nightly-bdl-updater:** Set `enable_schedule = true` and `schedule_cron = "cron(0 8 * * ? *)"` (or your desired UTC cron).

**odds-pre-game-snapshot:** Set `odds_enable_schedule = true` and **either** `odds_schedule_crons` (list) **or** `odds_schedule_cron` (single). For every 30 min 10am–12pm ET use the list (see `terraform.tfvars.example`):
```hcl
odds_schedule_crons = [
  "cron(0 15 * * ? *)", "cron(30 15 * * ? *)", "cron(0 16 * * ? *)", "cron(30 16 * * ? *)", "cron(0 17 * * ? *)",
]
```
(UTC 15–17 = 10am–12pm ET. For 6am–12pm ET use hours 11–17 with 0 and 30 minutes.)

Then run `terraform apply` again.

### Check: Odds EventBridge setup

1. **In `terraform.tfvars`** ensure:
   - `odds_enable_schedule = true`
   - `odds_schedule_crons = [ ... ]` with at least one cron (or set `odds_schedule_cron` for a single run).
2. **Validate:** `terraform -chdir=infra validate`
3. **Plan:** `terraform -chdir=infra plan -var-file=terraform.tfvars` (path relative to `infra/`). You should see 5× `aws_cloudwatch_event_rule.odds_schedule`, 5× `aws_cloudwatch_event_target.odds_pre_game`, 5× `aws_lambda_permission.allow_eventbridge_odds` to be created (if not already in state).
4. **Apply:** `terraform -chdir=infra apply -var-file=terraform.tfvars`
5. **Verify:** AWS Console → EventBridge → Rules; look for `odds-pre-game-snapshot-schedule-0` … `-4`, or `terraform -chdir=infra output odds_schedule_rule_names`.

## Outputs

After apply:

- **lambda_function_name** / **lambda_function_arn** – nightly-bdl-updater.
- **schedule_rule_name** / **schedule_rule_arn** – Set when `enable_schedule` is true.
- **odds_lambda_function_name** / **odds_lambda_function_arn** – odds-pre-game-snapshot.
- **odds_schedule_rule_name** / **odds_schedule_rule_arn** – Set when `odds_enable_schedule` is true.
- **boxscore_lambda_function_name** / **boxscore_lambda_function_arn** – boxscore-scraper.
- **boxscore_schedule_rule_name** / **boxscore_schedule_rule_arn** – Set when `boxscore_enable_schedule` is true.
- **nightly_bdl_errors_alarm_name** / **odds_pre_game_errors_alarm_name** / **boxscore_scraper_errors_alarm_name** – AWS/Lambda Errors alarms.

## Player props fanout pipeline

Player props now run as **controller + per-game workers**:

- Controller Lambda (`player_props_controller_function_name`) discovers today’s games and pushes one SQS message per game.
- Worker Lambda (`player_props_lambda_function_name`) consumes one game message at a time and performs bulk writes to:
  - `raw.player_prop_snapshots_v2`
  - `analytics.player_props_current`
  - `analytics.player_prop_current` (preferred vendor view)
- Per-game status is tracked in `raw.player_prop_game_runs`.

### Setup

1. **Build before apply:** `cd lambda/player-props-snapshot && npm install && npm run build`
2. **Enable schedule** in `terraform.tfvars`:
   - `player_props_enable_schedule = true`
   - Use `player_props_schedule_crons` or `player_props_schedule_expression`.
3. **Set worker env** via `player_props_lambda_env`:
   - required: `SUPABASE_DB_URL`, `BALLDONTLIE_API_KEY`
   - optional: `PREFERRED_VENDOR`
4. **Optional controller env overrides** via `player_props_controller_env`.

### Rollout (recommended)

1. Apply schema migration for `raw.player_prop_game_runs`.
2. `terraform plan/apply` to provision controller, worker, queue, DLQ, and alarms.
3. Invoke controller once manually and verify:
   - SQS receives one message per game.
   - Worker drains queue.
   - `raw.player_prop_game_runs` transitions `started -> success/error`.
   - `analytics.player_props_current` has rows for active game IDs.
4. Observe CloudWatch alarms:
   - `nba-player-props-worker-failures`
   - `nba-player-props-controller-low-coverage`
   - `nba-nightly-bdl-updater-errors` / `nba-odds-pre-game-snapshot-errors` / `nba-boxscore-scraper-errors` (`AWS/Lambda` Errors)
5. Keep old schedule disabled after fanout has stable coverage for at least one slate.

### Closing pull (CLV)

`aws_scheduler_schedule.player_props_closing` invokes the controller with `{ "universe": "closing" }` every 5 minutes
(08:00–23:55 America/New_York). It targets games tipping in [now+10m, now+15m), so each game is collected once at T−10.
It shares `local.player_props_schedule_state`: with `player_props_execution_enabled = true` it is created **ENABLED**.

Order:

1. Apply `db/schemas/MIGRATION_player_prop_closing_universe.sql` first. Without it the `raw.player_prop_game_runs`
   universe check rejects `closing` and the closing wave fails to claim.
2. Apply `db/schemas/MIGRATION_prop_first_seen_lines.sql` (first-seen lines next to `research.prop_decision_lines`).
   The prune-props cron materializes it under the same gate as closing lines and refuses raw prune while keys are pending.
3. Build from the main checkout (a worktree with a linked `node_modules` changes path comments in the bundle):
   `npm run build:ingestion-lambdas`. Only the controller bundle should differ from the deployed one.
4. Targeted plan, then apply after review:
   `-target=aws_lambda_function.player_props_controller -target=aws_lambda_function.player_props_worker -target=aws_scheduler_schedule.player_props_closing`

Budget: 15 games × 6 collections × 3 pages = 270 planned requests against the 300/day attempt cap.

## Context prospective shadow (minutes and points collector)

`infra/context-prospective-shadow.tf`. Two separate approvals, per
`lib/context-projection/artifacts/context-projection-prospective-activation-runbook.md`.

1. **Build:** `npm run build:context-prospective-shadow-lambda`. The package carries `dist/index.js` and the two frozen
   model artifacts under `lib/context-projection/artifacts/` (the collector reads them from the package root).
2. **Created, frozen:** `context_prospective_create = true`, `context_prospective_enable_schedule = true`,
   `context_prospective_execution_enabled = false`, and `context_prospective_lambda_env` with `SUPABASE_DB_URL` and
   writes `"0"`. The EventBridge rule is created DISABLED. Invoke `{ "action": "status" }` once to check it.
3. **Activation:** `context_prospective_execution_enabled = true` and, in `context_prospective_lambda_env`,
   `CONTEXT_MIN_SHADOW_WRITES = "1"` (and `CONTEXT_PTS_SHADOW_WRITES = "1"` for the points arm), `DATA_MODE = "live_api"`,
   `OFFSEASON_MODE = "0"`, `CRON_DRY_RUN = "0"`, `CONTEXT_PROSPECTIVE_WINDOW_OPENED_AT = "2026-09-18T16:05:48Z"`.
   The rule stays DISABLED unless `live_ingestion_enabled` is also true.

Do not change model coefficients, window IDs or the snapshot policy without versioning the experiment.

## Boxscore scraper

1. **Build before apply:** `cd lambda/boxscore-scraper && npm install && npm run build`
2. Set `boxscore_lambda_env` (`SUPABASE_DB_URL`; freeze flags `DATA_MODE` / `OFFSEASON_MODE` / `CRON_DRY_RUN`).
3. Optional schedule: `boxscore_enable_schedule = true` and `boxscore_schedule_cron = "cron(0 8 * * ? *)"` (03:00 ET).
4. **Do not full-apply** while `player_props_enable_schedule = true` in live tfvars if those Scheduler rules must stay DISABLED. Use `-target` for boxscore + error alarms.

## Scoreboard collector (display-only, prepared)

`infra/scoreboard.tf`. Everything defaults off; each step below is a separate approval.

1. **Prerequisite:** `db/schemas/MIGRATION_display_scoreboard.sql` applied (the Lambda writes `display.*`).
2. **Build before apply:** `npm run build:scoreboard-lambda` writes `lambda/scoreboard/.package`.
3. **Created, frozen:** `scoreboard_create = true` with `scoreboard_execution_enabled = false` and `scoreboard_enable_schedule = false`. Creates the Lambda, IAM (shared limiter table plus the `acq_scoreboard_games` and `acq_box_scores_live` S3 prefixes only), the log group and alarms. The Lambda env stays replay / dry run with no season type collected.
4. **Activation:** `scoreboard_enable_schedule = true`, `scoreboard_execution_enabled = true` and `live_ingestion_enabled = true`. Every other family keeps its own `*_execution_enabled = false`, so their schedules stay DISABLED. Review the plan for that: only scoreboard resources may change. Exception to check: if `postgame_create = true`, the postgame worker env reads `live_ingestion_enabled` directly (its queue mapping stays family-gated). Only preseason is collected; regular season, play-in and playoffs are pinned off in Terraform and refused in code.
5. **Serving** is separate: `SCOREBOARD_SERVING_ENABLED=1` in the web app env. Until then `/api/scoreboard` returns 503.

Tests build Lambda packages into a temp dir (`--out-root`), never into `lambda/*/.package`. Before any plan, confirm the `.package` hashes are the ones you reviewed.

## Remote state

Production state is the S3 object `nba-analytics/infra.tfstate` in `court-context-tfstate-260029269390` (`us-east-1`). `backend.tf` selects that object. Use Terraform 1.14.6 with the committed provider lock. A fresh checkout runs `terraform init` with no migration flag and uses workspace `default`. Do not run `terraform init -migrate-state` again, and do not apply from a local `terraform.tfstate`.

On 2026-11-09 the local snapshot was copied to that key. The source lineage was `d0fb6df2-0cfa-f38b-1196-11aebecebde6`, serial 403. Terraform 1.14.6 saved the copy into an empty backend by writing a new snapshot: lineage `63c7f4c1-2282-61d1-36ec-1126ab6d36ef`, serial 1, S3 version `K5AHpeg1Ieu3I8wNB4UtmfM4MkjEIrdN`. The resource data was unchanged: 134 resource blocks, 150 instances, and 41 outputs. A full read-only plan then exited 0 with no changes. That S3 snapshot is the accepted baseline. The serial-403 file is a historical backup only. Never use it as a second active state.

The bucket itself is a separate local-state root. Read [bootstrap/README.md](bootstrap/README.md) before touching it. Do not apply that root from an empty checkout.

## Extending to more Lambdas

1. Add a new `archive_file` data source pointing at `../lambda/<name>`.
2. Add a new `aws_lambda_function` (and optionally a dedicated IAM role).
3. Optionally add an `aws_cloudwatch_event_rule` + target + `aws_lambda_permission` per schedule.
4. Add an `AWS/Lambda` Errors alarm in `monitoring.tf` unless the function already emits custom metrics.
