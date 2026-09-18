# Context-projection dual prospective shadow (PTS + MIN research windows).
# Independent of CatBoost shadow-projection and Props Explorer.
#
# Baseline: context_prospective_create=false → no AWS resources.
# Activate schedule only when:
#   context_prospective_create=true
#   context_prospective_enable_schedule=true
#   live_ingestion_enabled=true
#   context_prospective_execution_enabled=true
# And Lambda env:
#   CONTEXT_PTS_SHADOW_WRITES=1
#   CONTEXT_MIN_SHADOW_WRITES=1
#   CONTEXT_PROSPECTIVE_SCHEDULE_CONFIGURED=1
#   CONTEXT_PROSPECTIVE_WINDOW_OPENED_AT=<ISO>
#
# Package: npm run build:context-prospective-shadow-lambda

variable "context_prospective_create" {
  type    = bool
  default = false
}

variable "context_prospective_lambda_function_name" {
  type    = string
  default = "context-prospective-shadow"
}

variable "context_prospective_lambda_timeout" {
  type    = number
  default = 300
}

variable "context_prospective_lambda_memory_size" {
  type    = number
  default = 1024
}

variable "context_prospective_enable_schedule" {
  type    = bool
  default = false
}

variable "context_prospective_execution_enabled" {
  description = "When false, EventBridge rule stays DISABLED even if schedule resource exists."
  type        = bool
  default     = false
}

variable "context_prospective_schedule_expression" {
  type    = string
  default = "rate(5 minutes)"
}

variable "context_prospective_lambda_env" {
  type      = map(string)
  default   = {}
  sensitive = true
}

locals {
  context_prospective_schedule_state = (
    var.context_prospective_create &&
    var.context_prospective_enable_schedule &&
    var.live_ingestion_enabled &&
    var.context_prospective_execution_enabled
  ) ? "ENABLED" : "DISABLED"
}

data "archive_file" "context_prospective_shadow" {
  count       = var.context_prospective_create ? 1 : 0
  type        = "zip"
  source_dir  = "${path.module}/../lambda/context-prospective-shadow/.package"
  output_path = "${path.module}/context-prospective-shadow.zip"
}

resource "aws_iam_role" "lambda_context_prospective_execution" {
  count = var.context_prospective_create ? 1 : 0
  name  = "${var.context_prospective_lambda_function_name}-execution-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_context_prospective_basic" {
  count      = var.context_prospective_create ? 1 : 0
  role       = aws_iam_role.lambda_context_prospective_execution[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_function" "context_prospective_shadow" {
  count         = var.context_prospective_create ? 1 : 0
  function_name = var.context_prospective_lambda_function_name
  role          = aws_iam_role.lambda_context_prospective_execution[0].arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  timeout       = var.context_prospective_lambda_timeout
  memory_size   = var.context_prospective_lambda_memory_size
  filename      = data.archive_file.context_prospective_shadow[0].output_path
  source_code_hash = data.archive_file.context_prospective_shadow[0].output_base64sha256

  environment {
    variables = merge(
      var.context_prospective_lambda_env,
      {
        CONTEXT_PROSPECTIVE_SCHEDULE_CONFIGURED = "1"
        # Freeze defaults — override via context_prospective_lambda_env when activating.
        CONTEXT_PTS_SHADOW_WRITES  = lookup(var.context_prospective_lambda_env, "CONTEXT_PTS_SHADOW_WRITES", "0")
        CONTEXT_MIN_SHADOW_WRITES  = lookup(var.context_prospective_lambda_env, "CONTEXT_MIN_SHADOW_WRITES", "0")
      }
    )
  }
}

resource "aws_cloudwatch_event_rule" "context_prospective_schedule" {
  count               = var.context_prospective_create && var.context_prospective_enable_schedule ? 1 : 0
  name                = "${var.context_prospective_lambda_function_name}-schedule"
  description         = "T-60 poll for context-projection PTS+MIN prospective shadows"
  schedule_expression = var.context_prospective_schedule_expression
  state               = local.context_prospective_schedule_state
}

resource "aws_cloudwatch_event_target" "context_prospective_schedule" {
  count     = var.context_prospective_create && var.context_prospective_enable_schedule ? 1 : 0
  rule      = aws_cloudwatch_event_rule.context_prospective_schedule[0].name
  target_id = "context-prospective-shadow"
  arn       = aws_lambda_function.context_prospective_shadow[0].arn
  input     = jsonencode({ action = "cycle" })
}

resource "aws_lambda_permission" "allow_eventbridge_context_prospective" {
  count         = var.context_prospective_create && var.context_prospective_enable_schedule ? 1 : 0
  statement_id  = "allow-eventbridge-invoke-context-prospective"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.context_prospective_shadow[0].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.context_prospective_schedule[0].arn
}

output "context_prospective_function_name" {
  value = var.context_prospective_create ? aws_lambda_function.context_prospective_shadow[0].function_name : null
}

output "context_prospective_schedule_state" {
  value = local.context_prospective_schedule_state
}
