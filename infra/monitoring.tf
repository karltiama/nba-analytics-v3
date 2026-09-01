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
  treat_missing_data  = "breaching"

  dimensions = {
    Component = "Controller"
  }
}

# AWS/Lambda Errors — nightly, odds, and boxscore do not emit custom EMF metrics.
# treat_missing_data = notBreaching so a quiet offseason day does not alarm.
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
