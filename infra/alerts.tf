# Court Context ingestion alert routing (Phase 1B.4).
#
# One SNS topic receives every BDL ingestion alarm. The email subscription is created only when
# ingestion_alert_email is set (tfvars, never committed). AWS sends a confirmation email; the
# subscription delivers nothing until that link is clicked, so verify with a test publish.
#
# Off-season / frozen behaviour:
# - Failure, 429, limiter and DLQ alarms use notBreaching: no invocations means no alert.
# - Missed-cycle and backlog alarms treat missing data as breaching, so each one exists only
#   while its family is live (local.family_schedule_enabled). A disabled family has no such alarm.
#
# Handlers for nightly, injuries, odds and status-sync catch errors and return a 500 body, so the
# AWS/Lambda Errors metric misses them. The log metric filters below count those failures.

variable "ingestion_alert_email" {
  description = "Email endpoint for the ingestion alert topic. Empty = no subscription. Set only in tfvars."
  type        = string
  default     = ""
  sensitive   = true
}

resource "aws_sns_topic" "ingestion_alerts" {
  name = "court-context-ingestion-alerts"
}

resource "aws_sns_topic_subscription" "ingestion_alerts_email" {
  count     = var.ingestion_alert_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.ingestion_alerts.arn
  protocol  = "email"
  endpoint  = var.ingestion_alert_email
}

locals {
  ingestion_alarm_actions = [aws_sns_topic.ingestion_alerts.arn]
  ingestion_metric_ns     = "CourtContext/Ingestion"

  bdl_log_groups = merge(
    {
      nightly      = "/aws/lambda/${aws_lambda_function.nightly_bdl_updater.function_name}"
      odds         = "/aws/lambda/${aws_lambda_function.odds_pre_game_snapshot.function_name}"
      injuries     = "/aws/lambda/${aws_lambda_function.injuries_snapshot.function_name}"
      props_worker = "/aws/lambda/${aws_lambda_function.player_props_worker.function_name}"
    },
    var.game_status_sync_create ? {
      game_status_sync = "/aws/lambda/${aws_lambda_function.game_status_sync[0].function_name}"
    } : {}
  )

  # Handled run failures that do not raise a Lambda error.
  ingestion_run_failures = merge(
    {
      nightly = {
        log_group = local.bdl_log_groups.nightly
        pattern   = "\"Nightly BDL Updater: FAILED\""
      }
      injuries = {
        log_group = local.bdl_log_groups.injuries
        pattern   = "\"Error in injuries snapshot\""
      }
      odds = {
        log_group = local.bdl_log_groups.odds
        pattern   = "?\"Error processing\" ?\"Error in pre-game odds snapshot\""
      }
    },
    var.game_status_sync_create ? {
      game_status_sync = {
        log_group = local.bdl_log_groups.game_status_sync
        pattern   = "{ $.event = \"game_status_sync_failed\" }"
      }
    } : {}
  )
}

# ---------------------------------------------------------------------------
# Handled run failures (one metric per family).
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_metric_filter" "ingestion_run_failed" {
  for_each       = local.ingestion_run_failures
  name           = "court-context-${each.key}-run-failed"
  log_group_name = each.value.log_group
  pattern        = each.value.pattern

  metric_transformation {
    name      = "RunFailed-${each.key}"
    namespace = local.ingestion_metric_ns
    value     = "1"
  }
}

# Daily jobs alert on any failed run. Status-sync polls every 15 minutes and the next poll
# retries, so it alerts only when 2 of 3 consecutive 15-minute windows fail.
locals {
  ingestion_run_failed_descriptions = {
    game_status_sync = "Game-status-sync recorded repeated handled failures. Affected polls did not write game updates. Check recent failure logs and whether subsequent scheduled runs completed. An OK alarm state does not by itself confirm successful ingestion."
    injuries         = "injuries-snapshot logged a handled failure. That run did not finish the injury snapshot. Check the next slate. Search the log for \"Error in injuries snapshot\". This is separate from Lambda Errors. A later OK only means this signal went quiet."
    nightly          = "nightly-bdl-updater logged \"Nightly BDL Updater: FAILED\". The nightly game and stats load did not finish. Check before the next slate. Read that log line. This is separate from Lambda Errors. A later OK only means this signal went quiet."
    odds             = "odds-pre-game-snapshot logged a handled processing error. That run did not finish odds ingestion. Check during the slate. Search for \"Error processing\" or \"Error in pre-game odds snapshot\". This is separate from Lambda Errors. A later OK only means this signal went quiet."
  }
}

resource "aws_cloudwatch_metric_alarm" "ingestion_run_failed" {
  for_each            = local.ingestion_run_failures
  alarm_name          = "court-context-${each.key}-run-failed"
  alarm_description   = local.ingestion_run_failed_descriptions[each.key]
  namespace           = local.ingestion_metric_ns
  metric_name         = "RunFailed-${each.key}"
  statistic           = "Sum"
  period              = each.key == "game_status_sync" ? 900 : 300
  evaluation_periods  = each.key == "game_status_sync" ? 3 : 1
  datapoints_to_alarm = each.key == "game_status_sync" ? 2 : 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.ingestion_alarm_actions

  depends_on = [aws_cloudwatch_log_metric_filter.ingestion_run_failed]
}

# ---------------------------------------------------------------------------
# Status-sync season-phase readiness (season_phase_readiness log event).
# Evaluated only after a run that wrote; `status` and `ready` are separate verdicts.
# A provider-confirmed no-game window logs ready=true and never counts.
# coverage="db_only" with ready=false means provider evidence was incomplete (page cap) or the
# readiness read failed; coverage="provider_verified" with ready=false means classification gaps.
# Filters always exist (no notifications); the alarm exists only while the family is live, so
# manual canaries during the freeze cannot page.
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_metric_filter" "game_status_sync_readiness_not_ready" {
  count          = var.game_status_sync_create ? 1 : 0
  name           = "court-context-game_status_sync-readiness-not-ready"
  log_group_name = local.bdl_log_groups.game_status_sync
  pattern        = "{ $.event = \"season_phase_readiness\" && $.ready IS FALSE }"

  metric_transformation {
    name      = "ReadinessNotReady-game_status_sync"
    namespace = local.ingestion_metric_ns
    value     = "1"
  }
}

resource "aws_cloudwatch_log_metric_filter" "game_status_sync_readiness_unverified" {
  count          = var.game_status_sync_create ? 1 : 0
  name           = "court-context-game_status_sync-readiness-unverified"
  log_group_name = local.bdl_log_groups.game_status_sync
  pattern        = "{ $.event = \"season_phase_readiness\" && $.ready IS FALSE && $.coverage = \"db_only\" }"

  metric_transformation {
    name      = "ReadinessUnverified-game_status_sync"
    namespace = local.ingestion_metric_ns
    value     = "1"
  }
}

# One not-ready run can be a game labelled on the next poll; 2 of 3 consecutive 15-minute
# windows is a repeated gap.
resource "aws_cloudwatch_metric_alarm" "game_status_sync_readiness_not_ready" {
  count               = var.game_status_sync_create && var.game_status_sync_enable_schedule && local.family_schedule_enabled.game_status_sync ? 1 : 0
  alarm_name          = "court-context-game-status-sync-readiness-not-ready"
  alarm_description   = "game-status-sync logged season phase not ready in 2 of 3 consecutive 15-minute windows. Downstream season-phase use is not ready. Check the next slate. Read season_phase_readiness reasons. A provider-confirmed empty window does not count. A later OK only means this signal went quiet."
  namespace           = local.ingestion_metric_ns
  metric_name         = "ReadinessNotReady-game_status_sync"
  statistic           = "Sum"
  period              = 900
  evaluation_periods  = 3
  datapoints_to_alarm = 2
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.ingestion_alarm_actions

  depends_on = [aws_cloudwatch_log_metric_filter.game_status_sync_readiness_not_ready]
}

# ---------------------------------------------------------------------------
# Shared limiter signals from the bdl_throttle log line (all BDL Lambdas).
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_metric_filter" "bdl_provider_429" {
  for_each       = local.bdl_log_groups
  name           = "court-context-${each.key}-bdl-429"
  log_group_name = each.value
  pattern        = "{ $.evt = \"bdl_throttle\" && $.decision = \"provider_429\" }"

  metric_transformation {
    name      = "BdlProvider429"
    namespace = local.ingestion_metric_ns
    value     = "1"
  }
}

resource "aws_cloudwatch_log_metric_filter" "bdl_limiter_failure" {
  for_each       = local.bdl_log_groups
  name           = "court-context-${each.key}-bdl-limiter-failure"
  log_group_name = each.value
  pattern        = "{ $.evt = \"bdl_throttle\" && ($.decision = \"timeout\" || $.decision = \"coordination\" || $.decision = \"coordination_error\" || $.decision = \"config\" || $.decision = \"config_error\" || $.decision = \"deadline\" || $.decision = \"retry_wait_exceeds_budget\" || $.decision = \"http_error\") }"

  metric_transformation {
    name      = "BdlLimiterFailure"
    namespace = local.ingestion_metric_ns
    value     = "1"
  }
}

resource "aws_cloudwatch_metric_alarm" "bdl_provider_429" {
  alarm_name          = "court-context-bdl-provider-429"
  alarm_description   = "BallDontLie returned 429 at least 3 times in 5 minutes across live callers. Calls are being rate limited. Check during the slate. Look for callers outside the shared limiter before raising it. A later OK only means this signal went quiet."
  namespace           = local.ingestion_metric_ns
  metric_name         = "BdlProvider429"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 3
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.ingestion_alarm_actions

  depends_on = [aws_cloudwatch_log_metric_filter.bdl_provider_429]
}

resource "aws_cloudwatch_metric_alarm" "bdl_limiter_failure" {
  alarm_name          = "court-context-bdl-limiter-failure"
  alarm_description   = "The shared BallDontLie limiter logged at least 3 permit, coordination, deadline, or transport failures in 15 minutes. Live callers can stall. Act now. Open the bdl_throttle logs before changing limiter settings. A later OK only means this signal went quiet."
  namespace           = local.ingestion_metric_ns
  metric_name         = "BdlLimiterFailure"
  statistic           = "Sum"
  period              = 900
  evaluation_periods  = 1
  threshold           = 3
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.ingestion_alarm_actions

  depends_on = [aws_cloudwatch_log_metric_filter.bdl_limiter_failure]
}

# ---------------------------------------------------------------------------
# Props worker / controller raised errors.
# ---------------------------------------------------------------------------

# The worker raises per failed game and SQS redelivers up to 4 times; 3 errors in 15 minutes is
# sustained, a single retried failure is not.
resource "aws_cloudwatch_metric_alarm" "player_props_worker_errors" {
  alarm_name          = "nba-player-props-worker-errors"
  alarm_description   = "The player-props worker raised at least 3 errors in 15 minutes. One retried failure stays below this threshold. Check during the slate. Read the worker Lambda errors and the dead-letter queue. A later OK only means this signal went quiet."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 900
  evaluation_periods  = 1
  threshold           = 3
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.ingestion_alarm_actions

  dimensions = {
    FunctionName = aws_lambda_function.player_props_worker.function_name
  }
}

resource "aws_cloudwatch_metric_alarm" "player_props_controller_errors" {
  alarm_name          = "nba-player-props-controller-errors"
  alarm_description   = "The player-props controller raised an unhandled error. Queueing for that wave failed. Check during the slate. Read the controller Lambda error. A later OK only means no new error was counted."
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
    FunctionName = aws_lambda_function.player_props_controller.function_name
  }
}

# ---------------------------------------------------------------------------
# Missed cycles and backlog. Exist only while the family is live.
# Windows exceed the longest normal schedule gap plus one partial period.
# ---------------------------------------------------------------------------

# rate(15 minutes): three empty 15-minute windows = at least two missed polls.
resource "aws_cloudwatch_metric_alarm" "game_status_sync_missed_cycles" {
  count               = var.game_status_sync_create && var.game_status_sync_enable_schedule && local.family_schedule_enabled.game_status_sync ? 1 : 0
  alarm_name          = "court-context-game-status-sync-missed-cycles"
  alarm_description   = "No game-status-sync invocation for 45 minutes while its schedule is live. Status in analytics.games can go stale. The separate one-minute scoreboard collector can keep updating. Act now. Check the game-status-sync schedule, function, and shared rate limiter. A later OK means invocations resumed, not that a run succeeded."
  namespace           = "AWS/Lambda"
  metric_name         = "Invocations"
  statistic           = "Sum"
  period              = 900
  evaluation_periods  = 3
  datapoints_to_alarm = 3
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = local.ingestion_alarm_actions

  dimensions = {
    FunctionName = aws_lambda_function.game_status_sync[0].function_name
  }
}

# Near-tip polls run 08:00–23:45 ET every 15 minutes; the overnight gap is about 8 hours.
resource "aws_cloudwatch_metric_alarm" "player_props_controller_missed_cycles" {
  count               = var.player_props_enable_schedule && local.family_schedule_enabled.player_props ? 1 : 0
  alarm_name          = "court-context-player-props-controller-missed-cycles"
  alarm_description   = "No player-props controller invocation for 12 hours while its schedules are live. New games are not queued. Act now. Check the controller schedules and function. A later OK means invocations resumed, not that games were queued."
  namespace           = "AWS/Lambda"
  metric_name         = "Invocations"
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 12
  datapoints_to_alarm = 12
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = local.ingestion_alarm_actions

  dimensions = {
    FunctionName = aws_lambda_function.player_props_controller.function_name
  }
}

# Default injuries cron runs at 13, 18 and 22 UTC; the longest gap is 15 hours.
resource "aws_cloudwatch_metric_alarm" "injuries_missed_cycles" {
  count               = var.injuries_enable_schedule && local.family_schedule_enabled.injuries ? 1 : 0
  alarm_name          = "court-context-injuries-missed-cycles"
  alarm_description   = "No injuries-snapshot invocation for 18 hours while its schedule is live. Injury data can go stale. Act now. Check the injuries schedule and function. A later OK means invocations resumed, not that the snapshot succeeded."
  namespace           = "AWS/Lambda"
  metric_name         = "Invocations"
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 18
  datapoints_to_alarm = 18
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = local.ingestion_alarm_actions

  dimensions = {
    FunctionName = aws_lambda_function.injuries_snapshot.function_name
  }
}

# With ESM max concurrency 2, a healthy wave drains in minutes. Missing data (empty queue) is fine.
resource "aws_cloudwatch_metric_alarm" "player_props_queue_backlog" {
  count               = local.family_schedule_enabled.player_props ? 1 : 0
  alarm_name          = "court-context-player-props-queue-backlog"
  alarm_description   = "The oldest player-props queue message has been waiting at least 15 minutes across two checks. Props for that game are delayed. Check during the slate. Look at worker errors and the shared limiter. A later OK means the oldest message is under 15 minutes or the queue is empty."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateAgeOfOldestMessage"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 900
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.ingestion_alarm_actions

  dimensions = {
    QueueName = aws_sqs_queue.player_props_game_queue.name
  }
}

output "ingestion_alerts_topic_arn" {
  description = "SNS topic for Court Context ingestion alarms."
  value       = aws_sns_topic.ingestion_alerts.arn
}
