# IAM role for Lambda execution (CloudWatch logs only; no VPC for Supabase).
resource "aws_iam_role" "lambda_nightly_bdl_execution" {
  name = "${var.lambda_function_name}-execution-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_basic_execution" {
  role       = aws_iam_role.lambda_nightly_bdl_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# -----------------------------------------------------------------------------
# IAM role for odds-pre-game-snapshot Lambda
# -----------------------------------------------------------------------------
resource "aws_iam_role" "lambda_odds_execution" {
  name = "${var.odds_lambda_function_name}-execution-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_odds_basic_execution" {
  role       = aws_iam_role.lambda_odds_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# -----------------------------------------------------------------------------
# IAM role for injuries-snapshot Lambda
# -----------------------------------------------------------------------------
resource "aws_iam_role" "lambda_injuries_execution" {
  name = "${var.injuries_lambda_function_name}-execution-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_injuries_basic_execution" {
  role       = aws_iam_role.lambda_injuries_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# -----------------------------------------------------------------------------
# IAM role for player-props ingestion Lambda
# -----------------------------------------------------------------------------
resource "aws_iam_role" "lambda_player_props_execution" {
  name = "${var.player_props_lambda_function_name}-execution-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_player_props_basic_execution" {
  role       = aws_iam_role.lambda_player_props_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# -----------------------------------------------------------------------------
# IAM role for EventBridge Scheduler to invoke player-props Lambda
# -----------------------------------------------------------------------------
resource "aws_iam_role" "scheduler_player_props_invoke" {
  name = "nba-player-props-schedule-invoke-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "scheduler.events.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy" "scheduler_player_props_invoke_lambda" {
  name = "invoke-player-props-lambda"
  role = aws_iam_role.scheduler_player_props_invoke.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "lambda:InvokeFunction"
        Resource = aws_lambda_function.player_props_ingestion.arn
      }
    ]
  })
}
