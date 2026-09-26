# Prospective projection ledger.
# Default projection_ledger_create=false so a normal apply creates nothing.
# When created, the schedule state is the literal DISABLED. Do not flip it
# from tfvars. PROJECTION_LEDGER_WRITES is forced to 0 after the env merge
# so an extra map cannot turn writes on.
#
# Package, only if create is later set true:
#   npm run build:projection-ledger-lambda
# Schedule expression matches SHADOW_SCHEDULER_INTERVAL_MINUTES (5).

variable "projection_ledger_create" {
  type    = bool
  default = false
}

variable "projection_ledger_lambda_function_name" {
  type    = string
  default = "projection-ledger"
}

variable "projection_ledger_lambda_timeout" {
  type    = number
  default = 300
}

variable "projection_ledger_lambda_memory_size" {
  type    = number
  default = 1024
}

variable "projection_ledger_lambda_env" {
  type      = map(string)
  default   = {}
  sensitive = true
}

variable "projection_ledger_git_sha" {
  description = "Stamped by scripts/ops/stamp-projection-ledger-revision.ts. Empty when the worktree is dirty. Not an operator-typed SHA."
  type        = string
  default     = ""

  validation {
    condition     = var.projection_ledger_git_sha == "" || can(regex("^[0-9a-f]{40}$", var.projection_ledger_git_sha))
    error_message = "projection_ledger_git_sha must be empty or the 40-character packaged git SHA."
  }
}

data "archive_file" "projection_ledger" {
  count       = var.projection_ledger_create ? 1 : 0
  type        = "zip"
  source_dir  = "${path.module}/../lambda/projection-ledger/.package"
  output_path = "${path.module}/projection-ledger.zip"
}

resource "aws_iam_role" "lambda_projection_ledger_execution" {
  count = var.projection_ledger_create ? 1 : 0
  name  = "${var.projection_ledger_lambda_function_name}-execution-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_projection_ledger_basic" {
  count      = var.projection_ledger_create ? 1 : 0
  role       = aws_iam_role.lambda_projection_ledger_execution[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_function" "projection_ledger" {
  count            = var.projection_ledger_create ? 1 : 0
  function_name    = var.projection_ledger_lambda_function_name
  role             = aws_iam_role.lambda_projection_ledger_execution[0].arn
  handler          = "dist/index.handler"
  runtime          = "nodejs20.x"
  timeout          = var.projection_ledger_lambda_timeout
  memory_size      = var.projection_ledger_lambda_memory_size
  filename         = data.archive_file.projection_ledger[0].output_path
  source_code_hash = data.archive_file.projection_ledger[0].output_base64sha256

  environment {
    variables = merge(
      var.projection_ledger_lambda_env,
      {
        # Last merge wins. Writes stay off, and the SHA is the stamped package revision.
        PROJECTION_LEDGER_WRITES  = "0"
        PROJECTION_LEDGER_GIT_SHA = var.projection_ledger_git_sha
      }
    )
  }
}

resource "aws_cloudwatch_event_rule" "projection_ledger_schedule" {
  count               = var.projection_ledger_create ? 1 : 0
  name                = "${var.projection_ledger_lambda_function_name}-schedule"
  description         = "T-60 projection ledger poll. Deployed disabled. Do not enable in this phase."
  schedule_expression = "rate(5 minutes)"
  state               = "DISABLED"
}

resource "aws_cloudwatch_event_target" "projection_ledger_schedule" {
  count     = var.projection_ledger_create ? 1 : 0
  rule      = aws_cloudwatch_event_rule.projection_ledger_schedule[0].name
  target_id = "projection-ledger"
  arn       = aws_lambda_function.projection_ledger[0].arn
  input     = jsonencode({ action = "cycle" })
}

resource "aws_lambda_permission" "allow_eventbridge_projection_ledger" {
  count         = var.projection_ledger_create ? 1 : 0
  statement_id  = "allow-eventbridge-invoke-projection-ledger"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.projection_ledger[0].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.projection_ledger_schedule[0].arn
}

output "projection_ledger_schedule_state" {
  value = "DISABLED"
}
