# Storage pressure and nightly admission denials.
#
# A CloudWatch metric filter sums every value it emits during a clock minute. Publishing
# clusterBytes would turn two review lines in one minute into about twice the real size, and an
# alarm statistic cannot undo that sum. These filters instead emit 1 only when a review line is
# already at or above a monitoring threshold. A quiet minute emits nothing.
#
# Missing threshold counts are notBreaching. The review line stops when the cluster falls below
# the operator review line, so a gap is not database pressure. A separate invocation alarm covers
# a scoreboard collector that stops running. These resources do not change the halt or any
# reservation envelope.

locals {
  storage_metric_namespace = "CourtContext/Storage"
}

resource "aws_cloudwatch_log_metric_filter" "storage_capacity_warning" {
  count          = var.scoreboard_create ? 1 : 0
  name           = "court-context-storage-capacity-warning"
  log_group_name = aws_cloudwatch_log_group.scoreboard[0].name
  pattern        = "{ $.event = \"scoreboard_storage_review\" && $.clusterBytes >= 405000000 }"

  metric_transformation {
    name      = "StorageCapacityWarning"
    namespace = local.storage_metric_namespace
    value     = "1"
  }
}

resource "aws_cloudwatch_metric_alarm" "storage_capacity_warning" {
  count               = var.scoreboard_create ? 1 : 0
  alarm_name          = "court-context-storage-capacity-warning"
  alarm_description   = "At least one scoreboard_storage_review line reported clusterBytes at or above 405000000. The metric is a count of those lines, not the database size, so two lines in one minute cannot double the reading. The three essential reservation envelopes stop fitting together under the 450000000 byte halt at 413676672 bytes. Missing data is not breaching: a minute without a review line does not mean the database grew. A stopped scoreboard collector is a separate invocation alarm."
  namespace           = local.storage_metric_namespace
  metric_name         = "StorageCapacityWarning"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 3
  datapoints_to_alarm = 2
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.ingestion_alarm_actions

  depends_on = [aws_cloudwatch_log_metric_filter.storage_capacity_warning]
}

resource "aws_cloudwatch_log_metric_filter" "storage_capacity_critical" {
  count          = var.scoreboard_create ? 1 : 0
  name           = "court-context-storage-capacity-critical"
  log_group_name = aws_cloudwatch_log_group.scoreboard[0].name
  pattern        = "{ $.event = \"scoreboard_storage_review\" && $.clusterBytes >= 413676672 }"

  metric_transformation {
    name      = "StorageCapacityCritical"
    namespace = local.storage_metric_namespace
    value     = "1"
  }
}

resource "aws_cloudwatch_metric_alarm" "storage_capacity_critical" {
  count               = var.scoreboard_create ? 1 : 0
  alarm_name          = "court-context-storage-capacity-critical"
  alarm_description   = "At least one scoreboard_storage_review line reported clusterBytes at or above 413676672. That monitoring line is the 450000000 byte halt minus the scoreboard envelope of 29179904, the game-status envelope of 2424832, and the nightly envelope of 4718592. From here the three reservations no longer fit together, so an essential collector can be refused. The metric counts matching lines and does not add the database size. Missing data is not breaching."
  namespace           = local.storage_metric_namespace
  metric_name         = "StorageCapacityCritical"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 3
  datapoints_to_alarm = 2
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.ingestion_alarm_actions

  depends_on = [aws_cloudwatch_log_metric_filter.storage_capacity_critical]
}

# The essential allowlist keeps this schedule ENABLED once per minute. Three of five empty
# minutes tolerates the observed one-minute CloudWatch publication lag. This does not measure
# database size.
resource "aws_cloudwatch_metric_alarm" "scoreboard_missed_invocations" {
  count               = var.scoreboard_create && var.scoreboard_enable_schedule && local.scoreboard_schedule_state == "ENABLED" ? 1 : 0
  alarm_name          = "court-context-scoreboard-missed-invocations"
  alarm_description   = "The scoreboard collector had fewer than one invocation in 3 of 5 one-minute periods. Its schedule is once per minute. This means the collector is not running. It does not mean the database is too large. Missing invocation data is breaching. Check the scoreboard schedule and function before treating stored scores as current."
  namespace           = "AWS/Lambda"
  metric_name         = "Invocations"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = local.ingestion_alarm_actions

  dimensions = {
    FunctionName = aws_lambda_function.scoreboard[0].function_name
  }
}

resource "aws_cloudwatch_log_metric_filter" "nightly_storage_denied" {
  name           = "court-context-nightly-storage-denied"
  log_group_name = local.bdl_log_groups.nightly
  pattern        = "\"Nightly writes denied\""

  metric_transformation {
    name      = "NightlyStorageDenials"
    namespace = local.storage_metric_namespace
    value     = "1"
  }
}

resource "aws_cloudwatch_metric_alarm" "nightly_storage_denied" {
  alarm_name          = "court-context-nightly-storage-denied"
  alarm_description   = "At least one nightly invocation logged Nightly writes denied. That run can return HTTP 200 with status storage_denied and store no rows. This is separate from Nightly BDL Updater: FAILED, which is the existing run-failure alarm. Missing data is not breaching because the denial is sparse: a night with no denial line is healthy."
  namespace           = local.storage_metric_namespace
  metric_name         = "NightlyStorageDenials"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.ingestion_alarm_actions

  depends_on = [aws_cloudwatch_log_metric_filter.nightly_storage_denied]
}
