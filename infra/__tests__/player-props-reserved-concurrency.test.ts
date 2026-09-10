import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../..');

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('player_props_worker reserved concurrency wiring', () => {
  it('variables.tf default is 4', () => {
    const src = read('infra/variables.tf');
    const block = src.match(
      /variable "player_props_worker_reserved_concurrency"[\s\S]*?default\s*=\s*(\d+)/
    );
    expect(block?.[1]).toBe('4');
  });

  it('aws_lambda_function.player_props_worker gates reserved concurrency behind quota apply flag', () => {
    const src = read('infra/lambda.tf');
    const start = src.indexOf('resource "aws_lambda_function" "player_props_worker"');
    const next = src.indexOf('resource "', start + 10);
    const worker = src.slice(start, next === -1 ? undefined : next);
    expect(worker.length).toBeGreaterThan(100);
    expect(worker).toMatch(
      /reserved_concurrent_executions\s*=\s*var\.player_props_apply_reserved_concurrency\s*\?\s*var\.player_props_worker_reserved_concurrency\s*:\s*null/
    );
    expect(worker).toMatch(/BDL_RATE_LIMIT_BACKEND\s*=\s*"dynamodb"/);
    expect(worker).toMatch(/BDL_RATE_LIMIT_WORKER\s*=\s*"player-props-worker"/);
  });

  it('does not apply reserved concurrency until the quota gate is true', () => {
    const src = read('infra/variables.tf');
    const block = src.match(
      /variable "player_props_apply_reserved_concurrency"[\s\S]*?default\s*=\s*(true|false)/
    );
    expect(block?.[1]).toBe('false');
  });

  it('controller does not receive reserved concurrency or the Dynamo rate-limit table', () => {
    const src = read('infra/lambda.tf');
    const start = src.indexOf('resource "aws_lambda_function" "player_props_controller"');
    const next = src.indexOf('resource "', start + 10);
    const controller = src.slice(start, next === -1 ? undefined : next);
    expect(controller.length).toBeGreaterThan(50);
    expect(controller).not.toMatch(/reserved_concurrent_executions/);
    expect(controller).not.toMatch(/BDL_RATE_LIMIT_TABLE/);
  });

  it('SQS batch size stays 1 and visibility covers worker timeout', () => {
    const src = read('infra/lambda.tf');
    expect(src).toMatch(
      /visibility_timeout_seconds\s*=\s*max\(180,\s*var\.player_props_lambda_timeout\s*\+\s*30\)/
    );
    const start = src.indexOf('resource "aws_lambda_event_source_mapping" "player_props_worker_queue"');
    const next = src.indexOf('resource "', start + 10);
    const mapping = src.slice(start, next === -1 ? undefined : next);
    expect(mapping).toMatch(/batch_size\s*=\s*1/);
  });
});

describe('centralized BDL throttle terraform', () => {
  it('creates a PAY_PER_REQUEST table with TTL and least-privilege IAM for BDL workers only', () => {
    const src = read('infra/bdl-rate-limit.tf');
    expect(src).toMatch(/resource "aws_dynamodb_table" "bdl_rate_limit"/);
    expect(src).toMatch(/billing_mode\s*=\s*"PAY_PER_REQUEST"/);
    expect(src).toMatch(/attribute_name\s*=\s*"expires_at"/);
    expect(src).toMatch(/dynamodb:GetItem/);
    expect(src).toMatch(/dynamodb:PutItem/);
    expect(src).toMatch(/dynamodb:UpdateItem/);
    expect(src).not.toMatch(/dynamodb:Scan/);
    expect(src).not.toMatch(/dynamodb:\*/);
    expect(src).toMatch(/aws_iam_role\.lambda_nightly_bdl_execution/);
    expect(src).toMatch(/aws_iam_role\.lambda_odds_execution/);
    expect(src).toMatch(/aws_iam_role\.lambda_injuries_execution/);
    expect(src).toMatch(/aws_iam_role\.lambda_player_props_execution/);
    expect(src).not.toMatch(/lambda_player_props_controller_execution/);
  });

  it('does not enable schedules in the limiter module', () => {
    const src = read('infra/bdl-rate-limit.tf');
    expect(src).not.toMatch(/aws_scheduler_schedule/);
    expect(src).not.toMatch(/enable_schedule\s*=\s*true/);
  });

  it('Terraform limiter default is the activation-canary safety interval', () => {
    const src = read('infra/bdl-rate-limit.tf');
    const interval = src.match(
      /variable "bdl_rate_limit_interval_ms"[\s\S]*?default\s*=\s*(\d+)/
    );
    const acquire = src.match(
      /variable "bdl_rate_limit_acquire_timeout_ms"[\s\S]*?default\s*=\s*(\d+)/
    );
    expect(interval?.[1]).toBe('13000');
    expect(acquire?.[1]).toBe('90000');
  });

  it('freeze defaults remain replay / offseason / dry-run', () => {
    const src = read('infra/lambda.tf');
    expect(src).toMatch(/DATA_MODE\s*=\s*"replay"/);
    expect(src).toMatch(/OFFSEASON_MODE\s*=\s*"1"/);
    expect(src).toMatch(/CRON_DRY_RUN\s*=\s*"1"/);
  });
});
