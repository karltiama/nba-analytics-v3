# Pilot delivery for nba-boxscore-scraper-errors only.
# The alarm, the disabled scraper schedule, and the ingestion SNS subscription stay unchanged.

locals {
  pilot_alarm_arn = "arn:aws:cloudwatch:us-east-1:260029269390:alarm:nba-boxscore-scraper-errors"
}

resource "aws_notifications_notification_hub" "court_context" {
  notification_hub_region = "us-east-1"

  lifecycle {
    precondition {
      condition     = var.aws_region == "us-east-1"
      error_message = "The pilot hub is approved only in us-east-1."
    }
  }
}

resource "aws_notifications_notification_configuration" "pilot" {
  name                 = "court-context-pilot"
  description          = "Pilot emails for nba-boxscore-scraper-errors state changes."
  aggregation_duration = "NONE"

  depends_on = [aws_notifications_notification_hub.court_context]
}

resource "aws_notificationscontacts_email_contact" "pilot" {
  name          = "karltiama"
  email_address = var.ingestion_alert_email

  lifecycle {
    precondition {
      condition     = var.ingestion_alert_email == "karltiama@gmail.com"
      error_message = "Pilot email contact must be karltiama@gmail.com."
    }
  }
}

resource "aws_notifications_event_rule" "pilot_alarm" {
  notification_configuration_arn = aws_notifications_notification_configuration.pilot.arn
  source                         = "aws.cloudwatch"
  event_type                     = "CloudWatch Alarm State Change"
  regions                        = ["us-east-1"]
  event_pattern = jsonencode({
    resources = [local.pilot_alarm_arn]
    detail = {
      state = {
        value = ["ALARM"]
      }
    }
  })
}

resource "aws_notifications_event_rule" "pilot_recovered" {
  notification_configuration_arn = aws_notifications_notification_configuration.pilot.arn
  source                         = "aws.cloudwatch"
  event_type                     = "CloudWatch Alarm State Change"
  regions                        = ["us-east-1"]
  event_pattern = jsonencode({
    resources = [local.pilot_alarm_arn]
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

resource "aws_notifications_channel_association" "pilot" {
  arn                            = aws_notificationscontacts_email_contact.pilot.arn
  notification_configuration_arn = aws_notifications_notification_configuration.pilot.arn
}
