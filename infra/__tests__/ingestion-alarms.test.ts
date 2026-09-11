import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const src = fs
  .readFileSync(path.resolve(__dirname, '../monitoring.tf'), 'utf8')
  .replace(/\r\n/g, '\n');

describe('ingestion CloudWatch alarms (13G.1)', () => {
  it('injuries-snapshot has a quiet Errors alarm', () => {
    expect(src).toContain('resource "aws_cloudwatch_metric_alarm" "injuries_snapshot_errors"');
    expect(src).toContain('nba-injuries-snapshot-errors');
    expect(src).toContain('aws_lambda_function.injuries_snapshot.function_name');
  });

  it('does not treat missing metrics as breaching while frozen', () => {
    expect(src).not.toMatch(/treat_missing_data\s*=\s*"breaching"/);
    expect(src).toMatch(/treat_missing_data\s*=\s*"notBreaching"/);
  });

  it('adds a quiet props DLQ alarm in code only', () => {
    expect(src).toContain('resource "aws_cloudwatch_metric_alarm" "player_props_dlq_not_empty"');
    expect(src).toContain('nba-player-props-dlq-not-empty');
    expect(src).toContain('aws_sqs_queue.player_props_dlq.name');
  });

  it('adds a quiet game-status-sync Errors alarm gated on create', () => {
    expect(src).toContain('resource "aws_cloudwatch_metric_alarm" "game_status_sync_errors"');
    expect(src).toContain('nba-game-status-sync-errors');
    const start = src.indexOf('resource "aws_cloudwatch_metric_alarm" "game_status_sync_errors"');
    const next = src.indexOf('\nresource "', start + 10);
    const block = src.slice(start, next === -1 ? undefined : next);
    expect(block).toMatch(/count\s*=\s*var\.game_status_sync_create \? 1 : 0/);
    expect(block).toContain('aws_lambda_function.game_status_sync[0].function_name');
  });
});
