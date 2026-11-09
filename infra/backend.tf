# Production remote state. Terraform loads this file.
# The populated object is court-context-tfstate-260029269390/nba-analytics/infra.tfstate.
# Do not point this block at an empty key, and do not run init -migrate-state again.
#
# Both machines must be Terraform 1.14.6. use_lockfile requires 1.11 or newer.

terraform {
  backend "s3" {
    bucket       = "court-context-tfstate-260029269390"
    key          = "nba-analytics/infra.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}
