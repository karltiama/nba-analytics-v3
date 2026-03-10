# Terraform – AWS Lambda (nightly-bdl-updater)

Minimal Terraform setup to manage the **nightly-bdl-updater** Lambda and optional EventBridge schedule.

## Prerequisites

- **AWS CLI** configured (credentials and region).
- **Terraform** installed (>= 1.0).
- **Node.js 20** for building the Lambda (in `lambda/nightly-bdl-updater`).

## Build the Lambda before apply

Terraform packages the Lambda from the existing source tree. You must build it first:

```bash
cd lambda/nightly-bdl-updater
npm install
npm run build
cd ../..
```

If you skip this step, the zip may be missing or outdated and the deployed function may fail.

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

- **aws_region** – Region for all resources (default: `us-east-1`).
- **lambda_function_name** – Lambda name (default: `nightly-bdl-updater`).
- **lambda_timeout** / **lambda_memory_size** – Function config.
- **lambda_env** – Map of environment variables (e.g. `SUPABASE_DB_URL`, `BALLDONTLIE_API_KEY`). Set in tfvars or via env; don’t commit secrets.
- **enable_schedule** – Set to `true` to create the EventBridge rule (default: `false`).
- **schedule_cron** – Cron expression in UTC (default: daily at 08:00 UTC).

## Optional: enable EventBridge schedule

Set in your tfvars:

```hcl
enable_schedule = true
schedule_cron   = "cron(0 8 * * ? *)"
```

Then run `terraform apply` again. The rule will invoke the Lambda on the given schedule.

## Outputs

After apply:

- **lambda_function_name** – Deployed function name.
- **lambda_function_arn** – Function ARN.
- **schedule_rule_name** / **schedule_rule_arn** – Set when `enable_schedule` is true.

## Extending to more Lambdas

To add **odds**, **boxscore**, **player-props**, or **injuries** Lambdas:

1. Add a new `archive_file` data source pointing at `../lambda/<name>`.
2. Add a new `aws_lambda_function` (and optionally a dedicated IAM role or reuse with a broader policy).
3. Optionally add an `aws_cloudwatch_event_rule` + target + `aws_lambda_permission` per schedule.

Use the same pattern: build in the Lambda dir, then `terraform apply`. Consider moving to a remote backend (e.g. S3) for shared state before managing multiple environments.
