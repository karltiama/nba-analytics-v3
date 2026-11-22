import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../..');
const lambda = fs.readFileSync(path.join(root, 'infra/lambda.tf'), 'utf8').replace(/\r\n/g, '\n');

function resource(src: string, header: string): string {
  const start = src.indexOf(header);
  expect(start, header).toBeGreaterThanOrEqual(0);
  const next = src.indexOf('\nresource "', start + header.length);
  return src.slice(start, next === -1 ? undefined : next);
}

describe('odds storage admission uses the existing ledger', () => {
  const odds = resource(lambda, 'resource "aws_lambda_function" "odds_pre_game_snapshot"');
  const policy = resource(lambda, 'resource "aws_iam_role_policy" "odds_storage_admission"');
  const schedule = resource(lambda, 'resource "aws_scheduler_schedule" "odds_15m"');

  it('points the odds function at the shared table and leaves the schedule disabled', () => {
    expect(odds).toMatch(/STORAGE_RESERVATION_TABLE\s*=\s*aws_dynamodb_table\.storage_admission\.name/);
    expect(odds).not.toMatch(/aws_dynamodb_table"\s+"/);
    expect(schedule).toContain('local.odds_schedule_state');
    expect(schedule).toContain('Do not enable.');
  });

  it('grants only the ledger read and conditional update', () => {
    expect(policy).toContain('role = aws_iam_role.lambda_odds_execution.id');
    expect(policy).toContain('dynamodb:GetItem');
    expect(policy).toContain('dynamodb:UpdateItem');
    expect(policy).toContain('Resource = aws_dynamodb_table.storage_admission.arn');
    expect(policy).not.toMatch(/dynamodb:(DeleteItem|PutItem|Query|Scan|\*)/);
    expect(policy).not.toContain('lambda_nightly_bdl_execution');
    expect(policy).not.toContain('lambda_scoreboard_execution');
    expect(policy).not.toContain('lambda_game_status_sync_execution');
  });
});
