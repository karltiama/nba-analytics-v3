import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../..');

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function block(src: string, header: string): string {
  const start = src.indexOf(header);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = src.indexOf('\nresource "', start + 10);
  return src.slice(start, next === -1 ? undefined : next);
}

function variableBlock(src: string, name: string): string {
  const start = src.indexOf(`variable "${name}"`);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = src.indexOf('\nvariable "', start + 10);
  return src.slice(start, next === -1 ? undefined : next);
}

describe('player-props queue shaping (LIVE-CLOCK-P0B)', () => {
  it('event-source mapping caps in-flight workers via scaling_config', () => {
    const mapping = block(
      read('infra/lambda.tf'),
      'resource "aws_lambda_event_source_mapping" "player_props_worker_queue"'
    );
    expect(mapping).toMatch(
      /scaling_config\s*\{\s*maximum_concurrency\s*=\s*var\.player_props_worker_max_concurrency\s*\}/
    );
    expect(mapping).toMatch(/batch_size\s*=\s*1\b/);
    expect(mapping).toMatch(/enabled\s*=\s*local\.family_schedule_enabled\.player_props/);
  });

  it('max concurrency defaults to 2 and is validated to the 2-4 range', () => {
    const v = variableBlock(read('infra/variables.tf'), 'player_props_worker_max_concurrency');
    expect(v).toMatch(/type\s*=\s*number/);
    expect(v).toMatch(/default\s*=\s*2\b/);
    expect(v).toMatch(/>=\s*2\s*&&\s*var\.player_props_worker_max_concurrency\s*<=\s*4/);
  });

  it('queue visibility, redrive count and limiter defaults are unchanged', () => {
    const lambda = read('infra/lambda.tf');
    const queue = block(lambda, 'resource "aws_sqs_queue" "player_props_game_queue"');
    expect(queue).toMatch(/visibility_timeout_seconds\s*=\s*max\(180,\s*var\.player_props_lambda_timeout\s*\+\s*30\)/);
    expect(queue).toMatch(/maxReceiveCount\s*=\s*4\b/);
    const limiter = read('infra/bdl-rate-limit.tf');
    expect(limiter.match(/variable "bdl_rate_limit_interval_ms"[\s\S]*?default\s*=\s*(\d+)/)?.[1]).toBe('13000');
  });

  it('shaping does not touch schedules or reserved-concurrency gating', () => {
    const vars = read('infra/variables.tf');
    expect(vars.match(/variable "player_props_apply_reserved_concurrency"[\s\S]*?default\s*=\s*(true|false)/)?.[1]).toBe(
      'false'
    );
    const mapping = block(
      read('infra/lambda.tf'),
      'resource "aws_lambda_event_source_mapping" "player_props_worker_queue"'
    );
    expect(mapping).not.toMatch(/aws_scheduler_schedule/);
  });
});
