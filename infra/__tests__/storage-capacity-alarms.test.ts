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
  it('counts review lines at the warning size instead of publishing bytes', () => {
    const filter = block('aws_cloudwatch_log_metric_filter" "storage_capacity_warning');
    expect(filter).toContain('aws_cloudwatch_log_group.scoreboard[0].name');
    expect(filter).toContain('scoreboard_storage_review');
    expect(filter).toContain('$.clusterBytes >= 405000000');
    expect(filter).toContain('name      = "StorageCapacityWarning"');
    expect(filter).toContain('value     = "1"');
    expect(filter).not.toContain('default_value');
    expect(filter).not.toContain('$.clusterBytes"');
    const alarm = block('aws_cloudwatch_metric_alarm" "storage_capacity_warning');
    expect(alarm).toContain('statistic           = "Sum"');
    expect(alarm).toContain('threshold           = 1');
    expect(alarm).toContain('period              = 60');
    expect(alarm).toContain('evaluation_periods  = 3');
    expect(alarm).toContain('datapoints_to_alarm = 2');
    expect(alarm).toContain('treat_missing_data  = "notBreaching"');
    expect(alarm).toContain('alarm_actions       = local.ingestion_alarm_actions');
  });

  it('counts review lines at the critical size on a separate metric', () => {
    const filter = block('aws_cloudwatch_log_metric_filter" "storage_capacity_critical');
    const alarm = block('aws_cloudwatch_metric_alarm" "storage_capacity_critical');
    expect(filter).toContain('$.clusterBytes >= 413676672');
    expect(filter).toContain('name      = "StorageCapacityCritical"');
    expect(filter).toContain('value     = "1"');
    expect(filter).not.toContain('default_value');
    expect(alarm).toContain('metric_name         = "StorageCapacityCritical"');
    expect(alarm).toContain('statistic           = "Sum"');
    expect(alarm).toContain('threshold           = 1');
    expect(alarm).toContain('treat_missing_data  = "notBreaching"');
    expect(alarm).not.toContain('threshold           = 450000000');
    expect(alarm).not.toContain('threshold           = 400000000');
  });

  it('detects a stopped scoreboard collector without calling that database pressure', () => {
    const alarm = block('aws_cloudwatch_metric_alarm" "scoreboard_missed_invocations');
    expect(alarm).toContain('metric_name         = "Invocations"');
    expect(alarm).toContain('namespace           = "AWS/Lambda"');
    expect(alarm).toContain('aws_lambda_function.scoreboard[0].function_name');
    expect(alarm).toContain('statistic           = "Sum"');
    expect(alarm).toContain('period              = 60');
    expect(alarm).toContain('evaluation_periods  = 5');
    expect(alarm).toContain('datapoints_to_alarm = 3');
    expect(alarm).toContain('threshold           = 1');
    expect(alarm).toContain('comparison_operator = "LessThanThreshold"');
    expect(alarm).toContain('treat_missing_data  = "breaching"');
    expect(alarm).toContain('does not mean the database is too large');
    expect(alarm).toContain('local.scoreboard_schedule_state == "ENABLED"');
  });

  it('counts a nightly storage denial that can still return HTTP 200', () => {
    const filter = block('aws_cloudwatch_log_metric_filter" "nightly_storage_denied');
    const alarm = block('aws_cloudwatch_metric_alarm" "nightly_storage_denied');
    expect(filter).toContain('local.bdl_log_groups.nightly');
    expect(filter).toContain('Nightly writes denied');
    expect(filter).toContain('value     = "1"');
    expect(filter).not.toContain('default_value');
    expect(alarm).toContain('threshold           = 1');
    expect(alarm).toContain('treat_missing_data  = "notBreaching"');
    expect(alarm).toContain('HTTP 200');
    expect(alarm).toContain('alarm_actions       = local.ingestion_alarm_actions');
  });

  it('does not publish cluster bytes or add a topic, schedule, or Lambda package', () => {
    expect(src).not.toContain('PostgresClusterBytes');
    expect(src).not.toContain('value     = "$.clusterBytes"');
    expect(src).not.toContain('aws_sns_topic"');
    expect(src).not.toContain('source_code_hash');
    expect(src).not.toContain('aws_scheduler_schedule');
    expect(src).not.toContain('aws_iam_');
    expect(src).not.toContain('resource "aws_lambda_function"');
  });
});
