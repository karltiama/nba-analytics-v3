import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
}

describe('postgame SQS foundation (13I.2 creation boundary)', () => {
  it('create defaults false and is independent of live_ingestion_enabled', () => {
    const vars = read('variables.tf');
    expect(vars).toMatch(/variable "postgame_create"[\s\S]*?default\s*=\s*false/);
  });

  it('defines queue + DLQ gated on postgame_create without a schedule', () => {
    const src = read('postgame.tf');
    expect(src).toContain('resource "aws_sqs_queue" "postgame_stage_queue"');
    expect(src).toContain('resource "aws_sqs_queue" "postgame_stage_dlq"');
    expect(src).toMatch(/count\s*=\s*var\.postgame_create \? 1 : 0/);
    expect(src).toContain('nba-postgame-stage-queue');
    expect(src).not.toMatch(/aws_scheduler_schedule/);
    expect(src).not.toMatch(/aws_cloudwatch_event_rule/);
    expect(src).not.toMatch(/state\s*=\s*"ENABLED"/);
  });

  it('worker ESM is fail-closed on live AND family execution and has no reserved concurrency', () => {
    const src = read('postgame-worker.tf');
    expect(src).toContain('resource "aws_lambda_function" "postgame_stage_worker"');
    expect(src).toContain('resource "aws_lambda_event_source_mapping" "postgame_stage_worker_queue"');
    expect(src).toMatch(/count\s*=\s*var\.postgame_create \? 1 : 0/);
    expect(src).toMatch(/batch_size\s*=\s*1/);
    expect(src).toMatch(/enabled\s*=\s*local\.family_schedule_enabled\.postgame/);
    expect(src).not.toMatch(/enabled\s*=\s*var\.live_ingestion_enabled\s*$/m);
    expect(src).not.toMatch(/^\s*reserved_concurrent_executions\s*=/m);
    expect(src).not.toMatch(/aws_scheduler_schedule/);
    expect(src).not.toMatch(/aws_cloudwatch_event_rule/);
    expect(src).toContain('sqs:ReceiveMessage');
    expect(src).toContain('sqs:DeleteMessage');
    expect(src).toContain('sqs:ChangeMessageVisibility');
    expect(src).toContain('sqs:GetQueueAttributes');
    expect(src).not.toMatch(/s3:\*/);
    expect(src).toContain('POSTGAME_TARGET_SEASON     = "2026"');
    expect(src).toContain('BDL_GOAT_SUBSCRIPTION      = "0"');
  });

  it('DLQ alarm follows postgame creation and is quiet when unused', () => {
    const src = read('monitoring.tf');
    expect(src).toContain('resource "aws_cloudwatch_metric_alarm" "postgame_stage_dlq_not_empty"');
    const start = src.indexOf('resource "aws_cloudwatch_metric_alarm" "postgame_stage_dlq_not_empty"');
    const next = src.indexOf('\nresource "', start + 10);
    const block = src.slice(start, next === -1 ? undefined : next);
    expect(block).toMatch(/count\s*=\s*var\.postgame_create \? 1 : 0/);
    expect(block).toMatch(/treat_missing_data\s*=\s*"notBreaching"/);
  });
});
