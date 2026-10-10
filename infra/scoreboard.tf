# Display-only live scoreboard collector (lib/scoreboard). PREPARED, NOT APPLIED.
# Creation (scoreboard_create) is independent of activation.
# Baseline: create=false → no AWS resources.
# Created but frozen: create=true, scoreboard_execution_enabled=false → Lambda/IAM/alarm exist,
#   the Lambda env is frozen (replay, dry run, no season type collected) and no schedule runs.
# Activation needs live_ingestion_enabled AND scoreboard_execution_enabled. That pair turns on
#   only this family: every other family keeps its own *_execution_enabled gate.
# Preseason is the only season type Terraform can switch on; regular, play-in and playoffs are
#   pinned to "0" in the last merge and also refused in code (ACTIVATABLE_SCOREBOARD_SEASON_TYPES).
# Writes: display.* (Postgres), raw.acquisition_requests (ledger) and two S3 archive prefixes.
#
# Package before apply when create=true:
#   npm run build:scoreboard-lambda

variable "scoreboard_lambda_function_name" {
  description = "Name of the display-only scoreboard collector Lambda."
  type        = string
  default     = "scoreboard-collector"
}

variable "scoreboard_lambda_timeout" {
  description = "Seconds. One tick makes at most 3 /v1/games pages plus 1 live box request under the shared limiter; below the 1-minute schedule so ticks do not overlap."
  type        = number
  default     = 55
}

variable "scoreboard_lambda_memory_size" {
  description = "Scoreboard memory size in MB. Lightweight HTTP + display upserts."
  type        = number
  default     = 256
}

variable "scoreboard_enable_schedule" {
  description = "When true and scoreboard_create is true, create the Scheduler rule. State still requires live_ingestion_enabled AND scoreboard_execution_enabled."
  type        = bool
  default     = false
}

variable "scoreboard_schedule_expression" {
  description = "Tick cadence. Each tick decides from stored state whether to call BDL: 60 s for changing live games, backing off when quiet, and only 3-hourly discovery when no game is near."
  type        = string
  default     = "rate(1 minute)"
}

variable "scoreboard_lambda_env" {
  description = "Optional extra env. Freeze defaults merge first and the family-gated values merge last, so this map cannot thaw the Lambda or enable a season type."
  type        = map(string)
  default     = {}
  sensitive   = true
}

locals {
  scoreboard_raw_prefix = trim(var.nba_raw_prefix, "/")
  # season=2026 must change together with SCOREBOARD_TARGET_SEASON at season rollover.
  scoreboard_archive_prefixes = [
    "${local.scoreboard_raw_prefix}/source=balldontlie/league=nba/season=2026/entity=acq_scoreboard_games",
    "${local.scoreboard_raw_prefix}/source=balldontlie/league=nba/season=2026/entity=acq_box_scores_live",
  ]
  scoreboard_schedule_name  = "nba-scoreboard-schedule"
  scoreboard_schedule_group = "default"
}

# Same-account Scheduler invocation uses the execution role below. A Lambda resource policy is
# not required, and an unscoped scheduler.amazonaws.com permission would let any schedule in
# the account invoke this function. See AWS Lambda "Invoke a Lambda function on a schedule".
data "aws_caller_identity" "scoreboard" {
  count = var.scoreboard_create && var.scoreboard_enable_schedule ? 1 : 0
}

data "archive_file" "scoreboard" {
  count       = var.scoreboard_create ? 1 : 0
  type        = "zip"
  source_dir  = "${path.module}/../lambda/scoreboard/.package"
  output_path = "${path.module}/scoreboard.zip"
}

resource "aws_iam_role" "lambda_scoreboard_execution" {
  count = var.scoreboard_create ? 1 : 0
  name  = "${var.scoreboard_lambda_function_name}-execution-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_scoreboard_basic_execution" {
  count      = var.scoreboard_create ? 1 : 0
  role       = aws_iam_role.lambda_scoreboard_execution[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "scoreboard_bdl_rate_limit" {
  count  = var.scoreboard_create ? 1 : 0
  name   = "${var.scoreboard_lambda_function_name}-bdl-rate-limit"
  role   = aws_iam_role.lambda_scoreboard_execution[0].id
  policy = jsonencode(local.bdl_rate_limit_iam)
}

# Archive-before-write (lib/acquisition/s3-store.ts): conditional PutObject then HeadObject readback.
# Only the two scoreboard entity prefixes; no other S3 path.
resource "aws_iam_role_policy" "scoreboard_s3_archive" {
  count = var.scoreboard_create && var.nba_data_bucket_name != "" ? 1 : 0
  name  = "${var.scoreboard_lambda_function_name}-s3-archive"
  role  = aws_iam_role.lambda_scoreboard_execution[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ScoreboardAcquisitionArchiveObjects"
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject"
        ]
        Resource = [for p in local.scoreboard_archive_prefixes : "arn:aws:s3:::${var.nba_data_bucket_name}/${p}/*"]
      }
    ]
  })
}

resource "aws_lambda_function" "scoreboard" {
  count            = var.scoreboard_create ? 1 : 0
  filename         = data.archive_file.scoreboard[0].output_path
  function_name    = var.scoreboard_lambda_function_name
  role             = aws_iam_role.lambda_scoreboard_execution[0].arn
  handler          = "dist/index.handler"
  runtime          = "nodejs22.x"
  architectures    = ["x86_64"]
  timeout          = var.scoreboard_lambda_timeout
  memory_size      = var.scoreboard_lambda_memory_size
  source_code_hash = var.scoreboard_create ? filebase64sha256("${path.module}/../lambda/scoreboard/.package/dist/index.js") : null

  environment {
    variables = merge(
      local.ingestion_freeze_defaults,
      local.bdl_rate_limit_env,
      {
        SUPABASE_DB_URL     = lookup(var.lambda_env, "SUPABASE_DB_URL", "")
        BALLDONTLIE_API_KEY = lookup(var.lambda_env, "BALLDONTLIE_API_KEY", lookup(var.lambda_env, "BALDONTLIE_API_KEY", ""))
      },
      var.scoreboard_lambda_env,
      {
        # Last-merge wins. Only the scoreboard family flag can thaw this Lambda.
        LIVE_INGESTION_ENABLED            = local.family_schedule_enabled.scoreboard ? "1" : "0"
        DATA_MODE                         = local.family_schedule_enabled.scoreboard ? "live_api" : "replay"
        OFFSEASON_MODE                    = local.family_schedule_enabled.scoreboard ? "0" : "1"
        CRON_DRY_RUN                      = local.family_schedule_enabled.scoreboard ? "0" : "1"
        SCOREBOARD_COLLECT_PRESEASON      = local.family_schedule_enabled.scoreboard ? "1" : "0"
        SCOREBOARD_COLLECT_REGULAR        = "0"
        SCOREBOARD_COLLECT_PLAYIN         = "0"
        SCOREBOARD_COLLECT_PLAYOFFS       = "0"
        SCOREBOARD_TARGET_SEASON          = "2026"
        NBA_DATA_BUCKET                   = var.nba_data_bucket_name
        NBA_RAW_PREFIX                    = local.scoreboard_raw_prefix
        BDL_RATE_LIMIT_TABLE              = aws_dynamodb_table.bdl_rate_limit.name
        BDL_RATE_LIMIT_BACKEND            = "dynamodb"
        BDL_RATE_LIMIT_WORKER             = "scoreboard-collector"
        BDL_RATE_LIMIT_ACQUIRE_TIMEOUT_MS = "20000"
        BDL_RATE_LIMIT_MAX_RETRIES        = "0"
      }
    )
  }
}

# Each retry would be a fresh archived BDL request and the next 1-minute tick already retries.
resource "aws_lambda_function_event_invoke_config" "scoreboard" {
  count                        = var.scoreboard_create ? 1 : 0
  function_name                = aws_lambda_function.scoreboard[0].function_name
  maximum_retry_attempts       = 0
  maximum_event_age_in_seconds = 60
}

resource "aws_iam_role" "scheduler_scoreboard_invoke" {
  count = var.scoreboard_create && var.scoreboard_enable_schedule ? 1 : 0
  name  = "nba-scoreboard-schedule-invoke-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "scheduler.amazonaws.com"
        }
        Action = "sts:AssumeRole"
        # Confused-deputy limit. Scheduler passes the schedule group as aws:SourceArn,
        # not the individual schedule ARN.
        Condition = {
          StringEquals = {
            "aws:SourceAccount" = data.aws_caller_identity.scoreboard[0].account_id
            "aws:SourceArn"     = "arn:aws:scheduler:${var.aws_region}:${data.aws_caller_identity.scoreboard[0].account_id}:schedule-group/${local.scoreboard_schedule_group}"
          }
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "scheduler_scoreboard_invoke_lambda" {
  count = var.scoreboard_create && var.scoreboard_enable_schedule ? 1 : 0
  name  = "invoke-scoreboard-lambda"
  role  = aws_iam_role.scheduler_scoreboard_invoke[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["lambda:InvokeFunction"]
        Resource = aws_lambda_function.scoreboard[0].arn
      }
    ]
  })
}

resource "aws_scheduler_schedule" "scoreboard" {
  count       = var.scoreboard_create && var.scoreboard_enable_schedule ? 1 : 0
  name        = local.scoreboard_schedule_name
  group_name  = local.scoreboard_schedule_group
  description = "Display-only scoreboard tick. Disabled unless live_ingestion_enabled AND scoreboard_execution_enabled."
  state       = local.scoreboard_schedule_state

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression = var.scoreboard_schedule_expression

  target {
    arn      = aws_lambda_function.scoreboard[0].arn
    role_arn = aws_iam_role.scheduler_scoreboard_invoke[0].arn
    input    = "{}"

    # Distinct from the Lambda async invoke config. The provider default is 185 retries over
    # 24 hours; each retry would be another archived provider call. The next minute already retries.
    retry_policy {
      maximum_event_age_in_seconds = 60
      maximum_retry_attempts       = 0
    }
  }
}

# Follows creation. Quiet while frozen (notBreaching).
resource "aws_cloudwatch_metric_alarm" "scoreboard_errors" {
  count               = var.scoreboard_create ? 1 : 0
  alarm_name          = "nba-scoreboard-errors"
  alarm_description   = "Alerts when the scoreboard collector reports any invocation errors."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.ingestion_alarm_actions

  dimensions = {
    FunctionName = aws_lambda_function.scoreboard[0].function_name
  }
}

# A new function has no log group until its first invocation, and a metric filter on a missing
# group fails to create, so the group is managed here.
resource "aws_cloudwatch_log_group" "scoreboard" {
  count             = var.scoreboard_create ? 1 : 0
  name              = "/aws/lambda/${var.scoreboard_lambda_function_name}"
  retention_in_days = 14
}

# Handled failures (blocked archive, failed page) return a result without raising.
resource "aws_cloudwatch_log_metric_filter" "scoreboard_run_failed" {
  count          = var.scoreboard_create ? 1 : 0
  name           = "court-context-scoreboard-run-failed"
  log_group_name = aws_cloudwatch_log_group.scoreboard[0].name
  pattern        = "{ $.event = \"scoreboard_cycle\" && $.status = \"failed\" }"

  metric_transformation {
    name      = "RunFailed-scoreboard"
    namespace = local.ingestion_metric_ns
    value     = "1"
  }
}

# One failed tick is retried a minute later; alert on failures in 2 of 3 consecutive 5-minute
# windows. Exists only while the family is live, so manual frozen invocations cannot page.
resource "aws_cloudwatch_metric_alarm" "scoreboard_run_failed" {
  count               = var.scoreboard_create && var.scoreboard_enable_schedule && local.family_schedule_enabled.scoreboard ? 1 : 0
  alarm_name          = "court-context-scoreboard-run-failed"
  alarm_description   = "The scoreboard collector logged handled failures in 2 of 3 consecutive 5-minute windows. The website shows stored scores as stale."
  namespace           = local.ingestion_metric_ns
  metric_name         = "RunFailed-scoreboard"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 3
  datapoints_to_alarm = 2
  threshold           = 2
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.ingestion_alarm_actions

  depends_on = [aws_cloudwatch_log_metric_filter.scoreboard_run_failed]
}

output "scoreboard_function_name" {
  description = "Scoreboard collector Lambda name when scoreboard_create is true."
  value       = var.scoreboard_create ? aws_lambda_function.scoreboard[0].function_name : null
}

output "scoreboard_schedule_name" {
  description = "Scoreboard Scheduler name when create and enable_schedule are true."
  value       = var.scoreboard_create && var.scoreboard_enable_schedule ? aws_scheduler_schedule.scoreboard[0].name : null
}
