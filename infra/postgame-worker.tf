# 13F.3 postgame stage worker. Parked unless postgame_create=true.
# ESM enabled only when live_ingestion_enabled AND postgame_execution_enabled.
# Reserved concurrency is intentionally unset (account quota 10).

variable "postgame_worker_lambda_function_name" {
  description = "Name of the postgame stage worker Lambda. CODE_ONLY; do not deploy in 13F.3."
  type        = string
  default     = "postgame-stage-worker"
}

variable "postgame_worker_lambda_timeout" {
  description = "Postgame worker timeout seconds. Sized above one 13s limiter wait plus fetch, not publication delay."
  type        = number
  default     = 120
}

variable "postgame_worker_lambda_memory_size" {
  description = "Postgame worker memory size in MB."
  type        = number
  default     = 512
}

variable "postgame_worker_lambda_env" {
  description = "Optional extra env for the postgame worker. Do not commit secrets. Freeze defaults always merge."
  type        = map(string)
  default     = {}
  sensitive   = true
}

data "archive_file" "postgame_stage_worker" {
  count       = var.postgame_create ? 1 : 0
  type        = "zip"
  source_dir  = "${path.module}/../lambda/postgame-stage-worker"
  output_path = "${path.module}/postgame-stage-worker.zip"
}

resource "aws_iam_role" "lambda_postgame_stage_execution" {
  count = var.postgame_create ? 1 : 0
  name  = "${var.postgame_worker_lambda_function_name}-execution-role"

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

resource "aws_iam_role_policy_attachment" "lambda_postgame_basic_execution" {
  count      = var.postgame_create ? 1 : 0
  role       = aws_iam_role.lambda_postgame_stage_execution[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_postgame_worker_sqs" {
  count = var.postgame_create ? 1 : 0
  name  = "postgame-stage-worker-sqs-access"
  role  = aws_iam_role.lambda_postgame_stage_execution[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:ChangeMessageVisibility",
          "sqs:GetQueueAttributes"
        ]
        Resource = aws_sqs_queue.postgame_stage_queue[0].arn
      }
    ]
  })
}

resource "aws_iam_role_policy" "postgame_worker_bdl_rate_limit" {
  count  = var.postgame_create ? 1 : 0
  name   = "${var.postgame_worker_lambda_function_name}-bdl-rate-limit"
  role   = aws_iam_role.lambda_postgame_stage_execution[0].id
  policy = jsonencode(local.bdl_rate_limit_iam)
}

resource "aws_lambda_function" "postgame_stage_worker" {
  count            = var.postgame_create ? 1 : 0
  filename         = data.archive_file.postgame_stage_worker[0].output_path
  function_name    = var.postgame_worker_lambda_function_name
  role             = aws_iam_role.lambda_postgame_stage_execution[0].arn
  handler          = "dist/index.handler"
  runtime          = "nodejs22.x"
  timeout          = var.postgame_worker_lambda_timeout
  memory_size      = var.postgame_worker_lambda_memory_size
  source_code_hash = data.archive_file.postgame_stage_worker[0].output_base64sha256
  # Account concurrency quota is 10; do not set reserved concurrency on this function.

  environment {
    variables = merge(
      local.ingestion_freeze_defaults,
      local.bdl_rate_limit_env,
      var.postgame_worker_lambda_env,
      {
        LIVE_INGESTION_ENABLED     = var.live_ingestion_enabled ? "1" : "0"
        BDL_GOAT_SUBSCRIPTION      = "0"
        POSTGAME_BOX_REQUIRES_GOAT = "0"
        POSTGAME_TARGET_SEASON     = "2026"
        BDL_RATE_LIMIT_TABLE       = aws_dynamodb_table.bdl_rate_limit.name
        BDL_RATE_LIMIT_BACKEND     = "dynamodb"
        BDL_RATE_LIMIT_WORKER      = "postgame-stage-worker"
      }
    )
  }
}

resource "aws_lambda_event_source_mapping" "postgame_stage_worker_queue" {
  count                              = var.postgame_create ? 1 : 0
  event_source_arn                   = aws_sqs_queue.postgame_stage_queue[0].arn
  function_name                      = aws_lambda_function.postgame_stage_worker[0].arn
  batch_size                         = 1
  maximum_batching_window_in_seconds = 0
  enabled                            = local.family_schedule_enabled.postgame
  function_response_types            = ["ReportBatchItemFailures"]
}
