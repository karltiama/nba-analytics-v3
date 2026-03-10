# Package Lambda from source: run "npm install && npm run build" in lambda/nightly-bdl-updater first.
data "archive_file" "nightly_bdl" {
  type        = "zip"
  source_dir  = "${path.module}/../lambda/nightly-bdl-updater"
  output_path = "${path.module}/nightly-bdl-updater.zip"
}

resource "aws_lambda_function" "nightly_bdl_updater" {
  filename         = data.archive_file.nightly_bdl.output_path
  function_name    = var.lambda_function_name
  role             = aws_iam_role.lambda_nightly_bdl_execution.arn
  handler          = "dist/index.handler"
  runtime          = "nodejs20.x"
  timeout          = var.lambda_timeout
  memory_size      = var.lambda_memory_size
  source_code_hash = data.archive_file.nightly_bdl.output_base64sha256

  environment {
    variables = var.lambda_env
  }
}

# -----------------------------------------------------------------------------
# EventBridge schedule (optional; set enable_schedule = true to use)
# -----------------------------------------------------------------------------
resource "aws_cloudwatch_event_rule" "nightly_bdl_schedule" {
  count               = var.enable_schedule ? 1 : 0
  name                = "${var.lambda_function_name}-daily"
  description         = "Daily trigger for ${var.lambda_function_name} at 08:00 UTC"
  schedule_expression = var.schedule_cron
}

resource "aws_cloudwatch_event_target" "nightly_bdl" {
  count     = var.enable_schedule ? 1 : 0
  rule      = aws_cloudwatch_event_rule.nightly_bdl_schedule[0].name
  target_id = "nightly-bdl-updater"
  arn       = aws_lambda_function.nightly_bdl_updater.arn
}

resource "aws_lambda_permission" "allow_eventbridge" {
  count         = var.enable_schedule ? 1 : 0
  statement_id  = "allow-eventbridge-invoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.nightly_bdl_updater.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.nightly_bdl_schedule[0].arn
}

# -----------------------------------------------------------------------------
# Lambda: odds-pre-game-snapshot (run "npm install && npm run build" in lambda/odds-pre-game-snapshot first)
# -----------------------------------------------------------------------------
data "archive_file" "odds_pre_game" {
  type        = "zip"
  source_dir  = "${path.module}/../lambda/odds-pre-game-snapshot"
  output_path = "${path.module}/odds-pre-game-snapshot.zip"
}

resource "aws_lambda_function" "odds_pre_game_snapshot" {
  filename         = data.archive_file.odds_pre_game.output_path
  function_name    = var.odds_lambda_function_name
  role             = aws_iam_role.lambda_odds_execution.arn
  handler          = "dist/index.handler"
  runtime          = "nodejs20.x"
  timeout          = var.odds_lambda_timeout
  memory_size      = var.odds_lambda_memory_size
  source_code_hash = data.archive_file.odds_pre_game.output_base64sha256

  environment {
    variables = var.odds_lambda_env
  }
}

# -----------------------------------------------------------------------------
# EventBridge schedule for odds (optional; set odds_enable_schedule = true to use)
# -----------------------------------------------------------------------------
resource "aws_cloudwatch_event_rule" "odds_schedule" {
  count               = var.odds_enable_schedule ? 1 : 0
  name                = "${var.odds_lambda_function_name}-schedule"
  description         = "Schedule for ${var.odds_lambda_function_name} (e.g. 09:00 ET)"
  schedule_expression = var.odds_schedule_cron
}

resource "aws_cloudwatch_event_target" "odds_pre_game" {
  count     = var.odds_enable_schedule ? 1 : 0
  rule      = aws_cloudwatch_event_rule.odds_schedule[0].name
  target_id = "odds-pre-game-snapshot"
  arn       = aws_lambda_function.odds_pre_game_snapshot.arn
}

resource "aws_lambda_permission" "allow_eventbridge_odds" {
  count         = var.odds_enable_schedule ? 1 : 0
  statement_id  = "allow-eventbridge-invoke-odds"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.odds_pre_game_snapshot.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.odds_schedule[0].arn
}
