# Terraform – AWS Lambdas (ingestion jobs)

Terraform setup to manage the **nightly-bdl-updater**, **odds-pre-game-snapshot**, **injuries-snapshot**, **player-props** (controller + worker), and **boxscore-scraper** Lambdas and their optional schedules.

## Prerequisites

- **AWS CLI** configured (credentials and region).
- **Terraform** installed (>= 1.0).
- **Node.js 22** for building the Lambdas.

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

## Boxscore scraper

1. **Build before apply:** `cd lambda/boxscore-scraper && npm install && npm run build`
2. Set `boxscore_lambda_env` (`SUPABASE_DB_URL`; freeze flags `DATA_MODE` / `OFFSEASON_MODE` / `CRON_DRY_RUN`).
3. Optional schedule: `boxscore_enable_schedule = true` and `boxscore_schedule_cron = "cron(0 8 * * ? *)"` (03:00 ET).
4. **Do not full-apply** while `player_props_enable_schedule = true` in live tfvars if those Scheduler rules must stay DISABLED. Use `-target` for boxscore + error alarms.

## Remote state (deferred)

State is still local (`infra/`). Moving to an S3 backend is not required to deploy boxscore; do it before a second environment or shared laptop.

## Extending to more Lambdas

1. Add a new `archive_file` data source pointing at `../lambda/<name>`.
2. Add a new `aws_lambda_function` (and optionally a dedicated IAM role).
3. Optionally add an `aws_cloudwatch_event_rule` + target + `aws_lambda_permission` per schedule.
4. Add an `AWS/Lambda` Errors alarm in `monitoring.tf` unless the function already emits custom metrics.
