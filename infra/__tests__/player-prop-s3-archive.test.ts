import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(rel: string): string {
  return fs.readFileSync(path.resolve(__dirname, rel), 'utf8').replace(/\r\n/g, '\n');
}

describe('player-prop S3 archive IAM / flags', () => {
  it('grants worker PutObject+GetObject on the snapshot prefix only, with no DeleteObject', () => {
    const iam = read('../iam.tf');
    const start = iam.indexOf('resource "aws_iam_role_policy" "lambda_player_props_worker_s3_archive"');
    expect(start).toBeGreaterThan(-1);
    const next = iam.indexOf('\nresource "', start + 10);
    const block = iam.slice(start, next === -1 ? undefined : next);
    expect(block).toContain('s3:PutObject');
    expect(block).toContain('s3:GetObject');
    expect(block).toContain('entity=player_prop_snapshots');
    expect(block).toContain('source=balldontlie');
    expect(block).not.toContain('s3:DeleteObject');
    expect(block).not.toContain('s3:*');
    expect(block).toMatch(/count\s*=\s*var\.nba_data_bucket_name\s*!=\s*""\s*\?\s*1\s*:\s*0/);
  });

  it('defaults archive writing off and does not enable the props schedule', () => {
    const vars = read('../variables.tf');
    expect(vars).toMatch(
      /variable "player_prop_s3_archive_enabled"[\s\S]*?default\s*=\s*false/
    );
    expect(vars).toMatch(/variable "player_props_enable_schedule"[\s\S]*?default\s*=\s*false/);
    const lambda = read('../lambda.tf');
    expect(lambda).toContain('PLAYER_PROP_S3_ARCHIVE_ENABLED');
    expect(lambda).toContain('NBA_DATA_BUCKET');
    expect(lambda).toContain('NBA_RAW_PREFIX');
  });

  it('alarms on WorkerBatch ArchiveGap without treating missing metrics as breaching', () => {
    const mon = read('../monitoring.tf');
    expect(mon).toContain('resource "aws_cloudwatch_metric_alarm" "player_props_archive_gap"');
    expect(mon).toContain('metric_name         = "ArchiveGap"');
    expect(mon).toContain('Component = "WorkerBatch"');
    const start = mon.indexOf('resource "aws_cloudwatch_metric_alarm" "player_props_archive_gap"');
    const next = mon.indexOf('\nresource "', start + 10);
    const block = mon.slice(start, next === -1 ? undefined : next);
    expect(block).toContain('treat_missing_data  = "notBreaching"');
  });
});
