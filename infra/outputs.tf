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
