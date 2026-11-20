# One storage-admission reservation ledger.
# Prepared for the scoreboard-recovery apply. Do not apply until that apply is explicitly approved.
# This is the table named by STORAGE_RESERVATION_TABLE_NAME. Do not add a second ledger,
# a stream, a TTL, or point-in-time recovery. No schedule is created here.

variable "storage_reservation_table_name" {
  description = "DynamoDB table for the single storage-admission reservation ledger. Separate from the BDL rate-limit table and the cluster measurement table."
  type        = string
  default     = "nba-storage-admission"
}

resource "aws_dynamodb_table" "storage_admission" {
  name         = var.storage_reservation_table_name
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
}

output "storage_reservation_table_name" {
  description = "DynamoDB table for the storage-admission reservation ledger. Not applied until a reviewed plan."
  value       = aws_dynamodb_table.storage_admission.name
}
