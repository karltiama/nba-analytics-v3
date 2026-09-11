# 13F.2 postgame SQS foundation. Queue + DLQ.
# Creation (postgame_create) is independent of activation.
# Baseline frozen plan: postgame_create=false → no AWS resources.

variable "postgame_queue_visibility_timeout" {
  description = "SQS visibility timeout for future postgame stage messages. No consumer is attached in 13F.2."
  type        = number
  default     = 180
}

resource "aws_sqs_queue" "postgame_stage_dlq" {
  count                     = var.postgame_create ? 1 : 0
  name                      = "nba-postgame-stage-dlq"
  message_retention_seconds = 1209600
}

resource "aws_sqs_queue" "postgame_stage_queue" {
  count                      = var.postgame_create ? 1 : 0
  name                       = "nba-postgame-stage-queue"
  visibility_timeout_seconds = var.postgame_queue_visibility_timeout
  message_retention_seconds  = 86400
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.postgame_stage_dlq[0].arn
    maxReceiveCount     = 4
  })
}
