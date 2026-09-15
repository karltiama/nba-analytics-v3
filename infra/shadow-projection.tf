# PTS C / REB C shadow scoring. Creation is independent of activation.
# Baseline frozen plan: shadow_create=false → no AWS resources.
# Authorized CODE_ONLY deploy: shadow_create=true, live_ingestion_enabled=false,
# shadow_execution_enabled=false → Lambda/IAM/alarm exist, schedule DISABLED.
#
# Package before apply when create=true:
#   npm run build:shadow-projection-lambda
#   npm run build:shadow-scorer-lambda

variable "shadow_lambda_function_name" {
  description = "Name of the Node shadow scoring Lambda."
  type        = string
  default     = "shadow-projection"
}

variable "shadow_scorer_lambda_function_name" {
  description = "Name of the Python CatBoost scorer Lambda."
  type        = string
  default     = "shadow-projection-scorer"
}

variable "shadow_lambda_timeout" {
  description = "Shadow orchestration timeout seconds."
  type        = number
  default     = 300
}

variable "shadow_lambda_memory_size" {
  type    = number
  default = 1024
}

variable "shadow_scorer_timeout" {
  type    = number
  default = 120
}

variable "shadow_scorer_memory_size" {
  type    = number
  default = 2048
}

variable "shadow_enable_schedule" {
  description = "When true and shadow_create is true, create the EventBridge rule. State still requires live_ingestion_enabled AND shadow_execution_enabled."
  type        = bool
  default     = false
}

variable "shadow_schedule_expression" {
  description = "T−60 poll cadence. Amendment r1.1 uses rate(5 minutes)."
  type        = string
  default     = "rate(5 minutes)"
}

variable "shadow_lambda_env" {
  description = "Optional extra env. Freeze defaults always merge last for DATA_MODE/OFFSEASON/CRON_DRY_RUN unless family is enabled."
  type        = map(string)
  default     = {}
  sensitive   = true
}

data "archive_file" "shadow_projection" {
  count       = var.shadow_create ? 1 : 0
  type        = "zip"
  source_dir  = "${path.module}/../lambda/shadow-projection/.package"
  output_path = "${path.module}/shadow-projection.zip"
}

data "archive_file" "shadow_projection_scorer" {
  count       = var.shadow_create ? 1 : 0
  type        = "zip"
  source_dir  = "${path.module}/../lambda/shadow-projection-scorer/.package"
  output_path = "${path.module}/shadow-projection-scorer.zip"
}

resource "aws_iam_role" "lambda_shadow_execution" {
  count = var.shadow_create ? 1 : 0
  name  = "${var.shadow_lambda_function_name}-execution-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "lambda.amazonaws.com" }
        Action    = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_shadow_basic_execution" {
  count      = var.shadow_create ? 1 : 0
  role       = aws_iam_role.lambda_shadow_execution[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role" "lambda_shadow_scorer_execution" {
  count = var.shadow_create ? 1 : 0
  name  = "${var.shadow_scorer_lambda_function_name}-execution-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "lambda.amazonaws.com" }
        Action    = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_shadow_scorer_basic_execution" {
  count      = var.shadow_create ? 1 : 0
  role       = aws_iam_role.lambda_shadow_scorer_execution[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "shadow_artifacts_and_invoke" {
  count = var.shadow_create ? 1 : 0
  name  = "shadow-artifacts-and-scorer-invoke"
  role  = aws_iam_role.lambda_shadow_execution[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      [
        {
          Effect   = "Allow"
          Action   = ["lambda:InvokeFunction"]
          Resource = aws_lambda_function.shadow_projection_scorer[0].arn
        }
      ],
      var.nba_data_bucket_name == "" ? [] : [
        {
          Effect = "Allow"
          Action = ["s3:GetObject"]
          Resource = [
            "arn:aws:s3:::${var.nba_data_bucket_name}/research/models/player-projection-shadow-pts-reb-c-r1/*"
          ]
        }
      ]
    )
  })
}

resource "aws_iam_role_policy" "shadow_scorer_artifacts" {
  count = var.shadow_create && var.nba_data_bucket_name != "" ? 1 : 0
  name  = "shadow-scorer-artifacts"
  role  = aws_iam_role.lambda_shadow_scorer_execution[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = ["arn:aws:s3:::${var.nba_data_bucket_name}/research/models/player-projection-shadow-pts-reb-c-r1/*"]
      }
    ]
  })
}

resource "aws_lambda_function" "shadow_projection_scorer" {
  count            = var.shadow_create ? 1 : 0
  filename         = data.archive_file.shadow_projection_scorer[0].output_path
  function_name    = var.shadow_scorer_lambda_function_name
  role             = aws_iam_role.lambda_shadow_scorer_execution[0].arn
  handler          = "handler.handler"
  runtime          = "python3.11"
  timeout          = var.shadow_scorer_timeout
  memory_size      = var.shadow_scorer_memory_size
  source_code_hash = data.archive_file.shadow_projection_scorer[0].output_base64sha256

  environment {
    variables = {
      SHADOW_BUNDLE_S3_PREFIX = "research/models/player-projection-shadow-pts-reb-c-r1"
      NBA_DATA_BUCKET         = var.nba_data_bucket_name
    }
  }
}

resource "aws_lambda_function" "shadow_projection" {
  count            = var.shadow_create ? 1 : 0
  filename         = data.archive_file.shadow_projection[0].output_path
  function_name    = var.shadow_lambda_function_name
  role             = aws_iam_role.lambda_shadow_execution[0].arn
  handler          = "dist/index.handler"
  runtime          = "nodejs22.x"
  timeout          = var.shadow_lambda_timeout
  memory_size      = var.shadow_lambda_memory_size
  source_code_hash = data.archive_file.shadow_projection[0].output_base64sha256

  environment {
    variables = merge(
      local.ingestion_freeze_defaults,
      var.shadow_lambda_env,
      {
        SUPABASE_DB_URL = lookup(var.lambda_env, "SUPABASE_DB_URL", "")
        NBA_DATA_BUCKET = var.nba_data_bucket_name
        SHADOW_SCORER_LAMBDA = aws_lambda_function.shadow_projection_scorer[0].function_name
        SHADOW_BUNDLE_S3_PREFIX = "research/models/player-projection-shadow-pts-reb-c-r1"
        SHADOW_SNAPSHOT_WRITES     = local.family_schedule_enabled.shadow ? "1" : "0"
        COLLECTION_SCHEMA_MODE     = local.family_schedule_enabled.shadow ? "required" : "optional"
        LIVE_INGESTION_ENABLED = local.family_schedule_enabled.shadow ? "1" : "0"
        DATA_MODE              = local.family_schedule_enabled.shadow ? "live_api" : "replay"
        OFFSEASON_MODE         = local.family_schedule_enabled.shadow ? "0" : "1"
        CRON_DRY_RUN           = local.family_schedule_enabled.shadow ? "0" : "1"
      }
    )
  }
}

resource "aws_cloudwatch_event_rule" "shadow_schedule" {
  count               = var.shadow_create && var.shadow_enable_schedule ? 1 : 0
  name                = "${var.shadow_lambda_function_name}-schedule"
  description         = "T−60 shadow score+settle every 5 minutes. Disabled unless live_ingestion_enabled AND shadow_execution_enabled."
  schedule_expression = var.shadow_schedule_expression
  state               = local.shadow_schedule_state
}

resource "aws_cloudwatch_event_target" "shadow_projection" {
  count     = var.shadow_create && var.shadow_enable_schedule ? 1 : 0
  rule      = aws_cloudwatch_event_rule.shadow_schedule[0].name
  target_id = "shadow-projection"
  arn       = aws_lambda_function.shadow_projection[0].arn
  input     = "{}"
}

resource "aws_lambda_permission" "allow_eventbridge_shadow" {
  count         = var.shadow_create && var.shadow_enable_schedule ? 1 : 0
  statement_id  = "allow-eventbridge-invoke-shadow"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.shadow_projection[0].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.shadow_schedule[0].arn
}

output "shadow_projection_function_name" {
  value = var.shadow_create ? aws_lambda_function.shadow_projection[0].function_name : null
}

output "shadow_scorer_function_name" {
  value = var.shadow_create ? aws_lambda_function.shadow_projection_scorer[0].function_name : null
}

output "shadow_schedule_state" {
  value = local.shadow_schedule_state
}
