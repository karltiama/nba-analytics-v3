resource "aws_cloudwatch_metric_alarm" "player_props_worker_failures" {
  alarm_name          = "nba-player-props-worker-failures"
  alarm_description   = "Alerts when worker batch reports any failed games."
  namespace           = "NBA/PlayerProps"
  metric_name         = "GamesFailed"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    Component = "WorkerBatch"
  }
}

resource "aws_cloudwatch_metric_alarm" "player_props_controller_low_coverage" {
  alarm_name          = "nba-player-props-controller-low-coverage"
  alarm_description   = "Alerts when scheduled run targets fewer than expected games."
  namespace           = "NBA/PlayerProps"
  metric_name         = "GamesQueued"
  statistic           = "Minimum"
  period              = 900
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    Component = "Controller"
  }
}

resource "aws_cloudwatch_metric_alarm" "injuries_snapshot_errors" {
  alarm_name          = "nba-injuries-snapshot-errors"
  alarm_description   = "Alerts when injuries-snapshot reports any invocation errors."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.injuries_snapshot.function_name
  }
}

# AWS/Lambda Errors — nightly, odds, injuries, and boxscore do not emit custom EMF metrics.
# treat_missing_data = notBreaching so a quiet offseason / frozen day does not alarm.
resource "aws_cloudwatch_metric_alarm" "nightly_bdl_errors" {
  alarm_name          = "nba-nightly-bdl-updater-errors"
  alarm_description   = "Alerts when nightly-bdl-updater reports any invocation errors."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.nightly_bdl_updater.function_name
  }
}

resource "aws_cloudwatch_metric_alarm" "odds_pre_game_errors" {
  alarm_name          = "nba-odds-pre-game-snapshot-errors"
  alarm_description   = "Alerts when odds-pre-game-snapshot reports any invocation errors."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.odds_pre_game_snapshot.function_name
  }
}

resource "aws_cloudwatch_metric_alarm" "boxscore_scraper_errors" {
  alarm_name          = "nba-boxscore-scraper-errors"
  alarm_description   = "Alerts when boxscore-scraper reports any invocation errors."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.boxscore_scraper.function_name
  }
}

# Follows status-sync creation. Quiet while frozen (notBreaching).
resource "aws_cloudwatch_metric_alarm" "game_status_sync_errors" {
  count               = var.game_status_sync_create ? 1 : 0
  alarm_name          = "nba-game-status-sync-errors"
  alarm_description   = "Alerts when game-status-sync reports any invocation errors."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.game_status_sync[0].function_name
  }
}

# Follows postgame creation. Quiet while unused (notBreaching).
resource "aws_cloudwatch_metric_alarm" "postgame_stage_dlq_not_empty" {
  count               = var.postgame_create ? 1 : 0
  alarm_name          = "nba-postgame-stage-dlq-not-empty"
  alarm_description   = "Alerts when the postgame stage DLQ has visible messages."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = aws_sqs_queue.postgame_stage_dlq[0].name
  }
}

# CODE_ONLY until the next authorized apply. Quiet while frozen (notBreaching).
resource "aws_cloudwatch_metric_alarm" "player_props_dlq_not_empty" {
  alarm_name          = "nba-player-props-dlq-not-empty"
  alarm_description   = "Alerts when the player props game DLQ has visible messages."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = aws_sqs_queue.player_props_dlq.name
  }
}
