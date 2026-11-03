import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../..');

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function resource(src: string, header: string): string {
  const start = src.indexOf(header);
  expect(start, header).toBeGreaterThanOrEqual(0);
  const next = src.indexOf('\nresource "', start + header.length);
  return src.slice(start, next === -1 ? undefined : next);
}

describe('props worker limiter pin stays off the live odds function', () => {
  const lambda = read('infra/lambda.tf');
  const worker = resource(lambda, 'resource "aws_lambda_function" "player_props_worker"');
  const odds = resource(lambda, 'resource "aws_lambda_function" "odds_pre_game_snapshot"');

  it('pins the props worker after the shared limiter merge', () => {
    expect(worker).toContain('local.bdl_rate_limit_env');
    expect(worker).toMatch(/BDL_RATE_LIMIT_INTERVAL_MS\s*=\s*tostring\(var\.player_props_bdl_rate_limit_interval_ms\)/);
    expect(worker).toMatch(/BDL_RATE_LIMIT_MAX_REQUESTS\s*=\s*tostring\(var\.player_props_bdl_rate_limit_max_requests\)/);
    expect(worker).toMatch(/BDL_RATE_LIMIT_BURST\s*=\s*tostring\(var\.player_props_bdl_rate_limit_burst\)/);
    expect(worker).toMatch(/BDL_RATE_LIMIT_MAX_RETRIES\s*=\s*tostring\(var\.player_props_bdl_rate_limit_max_retries\)/);
    const intervalAt = worker.indexOf('BDL_RATE_LIMIT_INTERVAL_MS');
    const sharedAt = worker.lastIndexOf('local.bdl_rate_limit_env');
    expect(intervalAt).toBeGreaterThan(sharedAt);
    const limiter = read('infra/bdl-rate-limit.tf');
    expect(limiter.match(/variable "player_props_bdl_rate_limit_interval_ms"[\s\S]*?default\s*=\s*(\d+)/)?.[1]).toBe('13000');
    expect(limiter.match(/variable "player_props_bdl_rate_limit_max_requests"[\s\S]*?default\s*=\s*(\d+)/)?.[1]).toBe('1');
    expect(limiter.match(/variable "player_props_bdl_rate_limit_burst"[\s\S]*?default\s*=\s*(\d+)/)?.[1]).toBe('1');
    expect(limiter.match(/variable "player_props_bdl_rate_limit_max_retries"[\s\S]*?default\s*=\s*(\d+)/)?.[1]).toBe('0');
  });

  it('does not put that pin on the odds Lambda or the shared default', () => {
    expect(odds).not.toContain('player_props_bdl_rate_limit');
    expect(odds).not.toContain('"13000"');
    expect(odds).toContain('var.odds_bdl_rate_limit_interval_ms');
    expect(odds).toContain('local.bdl_rate_limit_env');
    const limiter = read('infra/bdl-rate-limit.tf');
    expect(limiter.match(/variable "bdl_rate_limit_interval_ms"[\s\S]*?default\s*=\s*(\d+)/)?.[1]).toBe('500');
    expect(limiter.match(/variable "bdl_rate_limit_burst"[\s\S]*?default\s*=\s*(\d+)/)?.[1]).toBe('5');
    expect(limiter.match(/variable "odds_bdl_rate_limit_interval_ms"[\s\S]*?default\s*=\s*(\d+)/)?.[1]).toBe('500');
    expect(limiter.match(/variable "odds_bdl_rate_limit_burst"[\s\S]*?default\s*=\s*(\d+)/)?.[1]).toBe('5');
    expect(limiter.match(/variable "scoreboard_bdl_rate_limit_interval_ms"[\s\S]*?default\s*=\s*(\d+)/)?.[1]).toBe('500');
    expect(limiter.match(/variable "game_status_sync_bdl_rate_limit_interval_ms"[\s\S]*?default\s*=\s*(\d+)/)?.[1]).toBe('500');
    expect(read('infra/scoreboard.tf')).not.toContain('"13000"');
    const nightly = resource(read('infra/lambda.tf'), 'resource "aws_lambda_function" "nightly_bdl_updater"');
    expect(nightly).not.toContain('player_props_bdl_rate_limit');
    expect(nightly).not.toContain('odds_bdl_rate_limit');
  });

  it('does not retarget odds schedules', () => {
    const oddsRule = resource(lambda, 'resource "aws_cloudwatch_event_rule" "odds_schedule"');
    expect(oddsRule).toContain('local.odds_schedule_state');
    expect(oddsRule).not.toContain('player_props');
  });

  it('packages both props functions from one zip and leaves the mapping disabled by default', () => {
    const controller = resource(lambda, 'resource "aws_lambda_function" "player_props_controller"');
    const mapping = resource(lambda, 'resource "aws_lambda_event_source_mapping" "player_props_worker_queue"');
    const variables = read('infra/variables.tf');
    expect(worker).toContain('filename                       = data.archive_file.player_props.output_path');
    expect(controller).toContain('filename         = data.archive_file.player_props.output_path');
    expect(worker).toContain('handler                        = "worker.handler"');
    expect(controller).toContain('handler          = "controller.handler"');
    expect(worker).toContain('runtime                        = "nodejs22.x"');
    expect(controller).toContain('runtime          = "nodejs22.x"');
    expect(mapping).toContain('enabled                            = local.family_schedule_enabled.player_props');
    expect(variables).toMatch(/variable "player_props_execution_enabled"[\s\S]*?default\s*=\s*false/);
    expect(variables).toMatch(/variable "player_prop_s3_archive_enabled"[\s\S]*?default\s*=\s*false/);
    expect(odds).toContain('data.archive_file.odds_pre_game.output_path');
    expect(odds).not.toContain('data.archive_file.player_props');
    expect(read('infra/scoreboard.tf')).not.toContain('data.archive_file.player_props');
    expect(read('infra/bdl-rate-limit.tf')).toContain('default     = "nba-bdl-rate-limit"');
  });
});
