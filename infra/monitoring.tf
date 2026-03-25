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
