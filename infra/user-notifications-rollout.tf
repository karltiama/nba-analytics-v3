# Prepared rollout. Do not apply until the notification plan is approved.
# These resources do not change CloudWatch alarms, schedules, or the SNS subscription.
# The pilot configuration and the verified karltiama contact stay as they are.

locals {
  notification_alarm_prefix = "arn:aws:cloudwatch:us-east-1:260029269390:alarm:"

  critical_alarm_names = [
    "court-context-game-status-sync-missed-cycles",
    "court-context-injuries-missed-cycles",
    "court-context-player-props-controller-missed-cycles",
    "court-context-bdl-limiter-failure",
    "court-context-odds-scheduler-delivery-failure",
    "court-context-odds-scheduler-dlq-depth",
    "nba-player-props-dlq-not-empty",
  ]

  warning_alarm_names = [
    "court-context-player-props-queue-backlog",
    "court-context-game_status_sync-run-failed",
    "court-context-injuries-run-failed",
    "court-context-nightly-run-failed",
    "court-context-odds-run-failed",
    "court-context-scoreboard-run-failed",
    "court-context-game-status-sync-readiness-not-ready",
    "court-context-bdl-provider-429",
    "court-context-odds-provider-429",
    "court-context-odds-acquisition-failure",
    "court-context-odds-budget-exhausted",
    "court-context-odds-budget-unavailable",
    "court-context-odds-incomplete",
    "nba-player-props-worker-failures",
    "nba-player-props-archive-failed",
    "nba-player-props-archive-gap",
    "nba-game-status-sync-errors",
    "nba-injuries-snapshot-errors",
    "nba-nightly-bdl-updater-errors",
    "nba-odds-pre-game-snapshot-errors",
    "nba-scoreboard-errors",
    "nba-player-props-controller-errors",
    "nba-player-props-worker-errors",
  ]

  critical_alarm_arns = [for name in local.critical_alarm_names : "${local.notification_alarm_prefix}${name}"]
  warning_alarm_arns  = [for name in local.warning_alarm_names : "${local.notification_alarm_prefix}${name}"]
  emailing_alarm_arns = concat(local.critical_alarm_arns, local.warning_alarm_arns)
}

resource "aws_notifications_notification_configuration" "critical" {
  name                 = "court-context-critical"
  description          = "Immediate ALARM emails for missed schedules, the shared limiter, and dead-letter delivery."
  aggregation_duration = "NONE"

  depends_on = [aws_notifications_notification_hub.court_context]

  lifecycle {
    precondition {
      condition     = length(local.critical_alarm_names) == 7 && length(local.warning_alarm_names) == 23 && length(distinct(concat(local.critical_alarm_names, local.warning_alarm_names))) == 30
      error_message = "Critical and warning alarm lists must stay disjoint at 7 and 23."
    }
  }
}

resource "aws_notifications_notification_configuration" "warning" {
  name                 = "court-context-warning"
  description          = "ALARM emails for handled failures and temporary ingestion trouble, aggregated for 5 minutes."
  aggregation_duration = "SHORT"

  depends_on = [aws_notifications_notification_hub.court_context]
}

resource "aws_notifications_notification_configuration" "alarm_cleared" {
  name                 = "court-context-alarm-cleared"
  description          = "OK after ALARM means the signal cleared. It does not prove a successful ingestion run."
  aggregation_duration = "SHORT"

  depends_on = [aws_notifications_notification_hub.court_context]
}

resource "aws_notifications_event_rule" "critical_alarm" {
  notification_configuration_arn = aws_notifications_notification_configuration.critical.arn
  source                         = "aws.cloudwatch"
  event_type                     = "CloudWatch Alarm State Change"
  regions                        = ["us-east-1"]
  event_pattern = jsonencode({
    resources = local.critical_alarm_arns
    detail = {
      state = {
        value = ["ALARM"]
      }
    }
  })
}

resource "aws_notifications_event_rule" "warning_alarm" {
  notification_configuration_arn = aws_notifications_notification_configuration.warning.arn
  source                         = "aws.cloudwatch"
  event_type                     = "CloudWatch Alarm State Change"
  regions                        = ["us-east-1"]
  event_pattern = jsonencode({
    resources = local.warning_alarm_arns
    detail = {
      state = {
        value = ["ALARM"]
      }
    }
  })
}

resource "aws_notifications_event_rule" "alarm_cleared" {
  notification_configuration_arn = aws_notifications_notification_configuration.alarm_cleared.arn
  source                         = "aws.cloudwatch"
  event_type                     = "CloudWatch Alarm State Change"
  regions                        = ["us-east-1"]
  event_pattern = jsonencode({
    resources = local.emailing_alarm_arns
    detail = {
      previousState = {
        value = ["ALARM"]
      }
      state = {
        value = ["OK"]
      }
    }
  })
}

resource "aws_notifications_channel_association" "critical" {
  arn                            = aws_notificationscontacts_email_contact.pilot.arn
  notification_configuration_arn = aws_notifications_notification_configuration.critical.arn
}

resource "aws_notifications_channel_association" "warning" {
  arn                            = aws_notificationscontacts_email_contact.pilot.arn
  notification_configuration_arn = aws_notifications_notification_configuration.warning.arn
}

resource "aws_notifications_channel_association" "alarm_cleared" {
  arn                            = aws_notificationscontacts_email_contact.pilot.arn
  notification_configuration_arn = aws_notifications_notification_configuration.alarm_cleared.arn
}
