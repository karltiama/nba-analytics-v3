/**
 * CloudWatch Logs Insights snippets for operators. Not executed by /ops.
 * Missed-run while ACTIVE is evaluated in app/ops (cadence + grace), not CloudWatch.
 */

export const CLOUDWATCH_QUERIES = {
  bdlThrottle: `fields @timestamp, evt, worker, waitMs, status, retryAfter
| filter evt = "bdl_throttle"
| stats count(*) as events,
        sum(permitsGranted) as permits,
        avg(waitMs) as avgWaitMs,
        sum(status = 429) as count429
  by worker
| sort events desc`,
  lambdaErrors: `fields @timestamp, @logStream, @message
| filter @message like /ERROR|Unhandled|Task timed out/
| sort @timestamp desc
| limit 50`,
  ingestionRun: `fields @timestamp, event, job, status, inputCount, outputCount, skippedCount, quarantinedCount, durationMs
| filter event = "ingestion_run"
| sort @timestamp desc
| limit 50`,
  identityEvents: `fields @timestamp, event, provider, source_context, provider_player_id
| filter event in ["identity_resolved", "identity_not_serving", "identity_unresolved", "identity_conflict"]
| stats count(*) by event
| sort event`,
} as const;
