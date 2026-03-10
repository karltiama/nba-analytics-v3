# AWS provider - region from variable, no hardcoded values.
provider "aws" {
  region = var.aws_region
}
