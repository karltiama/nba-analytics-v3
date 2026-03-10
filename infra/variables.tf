# -----------------------------------------------------------------------------
# Region & general
# -----------------------------------------------------------------------------
variable "aws_region" {
  description = "AWS region for all resources."
  type        = string
  default     = "us-east-1"
}

# -----------------------------------------------------------------------------
# Lambda: nightly-bdl-updater
# -----------------------------------------------------------------------------
variable "lambda_function_name" {
  description = "Name of the Lambda function (nightly-bdl-updater)."
  type        = string
  default     = "nightly-bdl-updater"
}

variable "lambda_timeout" {
  description = "Lambda timeout in seconds."
  type        = number
  default     = 300
}

variable "lambda_memory_size" {
  description = "Lambda memory size in MB."
  type        = number
  default     = 512
}

variable "lambda_env" {
  description = "Environment variables for the Lambda. Set SUPABASE_DB_URL and BALLDONTLIE_API_KEY via tfvars or TF_VAR_lambda_env (do not commit real values)."
  type        = map(string)
  default     = {}
  sensitive   = true
}

# -----------------------------------------------------------------------------
# EventBridge schedule (optional)
# -----------------------------------------------------------------------------
variable "enable_schedule" {
  description = "Set to true to create an EventBridge rule that invokes the Lambda on a schedule."
  type        = bool
  default     = false
}

variable "schedule_cron" {
  description = "Cron expression for the schedule (UTC). Example: cron(0 8 * * ? *) = daily at 08:00 UTC."
  type        = string
  default     = "cron(0 8 * * ? *)"
}
