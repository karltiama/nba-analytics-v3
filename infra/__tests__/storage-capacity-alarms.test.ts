import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const src = fs
  .readFileSync(path.resolve(__dirname, '../storage-capacity-alarms.tf'), 'utf8')
  .replace(/\r\n/g, '\n');

function block(resource: string): string {
  const start = src.indexOf(`resource "${resource}"`);
  const next = src.indexOf('\nresource "', start + 10);
  return src.slice(start, next === -1 ? undefined : next);
}

describe('storage capacity alarms', () => {
  it('publishes the review line cluster size in bytes', () => {
    const filter = block('aws_cloudwatch_log_metric_filter" "postgres_cluster_bytes');
    expect(filter).toContain('aws_cloudwatch_log_group.scoreboard[0].name');
    expect(filter).toContain('scoreboard_storage_review');
    expect(filter).toContain('$.clusterBytes > 0');
    expect(filter).toContain('name      = "PostgresClusterBytes"');
    expect(filter).toContain('namespace = local.storage_metric_namespace');
    expect(filter).toContain('value     = "$.clusterBytes"');
    expect(filter).not.toContain('default_value');
    expect(filter).not.toContain('value     = "1"');
  });

  it('warns at 405000000 bytes and does not treat a gap as recovery', () => {
    const alarm = block('aws_cloudwatch_metric_alarm" "storage_capacity_warning');
    expect(alarm).toContain('threshold           = 405000000');
    expect(alarm).toContain('statistic           = "Maximum"');
    expect(alarm).toContain('comparison_operator = "GreaterThanOrEqualToThreshold"');
    expect(alarm).toContain('treat_missing_data  = "breaching"');
    expect(alarm).toContain('alarm_actions       = local.ingestion_alarm_actions');
    expect(alarm).toContain('period              = 60');
  });

  it('pages when the three envelopes no longer fit together', () => {
    const alarm = block('aws_cloudwatch_metric_alarm" "storage_capacity_critical');
    expect(alarm).toContain('threshold           = 413676672');
    expect(alarm).toContain('statistic           = "Maximum"');
    expect(alarm).toContain('treat_missing_data  = "breaching"');
    expect(alarm).toContain('450000000');
    expect(alarm).not.toContain('threshold           = 450000000');
    expect(alarm).not.toContain('threshold           = 400000000');
  });

  it('counts a nightly storage denial that can still return HTTP 200', () => {
    const filter = block('aws_cloudwatch_log_metric_filter" "nightly_storage_denied');
    const alarm = block('aws_cloudwatch_metric_alarm" "nightly_storage_denied');
    expect(filter).toContain('local.bdl_log_groups.nightly');
    expect(filter).toContain('Nightly writes denied');
    expect(filter).toContain('value     = "1"');
    expect(alarm).toContain('threshold           = 1');
    expect(alarm).toContain('treat_missing_data  = "notBreaching"');
    expect(alarm).toContain('HTTP 200');
    expect(alarm).toContain('alarm_actions       = local.ingestion_alarm_actions');
  });

  it('does not add a topic, schedule, or Lambda package', () => {
    expect(src).not.toContain('aws_sns_topic"');
    expect(src).not.toContain('aws_lambda_function');
    expect(src).not.toContain('source_code_hash');
    expect(src).not.toContain('aws_scheduler_schedule');
    expect(src).not.toContain('aws_iam_');
  });
});
