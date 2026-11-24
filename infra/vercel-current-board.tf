# Read-only website role for verified current player-prop boards.
# The OIDC provider already exists for this Vercel team. This file does not create another one.
# Do not apply until a separate authorization allows production website reads.
# CURRENT_PROPS_SOURCE stays unset, so the application does not assume this role.

data "aws_iam_openid_connect_provider" "vercel_team" {
  url = "https://oidc.vercel.com/karltiamas-projects"
}

locals {
  vercel_current_board_issuer      = "oidc.vercel.com/karltiamas-projects"
  vercel_current_board_audience    = "https://vercel.com/karltiamas-projects"
  vercel_current_board_project     = "nba-analytics-v3"
  vercel_current_board_environment = "production"
  vercel_current_board_subject     = "owner:karltiamas-projects:project:${local.vercel_current_board_project}:environment:${local.vercel_current_board_environment}"
}

resource "aws_iam_role" "vercel_current_board_read" {
  count = var.nba_data_bucket_name != "" ? 1 : 0
  name  = "court-context-current-board-read-production"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "VercelProductionCurrentBoard"
        Effect = "Allow"
        Principal = {
          Federated = data.aws_iam_openid_connect_provider.vercel_team.arn
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "${local.vercel_current_board_issuer}:aud" = local.vercel_current_board_audience
            "${local.vercel_current_board_issuer}:sub" = local.vercel_current_board_subject
          }
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "vercel_current_board_read" {
  count = var.nba_data_bucket_name != "" ? 1 : 0
  name  = "current-board-get-object"
  role  = aws_iam_role.vercel_current_board_read[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "CurrentBoardPointers"
        Effect   = "Allow"
        Action   = "s3:GetObject"
        Resource = "arn:aws:s3:::${var.nba_data_bucket_name}/current/source=balldontlie/league=nba/entity=player_prop_current/game_id=*/pointer.json"
      },
      {
        Sid      = "CurrentBoardArchivesAndManifests"
        Effect   = "Allow"
        Action   = "s3:GetObject"
        Resource = "arn:aws:s3:::${var.nba_data_bucket_name}/${var.nba_raw_prefix}/source=balldontlie/league=nba/season=*/entity=player_prop_snapshots/*"
      }
    ]
  })
}

output "vercel_current_board_read_role_arn" {
  description = "Production Vercel role that can GetObject current player-prop pointers, archives, and manifests."
  value       = try(aws_iam_role.vercel_current_board_read[0].arn, null)
}
