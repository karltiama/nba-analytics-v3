resource "aws_cloudwatch_metric_alarm" "player_props_worker_failures" {
  alarm_name          = "nba-player-props-worker-failures"
  alarm_description   = "A player-props worker batch reported at least one failed game. Those games were not stored. Check during the slate. Read GamesFailed for the worker batch. This is separate from the worker Lambda Errors alarm. A later OK only means this signal went quiet."
  namespace           = "NBA/PlayerProps"
  metric_name         = "GamesFailed"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.ingestion_alarm_actions

  dimensions = {
    Component = "WorkerBatch"
  }
}

resource "aws_cloudwatch_metric_alarm" "player_props_controller_low_coverage" {
  alarm_name          = "nba-player-props-controller-low-coverage"
  alarm_description   = "Alerts when a controller wave had eligible games and queued none. An empty eligible window does not emit GamesQueued, and missing data does not breach."
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
  alarm_description   = "injuries-snapshot raised an unhandled Lambda error. That invocation failed. Check the next slate. Read the Lambda error, not only the handled-failure log. A later OK only means no new error was counted."
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
    FunctionName = aws_lambda_function.injuries_snapshot.function_name
  }
}

# AWS/Lambda Errors — nightly, odds, injuries, and boxscore do not emit custom EMF metrics.
# treat_missing_data = notBreaching so a quiet offseason / frozen day does not alarm.
resource "aws_cloudwatch_metric_alarm" "nightly_bdl_errors" {
  alarm_name          = "nba-nightly-bdl-updater-errors"
  alarm_description   = "nightly-bdl-updater raised an unhandled Lambda error. That nightly invocation failed. Check before the next slate. Read the Lambda error, not only the handled FAILED line. A later OK only means no new error was counted."
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
    FunctionName = aws_lambda_function.nightly_bdl_updater.function_name
  }
}

resource "aws_cloudwatch_metric_alarm" "odds_pre_game_errors" {
  alarm_name          = "nba-odds-pre-game-snapshot-errors"
  alarm_description   = "odds-pre-game-snapshot raised an unhandled Lambda error. That invocation failed. Check during the slate. Read the Lambda error, not only the handled odds logs. A later OK only means no new error was counted."
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

# Follows shadow creation. Quiet while unused (notBreaching). No SNS destination configured.
resource "aws_cloudwatch_metric_alarm" "shadow_projection_errors" {
  count               = var.shadow_create ? 1 : 0
  alarm_name          = "nba-shadow-projection-errors"
  alarm_description   = "Visibility-only Errors alarm for shadow-projection. No notification destination is attached."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.shadow_projection[0].function_name
  }
}

# Follows status-sync creation. Quiet while frozen (notBreaching).
resource "aws_cloudwatch_metric_alarm" "game_status_sync_errors" {
  count               = var.game_status_sync_create ? 1 : 0
  alarm_name          = "nba-game-status-sync-errors"
  alarm_description   = "game-status-sync raised an unhandled Lambda error. The invocation failed before a normal result. Check the next slate. Read the Lambda error, not only game_status_sync_failed. A later OK only means no new error was counted."
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
  alarm_actions       = local.ingestion_alarm_actions

  dimensions = {
    QueueName = aws_sqs_queue.postgame_stage_dlq[0].name
  }
}

# CODE_ONLY until the next authorized apply. Quiet while frozen (notBreaching).
resource "aws_cloudwatch_metric_alarm" "player_props_dlq_not_empty" {
  alarm_name          = "nba-player-props-dlq-not-empty"
  alarm_description   = "The player-props game dead-letter queue has a visible message. That game was not ingested after retries. Act now. Inspect the message and redrive it only after the cause is fixed. A later OK means no visible message remains, not that the game was ingested."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.ingestion_alarm_actions

  dimensions = {
    QueueName = aws_sqs_queue.player_props_dlq.name
  }
}

resource "aws_cloudwatch_metric_alarm" "player_props_archive_gap" {
  alarm_name          = "nba-player-props-archive-gap"
  alarm_description   = "A worker batch stored rows without a verified S3 archive. Props can be in the database while the archive is missing. Check after the slate. Reconcile rows stored against rows archived. A later OK only means this signal went quiet."
  namespace           = "NBA/PlayerProps"
  metric_name         = "ArchiveGap"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.ingestion_alarm_actions

  dimensions = {
    Component = "WorkerBatch"
  }
}

resource "aws_cloudwatch_metric_alarm" "player_props_archive_failed" {
  alarm_name          = "nba-player-props-archive-failed"
  alarm_description   = "A player-props archive write failed. Database rows may exist without a verified archive. Check after the slate. Reconcile the S3 archive. A later OK only means this signal went quiet."
  namespace           = "NBA/PlayerProps"
  metric_name         = "ArchiveFailed"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.ingestion_alarm_actions

  dimensions = {
    Component = "WorkerBatch"
  }
}
