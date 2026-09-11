# Lambda
output "lambda_function_name" {
  description = "Name of the deployed Lambda function."
  value       = aws_lambda_function.nightly_bdl_updater.function_name
}

output "lambda_function_arn" {
  description = "ARN of the deployed Lambda function."
  value       = aws_lambda_function.nightly_bdl_updater.arn
}

# Optional: EventBridge schedule (only when enable_schedule is true)
output "schedule_rule_name" {
  description = "Name of the EventBridge rule (when schedule is enabled)."
  value       = var.enable_schedule ? aws_cloudwatch_event_rule.nightly_bdl_schedule[0].name : null
}

output "schedule_rule_arn" {
  description = "ARN of the EventBridge rule (when schedule is enabled)."
  value       = var.enable_schedule ? aws_cloudwatch_event_rule.nightly_bdl_schedule[0].arn : null
}

# Odds Lambda
output "odds_lambda_function_name" {
  description = "Name of the deployed odds pre-game snapshot Lambda."
  value       = aws_lambda_function.odds_pre_game_snapshot.function_name
}

output "odds_lambda_function_arn" {
  description = "ARN of the deployed odds pre-game snapshot Lambda."
  value       = aws_lambda_function.odds_pre_game_snapshot.arn
}

output "odds_schedule_rule_names" {
  description = "Names of the EventBridge rules for odds (when odds schedule is enabled)."
  value       = length(local.odds_crons) > 0 ? aws_cloudwatch_event_rule.odds_schedule[*].name : []
}

output "odds_schedule_rule_arns" {
  description = "ARNs of the EventBridge rules for odds (when odds schedule is enabled)."
  value       = length(local.odds_crons) > 0 ? aws_cloudwatch_event_rule.odds_schedule[*].arn : []
}

# Injuries Lambda (when injuries_enable_schedule is true)
output "injuries_schedule_rule_name" {
  description = "Name of the EventBridge rule for injuries Lambda (when schedule is enabled)."
  value       = var.injuries_enable_schedule ? aws_cloudwatch_event_rule.injuries_schedule[0].name : null
}

output "injuries_schedule_rule_arn" {
  description = "ARN of the EventBridge rule for injuries Lambda (when schedule is enabled)."
  value       = var.injuries_enable_schedule ? aws_cloudwatch_event_rule.injuries_schedule[0].arn : null
}

# Player props ingestion Lambda (EventBridge Scheduler)
output "player_props_lambda_function_name" {
  description = "Name of the player props worker Lambda."
  value       = aws_lambda_function.player_props_worker.function_name
}

output "player_props_lambda_function_arn" {
  description = "ARN of the player props worker Lambda."
  value       = aws_lambda_function.player_props_worker.arn
}

output "player_props_controller_function_name" {
  description = "Name of the player props controller Lambda."
  value       = aws_lambda_function.player_props_controller.function_name
}

output "player_props_controller_function_arn" {
  description = "ARN of the player props controller Lambda."
  value       = aws_lambda_function.player_props_controller.arn
}

output "player_props_game_queue_url" {
  description = "SQS queue URL for per-game player props jobs."
  value       = aws_sqs_queue.player_props_game_queue.id
}

output "player_props_game_dlq_url" {
  description = "SQS dead-letter queue URL for failed game jobs."
  value       = aws_sqs_queue.player_props_dlq.id
}

output "player_props_schedule_name" {
  description = "Name of the EventBridge Scheduler schedule (when player_props_enable_schedule is true)."
  value = var.player_props_enable_schedule ? (
    length(var.player_props_schedule_crons) > 0
    ? aws_scheduler_schedule.player_props_crons[0].name
    : aws_scheduler_schedule.player_props_rate[0].name
  ) : null
}

output "player_props_worker_failures_alarm_name" {
  description = "CloudWatch alarm name for worker failures."
  value       = aws_cloudwatch_metric_alarm.player_props_worker_failures.alarm_name
}

output "player_props_controller_low_coverage_alarm_name" {
  description = "CloudWatch alarm name for low queued-game coverage."
  value       = aws_cloudwatch_metric_alarm.player_props_controller_low_coverage.alarm_name
}

output "boxscore_lambda_function_name" {
  description = "Name of the boxscore scraper Lambda."
  value       = aws_lambda_function.boxscore_scraper.function_name
}

output "boxscore_lambda_function_arn" {
  description = "ARN of the boxscore scraper Lambda."
  value       = aws_lambda_function.boxscore_scraper.arn
}

output "boxscore_schedule_rule_name" {
  description = "Name of the EventBridge rule for boxscore (when schedule is enabled)."
  value       = var.boxscore_enable_schedule ? aws_cloudwatch_event_rule.boxscore_schedule[0].name : null
}

output "boxscore_schedule_rule_arn" {
  description = "ARN of the EventBridge rule for boxscore (when schedule is enabled)."
  value       = var.boxscore_enable_schedule ? aws_cloudwatch_event_rule.boxscore_schedule[0].arn : null
}

output "nightly_bdl_errors_alarm_name" {
  description = "CloudWatch alarm name for nightly-bdl-updater invocation errors."
  value       = aws_cloudwatch_metric_alarm.nightly_bdl_errors.alarm_name
}

output "odds_pre_game_errors_alarm_name" {
  description = "CloudWatch alarm name for odds-pre-game-snapshot invocation errors."
  value       = aws_cloudwatch_metric_alarm.odds_pre_game_errors.alarm_name
}

output "boxscore_scraper_errors_alarm_name" {
  description = "CloudWatch alarm name for boxscore-scraper invocation errors."
  value       = aws_cloudwatch_metric_alarm.boxscore_scraper_errors.alarm_name
}

output "injuries_snapshot_errors_alarm_name" {
  description = "CloudWatch alarm name for injuries-snapshot invocation errors."
  value       = aws_cloudwatch_metric_alarm.injuries_snapshot_errors.alarm_name
}

output "player_props_dlq_not_empty_alarm_name" {
  description = "CloudWatch alarm name for player props DLQ depth. CODE_ONLY until authorized apply."
  value       = aws_cloudwatch_metric_alarm.player_props_dlq_not_empty.alarm_name
}

output "game_status_sync_errors_alarm_name" {
  description = "CloudWatch alarm name for game-status-sync invocation errors when created."
  value       = var.game_status_sync_create ? aws_cloudwatch_metric_alarm.game_status_sync_errors[0].alarm_name : null
}

output "postgame_stage_queue_url" {
  description = "SQS queue URL for per-game postgame stage jobs when postgame_create is true."
  value       = var.postgame_create ? aws_sqs_queue.postgame_stage_queue[0].id : null
}

output "postgame_stage_dlq_url" {
  description = "SQS dead-letter queue URL for postgame stage jobs when postgame_create is true."
  value       = var.postgame_create ? aws_sqs_queue.postgame_stage_dlq[0].id : null
}

output "postgame_stage_worker_function_name" {
  description = "Postgame stage worker Lambda name when postgame_create is true."
  value       = var.postgame_create ? aws_lambda_function.postgame_stage_worker[0].function_name : null
}

output "postgame_stage_worker_event_source_enabled" {
  description = "Whether the postgame SQS event source mapping would be enabled. Requires live_ingestion_enabled AND postgame_execution_enabled."
  value       = local.family_schedule_enabled.postgame
}
