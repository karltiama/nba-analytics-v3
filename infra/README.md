# Terraform – AWS Lambdas (nightly-bdl-updater, odds-pre-game-snapshot)

Terraform setup to manage the **nightly-bdl-updater** and **odds-pre-game-snapshot** Lambdas and their optional EventBridge schedules.

## Prerequisites

- **AWS CLI** configured (credentials and region).
- **Terraform** installed (>= 1.0).
- **Node.js 20** for building the Lambdas.

## Build the Lambdas before apply

Terraform packages each Lambda from the existing source tree. You must build both before apply:

```bash
cd lambda/nightly-bdl-updater
npm install
npm run build
cd ../odds-pre-game-snapshot
npm install
npm run build
cd ../..
```

If you skip this step, the zips may be missing or outdated and the deployed functions may fail. Apply will package and deploy both Lambdas.

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

**odds-pre-game-snapshot:** **odds_lambda_function_name**, **odds_lambda_timeout**, **odds_lambda_memory_size**, **odds_lambda_env** (sensitive), **odds_enable_schedule**, **odds_schedule_cron**. Set odds env (e.g. `SUPABASE_DB_URL`, `BALLDONTLIE_API_KEY`, optional `PREFERRED_VENDOR`) in tfvars; don’t commit secrets.

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

## Extending to more Lambdas

To add **boxscore**, **player-props**, or **injuries** Lambdas:

1. Add a new `archive_file` data source pointing at `../lambda/<name>`.
2. Add a new `aws_lambda_function` (and optionally a dedicated IAM role or reuse with a broader policy).
3. Optionally add an `aws_cloudwatch_event_rule` + target + `aws_lambda_permission` per schedule.

Use the same pattern: build in the Lambda dir, then `terraform apply`. Consider moving to a remote backend (e.g. S3) for shared state before managing multiple environments.
