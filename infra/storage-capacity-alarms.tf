# Storage pressure and nightly admission denials.
#
# The scoreboard review line is the only live cluster-size signal. It is emitted from the
# existing scoreboard log group when the cluster, or the cluster plus the scoreboard envelope,
# reaches the operator review line. These alarms do not change that line, the halt, or any
# reservation envelope.
#
# Missing size observations are breaching. The scoreboard error and handled-failure alarms use
# notBreaching and do not fire when the review line stops. Treating a gap as OK would report a
# recovery that was never measured.
#
# CloudWatch sums extracted values that share a clock minute. Two overlapping scoreboard ticks
# can therefore publish about twice the real size for that minute. Each capacity alarm requires
# two of three one-minute periods so one doubled minute does not page, while a sustained reading
# still pages within about two minutes.

locals {
  storage_metric_namespace = "CourtContext/Storage"
}

resource "aws_cloudwatch_log_metric_filter" "postgres_cluster_bytes" {
  count          = var.scoreboard_create ? 1 : 0
  name           = "court-context-postgres-cluster-bytes"
  log_group_name = aws_cloudwatch_log_group.scoreboard[0].name
  pattern        = "{ $.event = \"scoreboard_storage_review\" && $.clusterBytes > 0 }"

  metric_transformation {
    name      = "PostgresClusterBytes"
    namespace = local.storage_metric_namespace
    value     = "$.clusterBytes"
    unit      = "Bytes"
  }
}

resource "aws_cloudwatch_metric_alarm" "storage_capacity_warning" {
  count               = var.scoreboard_create ? 1 : 0
  alarm_name          = "court-context-storage-capacity-warning"
  alarm_description   = "PostgreSQL cluster size reached 405000000 bytes, the maximum clusterBytes published by scoreboard_storage_review in a one-minute period. The three essential reservation envelopes stop fitting together under the 450000000 byte halt at 413676672 bytes. This is earlier warning of that refusal point. Missing data is breaching: the review line is the only size signal, and a gap is not evidence that capacity recovered. The scoreboard error alarms do not cover a missed review line."
  namespace           = local.storage_metric_namespace
  metric_name         = "PostgresClusterBytes"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 3
  datapoints_to_alarm = 2
  threshold           = 405000000
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = local.ingestion_alarm_actions

  depends_on = [aws_cloudwatch_log_metric_filter.postgres_cluster_bytes]
}

resource "aws_cloudwatch_metric_alarm" "storage_capacity_critical" {
  count               = var.scoreboard_create ? 1 : 0
  alarm_name          = "court-context-storage-capacity-critical"
  alarm_description   = "PostgreSQL cluster size reached 413676672 bytes. That is the 450000000 byte halt minus the scoreboard envelope of 29179904, the game-status envelope of 2424832, and the nightly envelope of 4718592. From here the three reservations no longer fit together, so an essential collector can be refused. The alarm uses the maximum clusterBytes in each one-minute period and requires two of three periods. Missing data is breaching because absence of scoreboard_storage_review does not mean the cluster shrank."
  namespace           = local.storage_metric_namespace
  metric_name         = "PostgresClusterBytes"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 3
  datapoints_to_alarm = 2
  threshold           = 413676672
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = local.ingestion_alarm_actions

  depends_on = [aws_cloudwatch_log_metric_filter.postgres_cluster_bytes]
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
