# NBA Analytics - Terraform root
# Manages AWS infrastructure for Lambda functions (stats, odds, props, injuries).
#
# Backend: local state by default. To use remote state later, uncomment and configure:
# terraform {
#   backend "s3" {
#     bucket = "your-terraform-state-bucket"
#     key    = "nba-analytics/infra.tfstate"
#     region = "us-east-1"
#   }
# }

terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
  }
}
