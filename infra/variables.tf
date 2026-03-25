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
  description = "Set to true to create EventBridge rule(s) for the odds Lambda."
  type        = bool
  default     = false
}

variable "odds_schedule_cron" {
  description = "Single cron expression (UTC). Used when odds_schedule_crons is empty. Example: cron(0 14 * * ? *) = 09:00 ET."
  type        = string
  default     = "cron(0 14 * * ? *)"
}

variable "odds_schedule_crons" {
  description = "List of cron expressions (UTC) for multiple runs, e.g. every 30 min 10am-12pm ET. When non-empty, this is used instead of odds_schedule_cron. Example: [\"cron(0 15 * * ? *)\", \"cron(30 15 * * ? *)\", \"cron(0 16 * * ? *)\", \"cron(30 16 * * ? *)\", \"cron(0 17 * * ? *)\"]."
  type        = list(string)
  default     = []
}

# -----------------------------------------------------------------------------
# Lambda: injuries-snapshot
# -----------------------------------------------------------------------------
variable "injuries_lambda_function_name" {
  description = "Name of the injuries snapshot Lambda function."
  type        = string
  default     = "injuries-snapshot"
}

variable "injuries_lambda_timeout" {
  description = "Injuries Lambda timeout in seconds."
  type        = number
  default     = 120
}

variable "injuries_lambda_memory_size" {
  description = "Injuries Lambda memory size in MB."
  type        = number
  default     = 256
}

variable "injuries_lambda_env" {
  description = "Environment variables for the injuries Lambda (SUPABASE_DB_URL, BALLDONTLIE_API_KEY). Do not commit real values."
  type        = map(string)
  default     = {}
  sensitive   = true
}

variable "injuries_enable_schedule" {
  description = "Set to true to create an EventBridge rule for the injuries Lambda."
  type        = bool
  default     = false
}

variable "injuries_schedule_cron" {
  description = "Cron expression for injuries Lambda (UTC). Example: cron(0 13,18,22 * * ? *) = 2-3x daily."
  type        = string
  default     = "cron(0 13,18,22 * * ? *)"
}

# -----------------------------------------------------------------------------
# Lambda: player-props ingestion (nba-player-props-ingestion-lambda)
# EventBridge Scheduler: nba-player-props-schedule (every 30 min; flexible time window OFF).
# Optional: add a second schedule later for pregame-only (e.g. every 15 min before tip).
# -----------------------------------------------------------------------------
variable "player_props_lambda_function_name" {
  description = "Name of the player props ingestion Lambda function."
  type        = string
  default     = "nba-player-props-ingestion-lambda"
}

variable "player_props_lambda_timeout" {
  description = "Player props worker Lambda timeout in seconds."
  type        = number
  default     = 600
}

variable "player_props_lambda_memory_size" {
  description = "Player props worker Lambda memory size in MB."
  type        = number
  default     = 512
}

variable "player_props_lambda_env" {
  description = "Environment variables for the player props worker Lambda (BALLDONTLIE_API_KEY, SUPABASE_DB_URL). Do not commit real values."
  type        = map(string)
  default     = {}
  sensitive   = true
}

variable "player_props_controller_function_name" {
  description = "Name of the player props controller Lambda function."
  type        = string
  default     = "nba-player-props-controller-lambda"
}

variable "player_props_controller_timeout" {
  description = "Player props controller Lambda timeout in seconds."
  type        = number
  default     = 120
}

variable "player_props_controller_memory_size" {
  description = "Player props controller Lambda memory size in MB."
  type        = number
  default     = 256
}

variable "player_props_controller_env" {
  description = "Environment variables for the player props controller Lambda (SUPABASE_DB_URL). Do not commit real values."
  type        = map(string)
  default     = {}
  sensitive   = true
}

variable "player_props_worker_reserved_concurrency" {
  description = "Reserved concurrency for player props worker Lambda."
  type        = number
  default     = 4
}

variable "player_props_enable_schedule" {
  description = "Set to true to create EventBridge Scheduler schedule for the player props Lambda (e.g. every 30 min)."
  type        = bool
  default     = false
}

variable "player_props_schedule_timezone" {
  description = "Timezone for EventBridge Scheduler cron expressions for player props (e.g. America/New_York)."
  type        = string
  default     = "America/New_York"
}

variable "player_props_schedule_expression" {
  description = "Schedule expression for EventBridge Scheduler when player_props_schedule_crons is empty. Use rate(30 minutes) for every 30 min. Flexible time window is disabled."
  type        = string
  default     = "rate(30 minutes)"
}

variable "player_props_schedule_crons" {
  description = "Optional list of cron expressions for player props. Interpreted using player_props_schedule_timezone. When non-empty, this is used instead of player_props_schedule_expression (one schedule per cron). Example for every 15 minutes from 12:00-23:59 ET: [\"cron(0/15 12-23 ? * * *)\"]."
  type        = list(string)
  default     = []
}
