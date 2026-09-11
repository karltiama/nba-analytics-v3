import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../..');

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
}

describe('game-status-sync terraform (13I.2 creation boundary)', () => {
  const src = read('infra/game-status-sync.tf');
  const vars = read('infra/variables.tf');

  it('create defaults false and is independent of live_ingestion_enabled', () => {
    expect(vars).toMatch(/variable "game_status_sync_create"[\s\S]*?default\s*=\s*false/);
    expect(vars).not.toMatch(
      /variable "game_status_sync_create"[\s\S]*?var\.live_ingestion_enabled/
    );
  });

  it('Lambda/IAM/archive are gated on game_status_sync_create', () => {
    expect(src).toMatch(
      /resource "aws_lambda_function" "game_status_sync"[\s\S]*?count\s*=\s*var\.game_status_sync_create \? 1 : 0/
    );
    expect(src).toMatch(
      /resource "aws_iam_role" "lambda_game_status_sync_execution"[\s\S]*?count\s*=\s*var\.game_status_sync_create \? 1 : 0/
    );
    expect(src).toMatch(/data "archive_file" "game_status_sync"[\s\S]*?count\s*=\s*var\.game_status_sync_create \? 1 : 0/);
  });

  it('schedule uses family state and defaults to not created (Option B)', () => {
    expect(src).toMatch(/variable "game_status_sync_enable_schedule"[\s\S]*?default\s*=\s*false/);
    expect(src).toMatch(/state\s*=\s*local\.game_status_sync_schedule_state/);
    expect(src).not.toMatch(/state\s*=\s*"ENABLED"/);
    expect(src).toMatch(/schedule_expression\s*=\s*var\.game_status_sync_schedule_expression/);
    expect(src).toMatch(/default\s*=\s*"rate\(15 minutes\)"/);
    expect(src).toMatch(
      /count\s*=\s*var\.game_status_sync_create && var\.game_status_sync_enable_schedule \? 1 : 0/
    );
  });

  it('live_ingestion_enabled=false cannot enable the schedule even if create is true', () => {
    const lambdaTf = read('infra/lambda.tf');
    expect(lambdaTf).toMatch(
      /game_status_sync\s*=\s*var\.live_ingestion_enabled\s*&&\s*var\.game_status_sync_execution_enabled/
    );
    expect(src).toMatch(/state\s*=\s*local\.game_status_sync_schedule_state/);
  });

  it('zips the built .package artifact and hashes the bundle JS', () => {
    expect(src).toMatch(/source_dir\s*=\s*"\$\{path\.module\}\/\.\.\/lambda\/game-status-sync\/\.package"/);
    expect(src).toMatch(/handler\s*=\s*"dist\/index\.handler"/);
    expect(src).toMatch(/filebase64sha256\("\$\{path\.module\}\/\.\.\/lambda\/game-status-sync\/\.package\/dist\/index\.js"\)/);
    expect(src).not.toMatch(/ignore_changes\s*=\s*\[[^\]]*source_code_hash/);
    expect(src).not.toMatch(/CODE_ONLY_NOT_BUNDLED/);
  });

  it('timeout is 90s and memory is 256MB', () => {
    expect(src).toMatch(/variable "game_status_sync_lambda_timeout"[\s\S]*?default\s*=\s*90/);
    expect(src).toMatch(/variable "game_status_sync_lambda_memory_size"[\s\S]*?default\s*=\s*256/);
  });

  it('has no S3, SQS, Step Functions, or unrelated DynamoDB permissions', () => {
    expect(src).not.toMatch(/s3:/i);
    expect(src).not.toMatch(/sqs:/i);
    expect(src).not.toMatch(/states:/i);
    expect(src).toMatch(/local\.bdl_rate_limit_iam/);
  });

  it('pins STATUS_SYNC_TARGET_SEASON=2026 and does not use PINNED_ANALYTICS_SEASON', () => {
    expect(src).toMatch(/STATUS_SYNC_TARGET_SEASON\s*=\s*"2026"/);
    expect(src).not.toMatch(/PINNED_ANALYTICS_SEASON/);
    expect(src).toMatch(/BDL_RATE_LIMIT_MAX_RETRIES\s*=\s*"0"/);
  });

  it('inherits DB/BDL credentials from lambda_env without a second secret copy', () => {
    expect(src).toMatch(/SUPABASE_DB_URL\s*=\s*lookup\(var\.lambda_env,\s*"SUPABASE_DB_URL"/);
    expect(src).toMatch(/BALLDONTLIE_API_KEY\s*=\s*lookup\(var\.lambda_env,\s*"BALLDONTLIE_API_KEY"/);
    expect(src).toMatch(/var\.game_status_sync_lambda_env/);
  });

  it('status-sync live runtime is family-gated in the last env merge', () => {
    expect(src).toMatch(/local\.ingestion_freeze_defaults/);
    expect(src).toMatch(
      /LIVE_INGESTION_ENABLED\s*=\s*local\.family_schedule_enabled\.game_status_sync \? "1" : "0"/
    );
    expect(src).toMatch(
      /DATA_MODE\s*=\s*local\.family_schedule_enabled\.game_status_sync \? "live_api" : "replay"/
    );
    expect(src).toMatch(
      /OFFSEASON_MODE\s*=\s*local\.family_schedule_enabled\.game_status_sync \? "0" : "1"/
    );
    expect(src).toMatch(
      /CRON_DRY_RUN\s*=\s*local\.family_schedule_enabled\.game_status_sync \? "0" : "1"/
    );
    expect(src).not.toMatch(/LIVE_INGESTION_ENABLED\s*=\s*var\.live_ingestion_enabled \? "1" : "0"/);
  });

  it('scheduler recurring input is empty JSON, not the manual canary payload', () => {
    const start = src.indexOf('resource "aws_scheduler_schedule" "game_status_sync"');
    const block = src.slice(start, src.indexOf('\nresource "', start + 10));
    expect(block).toMatch(/input\s*=\s*"\{\}"/);
    expect(block).not.toContain('manualCanary');
    expect(block).not.toContain('STATUS_SYNC_MANUAL_CANARY');
  });

  it('other deployed Lambdas do not take live_ingestion_enabled into DATA_MODE', () => {
    const lambdaTf = read('infra/lambda.tf');
    expect(lambdaTf).not.toMatch(
      /resource "aws_lambda_function" "nightly_bdl_updater"[\s\S]*?DATA_MODE\s*=\s*local\.family_schedule_enabled/
    );
    expect(lambdaTf).not.toMatch(/LIVE_INGESTION_ENABLED\s*=\s*var\.live_ingestion_enabled/);
    expect(lambdaTf).toMatch(/enabled\s*=\s*local\.family_schedule_enabled\.player_props/);
  });

  it('ops catalog names match Terraform defaults', () => {
    const ops = read('lib/ops/aws-ingestion-resources.ts');
    expect(src).toMatch(/default\s*=\s*"game-status-sync"/);
    expect(src).toMatch(/name\s*=\s*"nba-game-status-sync-schedule"/);
    expect(ops).toMatch(/OPS_LAMBDA_STATUS_SYNC \?\? 'game-status-sync'/);
    expect(ops).toMatch(/OPS_STATUS_SYNC_SCHEDULE \?\? 'nba-game-status-sync-schedule'/);
  });
});
