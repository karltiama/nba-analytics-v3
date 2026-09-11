# Frequent /v1/games status sync.
# Creation (game_status_sync_create) is independent of activation.
# Baseline frozen plan: create=false → no AWS resources.
# Authorized deploy while frozen: create=true, live_ingestion_enabled=false,
# game_status_sync_execution_enabled=false → Lambda/IAM/alarm exist, no execution.
# Schedule create remains Option B: game_status_sync_enable_schedule (default false).
#
# Package before apply when create=true:
#   npm run build:game-status-sync-lambda

variable "game_status_sync_lambda_function_name" {
  description = "Name of the frequent game-status Lambda. Must match ops catalog default game-status-sync."
  type        = string
  default     = "game-status-sync"
}

variable "game_status_sync_lambda_timeout" {
  description = "Status-sync timeout seconds. Sized for max 3 /v1/games pages under the 13s limiter plus acquire wait, not the 300s nightly budget."
  type        = number
  default     = 90
}

variable "game_status_sync_lambda_memory_size" {
  description = "Status-sync memory size in MB. Lightweight HTTP + row updates."
  type        = number
  default     = 256
}

variable "game_status_sync_enable_schedule" {
  description = "When true and game_status_sync_create is true, create the EventBridge Scheduler rule. State still requires live_ingestion_enabled AND game_status_sync_execution_enabled."
  type        = bool
  default     = false
}

variable "game_status_sync_schedule_expression" {
  description = "Future activation cadence. Default rate(15 minutes) for 10–15 minute Final detection."
  type        = string
  default     = "rate(15 minutes)"
}

variable "game_status_sync_lambda_env" {
  description = "Optional extra env. Set SUPABASE_DB_URL and BALLDONTLIE_API_KEY via tfvars (do not commit). Freeze defaults always merge."
  type        = map(string)
  default     = {}
  sensitive   = true
}

data "archive_file" "game_status_sync" {
  count       = var.game_status_sync_create ? 1 : 0
  type        = "zip"
  source_dir  = "${path.module}/../lambda/game-status-sync/.package"
  output_path = "${path.module}/game-status-sync.zip"
}

resource "aws_iam_role" "lambda_game_status_sync_execution" {
  count = var.game_status_sync_create ? 1 : 0
  name  = "${var.game_status_sync_lambda_function_name}-execution-role"

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

resource "aws_iam_role_policy_attachment" "lambda_game_status_sync_basic_execution" {
  count      = var.game_status_sync_create ? 1 : 0
  role       = aws_iam_role.lambda_game_status_sync_execution[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "game_status_sync_bdl_rate_limit" {
  count  = var.game_status_sync_create ? 1 : 0
  name   = "${var.game_status_sync_lambda_function_name}-bdl-rate-limit"
  role   = aws_iam_role.lambda_game_status_sync_execution[0].id
  policy = jsonencode(local.bdl_rate_limit_iam)
}

resource "aws_lambda_function" "game_status_sync" {
  count            = var.game_status_sync_create ? 1 : 0
  filename         = data.archive_file.game_status_sync[0].output_path
  function_name    = var.game_status_sync_lambda_function_name
  role             = aws_iam_role.lambda_game_status_sync_execution[0].arn
  handler          = "dist/index.handler"
  runtime          = "nodejs22.x"
  architectures    = ["x86_64"]
  timeout          = var.game_status_sync_lambda_timeout
  memory_size      = var.game_status_sync_lambda_memory_size
  source_code_hash = var.game_status_sync_create ? filebase64sha256("${path.module}/../lambda/game-status-sync/.package/dist/index.js") : null

  environment {
    variables = merge(
      local.ingestion_freeze_defaults,
      local.bdl_rate_limit_env,
      {
        SUPABASE_DB_URL     = lookup(var.lambda_env, "SUPABASE_DB_URL", "")
        BALLDONTLIE_API_KEY = lookup(var.lambda_env, "BALLDONTLIE_API_KEY", lookup(var.lambda_env, "BALDONTLIE_API_KEY", ""))
      },
      var.game_status_sync_lambda_env,
      {
        # Last-merge wins. Live runtime is family-gated so a global live thaw
        # cannot make this Lambda live unless game_status_sync_execution_enabled.
        LIVE_INGESTION_ENABLED            = local.family_schedule_enabled.game_status_sync ? "1" : "0"
        DATA_MODE                         = local.family_schedule_enabled.game_status_sync ? "live_api" : "replay"
        OFFSEASON_MODE                    = local.family_schedule_enabled.game_status_sync ? "0" : "1"
        CRON_DRY_RUN                      = local.family_schedule_enabled.game_status_sync ? "0" : "1"
        STATUS_SYNC_TARGET_SEASON         = "2026"
        BDL_RATE_LIMIT_TABLE              = aws_dynamodb_table.bdl_rate_limit.name
        BDL_RATE_LIMIT_BACKEND            = "dynamodb"
        BDL_RATE_LIMIT_WORKER             = "game-status-sync"
        BDL_RATE_LIMIT_ACQUIRE_TIMEOUT_MS = "20000"
        BDL_RATE_LIMIT_MAX_RETRIES        = "0"
      }
    )
  }
}

resource "aws_iam_role" "scheduler_game_status_sync_invoke" {
  count = var.game_status_sync_create && var.game_status_sync_enable_schedule ? 1 : 0
  name  = "nba-game-status-sync-schedule-invoke-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "scheduler.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy" "scheduler_game_status_sync_invoke_lambda" {
  count = var.game_status_sync_create && var.game_status_sync_enable_schedule ? 1 : 0
  name  = "invoke-game-status-sync-lambda"
  role  = aws_iam_role.scheduler_game_status_sync_invoke[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["lambda:InvokeFunction"]
        Resource = aws_lambda_function.game_status_sync[0].arn
      }
    ]
  })
}

resource "aws_scheduler_schedule" "game_status_sync" {
  count       = var.game_status_sync_create && var.game_status_sync_enable_schedule ? 1 : 0
  name        = "nba-game-status-sync-schedule"
  group_name  = "default"
  description = "Frequent /v1/games status sync (15 min). Disabled unless live_ingestion_enabled AND game_status_sync_execution_enabled."
  state       = local.game_status_sync_schedule_state

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression = var.game_status_sync_schedule_expression

  target {
    arn      = aws_lambda_function.game_status_sync[0].arn
    role_arn = aws_iam_role.scheduler_game_status_sync_invoke[0].arn
    # Recurring production payload. Must never be the manual-canary confirm JSON.
    input = "{}"
  }
}

resource "aws_lambda_permission" "allow_scheduler_game_status_sync" {
  count         = var.game_status_sync_create && var.game_status_sync_enable_schedule ? 1 : 0
  statement_id  = "allow-eventbridge-scheduler-invoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.game_status_sync[0].function_name
  principal     = "scheduler.amazonaws.com"
}

output "game_status_sync_function_name" {
  description = "Frequent game-status Lambda name when game_status_sync_create is true."
  value       = var.game_status_sync_create ? aws_lambda_function.game_status_sync[0].function_name : null
}

output "game_status_sync_schedule_name" {
  description = "Scheduler name when create and enable_schedule are true."
  value       = var.game_status_sync_create && var.game_status_sync_enable_schedule ? aws_scheduler_schedule.game_status_sync[0].name : null
}
