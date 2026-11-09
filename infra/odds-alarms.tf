# Existing production odds alarms. Import adopts them in place.
# These resources are unconditional. A normal plan cannot drop them by
# setting a variable to false. The log metric filters stay outside this file.
#
# The alarm_description values are the readable text. The previous production
# wording is kept in the rollback comments at the bottom.

resource "aws_cloudwatch_metric_alarm" "odds_acquisition_failure" {
  alarm_name          = "court-context-odds-acquisition-failure"
  alarm_description   = "odds-pre-game-snapshot logged an odds_acquisition result with success false, other than SKIPPED or STALE. Incomplete, budget, and claim failures count here too. A NO_DUE_WORK result is success and does not count. Check during the slate. Read the odds_acquisition log. This is separate from Lambda Errors. An OK state only means this signal went quiet."
  namespace           = local.ingestion_metric_ns
  metric_name         = "OddsAcquisitionFailure"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.ingestion_alarm_actions
}

import {
  to = aws_cloudwatch_metric_alarm.odds_acquisition_failure
  id = "court-context-odds-acquisition-failure"
}

resource "aws_cloudwatch_metric_alarm" "odds_budget_exhausted" {
  alarm_name          = "court-context-odds-budget-exhausted"
  alarm_description   = "odds-pre-game-snapshot recorded a date whose request budget was exhausted. Raw rows from that attempt may exist. Current odds and movement are not replaced from this failed result. Check during the slate. Read odds_acquisition budgetExhausted. An OK state only means this signal went quiet."
  namespace           = local.ingestion_metric_ns
  metric_name         = "OddsBudgetExhausted"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.ingestion_alarm_actions
}

import {
  to = aws_cloudwatch_metric_alarm.odds_budget_exhausted
  id = "court-context-odds-budget-exhausted"
}

resource "aws_cloudwatch_metric_alarm" "odds_budget_unavailable" {
  alarm_name          = "court-context-odds-budget-unavailable"
  alarm_description   = "odds-pre-game-snapshot could not grant or record an odds request reservation. That attempt did not continue as a normal fetch. Check the shared rate-limit table and odds_acquisition status BUDGET_UNAVAILABLE. An OK state only means this signal went quiet."
  namespace           = local.ingestion_metric_ns
  metric_name         = "OddsBudgetUnavailable"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.ingestion_alarm_actions
}

import {
  to = aws_cloudwatch_metric_alarm.odds_budget_unavailable
  id = "court-context-odds-budget-unavailable"
}

resource "aws_cloudwatch_metric_alarm" "odds_incomplete" {
  alarm_name          = "court-context-odds-incomplete"
  alarm_description   = "odds-pre-game-snapshot recorded repeated incomplete odds results. One incomplete snapshot stays below this alarm. An incomplete date does not replace current odds or movement. Check during the slate. Read odds_acquisition incomplete. An OK state does not by itself confirm that a later snapshot completed."
  namespace           = local.ingestion_metric_ns
  metric_name         = "OddsIncompleteSnapshot"
  statistic           = "Sum"
  period              = 900
  evaluation_periods  = 3
  datapoints_to_alarm = 2
  threshold           = 2
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.ingestion_alarm_actions
}

import {
  to = aws_cloudwatch_metric_alarm.odds_incomplete
  id = "court-context-odds-incomplete"
}

resource "aws_cloudwatch_metric_alarm" "odds_provider_429" {
  alarm_name          = "court-context-odds-provider-429"
  alarm_description   = "odds-pre-game-snapshot classified an odds date as rate limited. A 429 that the shared limiter retried successfully does not by itself raise this alarm. Check during the slate. Read odds_acquisition provider429. This is separate from court-context-bdl-provider-429. An OK state only means this signal went quiet."
  namespace           = local.ingestion_metric_ns
  metric_name         = "OddsProvider429"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.ingestion_alarm_actions
}

import {
  to = aws_cloudwatch_metric_alarm.odds_provider_429
  id = "court-context-odds-provider-429"
}

resource "aws_cloudwatch_metric_alarm" "odds_scheduler_delivery_failure" {
  alarm_name          = "court-context-odds-scheduler-delivery-failure"
  alarm_description   = "A schedule in the default Scheduler group had a target error or a dropped invocation. This includes the odds, scoreboard, game-status-sync, and player-props schedules, not odds alone. One counted failure is enough. Act now. Check target errors in the default group before disabling a schedule. An OK state means that combined count fell below 1. It does not prove the failed target ran."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  threshold           = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.ingestion_alarm_actions

  metric_query {
    id          = "errors"
    return_data = false

    metric {
      namespace   = "AWS/Scheduler"
      metric_name = "TargetErrorCount"
      period      = 60
      stat        = "Sum"

      dimensions = {
        ScheduleGroup = "default"
      }
    }
  }

  metric_query {
    id          = "dropped"
    return_data = false

    metric {
      namespace   = "AWS/Scheduler"
      metric_name = "InvocationDroppedCount"
      period      = 60
      stat        = "Sum"

      dimensions = {
        ScheduleGroup = "default"
      }
    }
  }

  metric_query {
    id          = "delivery"
    expression  = "FILL(errors,0)+FILL(dropped,0)"
    label       = "SchedulerDeliveryFailure"
    return_data = true
  }
}

import {
  to = aws_cloudwatch_metric_alarm.odds_scheduler_delivery_failure
  id = "court-context-odds-scheduler-delivery-failure"
}

resource "aws_cloudwatch_metric_alarm" "odds_scheduler_dlq_depth" {
  alarm_name          = "court-context-odds-scheduler-dlq-depth"
  alarm_description   = "The odds Scheduler dead-letter queue has a visible message. The odds schedule does not retry that delivery. Scoreboard and the other default-group schedules do not use this queue. Act now. Inspect the message and redrive it only after the cause is fixed. An OK state means no visible message remains, not that the odds snapshot ran."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.ingestion_alarm_actions

  dimensions = {
    QueueName = "odds-pre-game-snapshot-schedule-dlq"
  }
}

import {
  to = aws_cloudwatch_metric_alarm.odds_scheduler_dlq_depth
  id = "court-context-odds-scheduler-dlq-depth"
}

# Rollback descriptions. These are the production strings this plan replaces.
# odds_acquisition_failure: Odds acquisition logged a handled failure. SKIPPED, STALE, and NO_DUE_WORK do not match.
# odds_budget_exhausted: Odds daily request budget refused a reservation.
# odds_budget_unavailable: Odds budget storage could not grant or record a reservation.
# odds_incomplete: Odds pagination stopped incomplete in 2 of 3 consecutive 15-minute windows.
# odds_provider_429: Odds acquisition recorded a provider 429.
# odds_scheduler_delivery_failure: GROUP-WIDE default Scheduler group, including the enabled scoreboard schedule. Sum of TargetErrorCount and InvocationDroppedCount, missing values filled as zero. Period 60 seconds. One delivery failure alarms.
# odds_scheduler_dlq_depth: Visible messages on the odds Scheduler dead-letter queue. Period 60 seconds, maximum, one evaluation. A single message is a delivery failure.
