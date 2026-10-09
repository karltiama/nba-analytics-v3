# Account-level BALLDONTLIE rate-limit coordination (Step 13B/13C.1).
# This module does not enable schedules.
#
# Paid-tier setting (Phase 1B.4): verified provider limit is 600 req/min. Token bucket refills
# max_requests per interval_ms up to burst, shared by every Lambda through one DynamoDB item:
#   sustained = 60000 / 500 * 1 = 120 req/min; worst 60 s window = burst + 120 = 125 (about 21% of 600).
# Concurrency does not add throughput: all workers draw from the same bucket.

variable "bdl_rate_limit_table_name" {
  description = "DynamoDB table for shared BDL token-bucket coordination."
  type        = string
  default     = "nba-bdl-rate-limit"
}

variable "bdl_rate_limit_interval_ms" {
  description = "ms to refill BDL_RATE_LIMIT_MAX_REQUESTS tokens. 500 = 120 req/min sustained, a fifth of the verified 600 req/min paid limit. 13000 restores the trial cadence. Floor 200 in worker code unless BDL_RATE_LIMIT_ALLOW_FAST=1."
  type        = number
  default     = 500
}

variable "bdl_rate_limit_max_requests" {
  description = "Tokens refilled per interval (account-wide)."
  type        = number
  default     = 1
}

variable "bdl_rate_limit_burst" {
  description = "Maximum tokens in the shared bucket (idle burst). Peak permits in any 60 s window = burst + 60000 / interval_ms * max_requests."
  type        = number
  default     = 5
}

variable "bdl_rate_limit_acquire_timeout_ms" {
  description = "How long a worker waits for a BDL permit before failing closed. Callers that pass a deadline wait less when their Lambda has less time left."
  type        = number
  default     = 90000
}

resource "aws_dynamodb_table" "bdl_rate_limit" {
  name         = var.bdl_rate_limit_table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }
}

locals {
  bdl_rate_limit_env = {
    BDL_RATE_LIMIT_BACKEND            = "dynamodb"
    BDL_RATE_LIMIT_TABLE              = aws_dynamodb_table.bdl_rate_limit.name
    BDL_RATE_LIMIT_INTERVAL_MS        = tostring(var.bdl_rate_limit_interval_ms)
    BDL_RATE_LIMIT_MAX_REQUESTS       = tostring(var.bdl_rate_limit_max_requests)
    BDL_RATE_LIMIT_BURST              = tostring(var.bdl_rate_limit_burst)
    BDL_RATE_LIMIT_ACQUIRE_TIMEOUT_MS = tostring(var.bdl_rate_limit_acquire_timeout_ms)
  }

  bdl_rate_limit_iam = {
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem"
        ]
        Resource = aws_dynamodb_table.bdl_rate_limit.arn
      }
    ]
  }
}

resource "aws_iam_role_policy" "nightly_bdl_rate_limit" {
  name   = "${var.lambda_function_name}-bdl-rate-limit"
  role   = aws_iam_role.lambda_nightly_bdl_execution.id
  policy = jsonencode(local.bdl_rate_limit_iam)
}

resource "aws_iam_role_policy" "odds_bdl_rate_limit" {
  name   = "${var.odds_lambda_function_name}-bdl-rate-limit"
  role   = aws_iam_role.lambda_odds_execution.id
  policy = jsonencode(local.bdl_rate_limit_iam)
}

resource "aws_iam_role_policy" "injuries_bdl_rate_limit" {
  name   = "${var.injuries_lambda_function_name}-bdl-rate-limit"
  role   = aws_iam_role.lambda_injuries_execution.id
  policy = jsonencode(local.bdl_rate_limit_iam)
}

resource "aws_iam_role_policy" "player_props_worker_bdl_rate_limit" {
  name   = "${var.player_props_lambda_function_name}-bdl-rate-limit"
  role   = aws_iam_role.lambda_player_props_execution.id
  policy = jsonencode(local.bdl_rate_limit_iam)
}

output "bdl_rate_limit_table_name" {
  description = "DynamoDB table used for account-level BDL rate limiting."
  value       = aws_dynamodb_table.bdl_rate_limit.name
}

output "player_props_worker_reserved_concurrency" {
  description = "Reserved concurrency actually set on the player-props worker Lambda."
  value       = aws_lambda_function.player_props_worker.reserved_concurrent_executions
}
