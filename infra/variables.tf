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

# -----------------------------------------------------------------------------
# Lambda: odds-pre-game-snapshot
# -----------------------------------------------------------------------------
variable "odds_lambda_function_name" {
  description = "Name of the odds pre-game snapshot Lambda function."
  type        = string
  default     = "odds-pre-game-snapshot"
}

variable "odds_lambda_timeout" {
  description = "Odds Lambda timeout in seconds."
  type        = number
  default     = 300
}

variable "odds_lambda_memory_size" {
  description = "Odds Lambda memory size in MB."
  type        = number
  default     = 512
}

variable "odds_lambda_env" {
  description = "Environment variables for the odds Lambda (SUPABASE_DB_URL, BALLDONTLIE_API_KEY, optional PREFERRED_VENDOR). Do not commit real values."
  type        = map(string)
  default     = {}
  sensitive   = true
}

variable "odds_enable_schedule" {
  description = "Set to true to create an EventBridge rule for the odds Lambda."
  type        = bool
  default     = false
}

variable "odds_schedule_cron" {
  description = "Cron expression for odds Lambda (UTC). Example: cron(0 14 * * ? *) = 09:00 ET. For every 30 min 10am-12pm ET use multiple rules or rate."
  type        = string
  default     = "cron(0 14 * * ? *)"
}
