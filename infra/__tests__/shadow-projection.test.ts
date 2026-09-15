import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../..');

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
}

describe('shadow projection terraform (CODE_ONLY, disabled)', () => {
  it('create and execution default false', () => {
    const src = read('infra/shadow-projection.tf');
    const vars = read('infra/variables.tf');
    expect(vars).toMatch(/variable "shadow_create"[\s\S]*?default\s*=\s*false/);
    expect(vars).toMatch(/variable "shadow_execution_enabled"[\s\S]*?default\s*=\s*false/);
    expect(src).toMatch(/variable "shadow_enable_schedule"[\s\S]*?default\s*=\s*false/);
    expect(src).toMatch(/schedule_expression\s*=\s*var\.shadow_schedule_expression/);
    expect(src).toMatch(/default\s*=\s*"rate\(5 minutes\)"/);
  });

  it('schedule state is family-gated, never hardcoded ENABLED', () => {
    const src = read('infra/shadow-projection.tf');
    expect(src).toMatch(/state\s*=\s*local\.shadow_schedule_state/);
    expect(src).not.toMatch(/state\s*=\s*"ENABLED"/);
    expect(src).toMatch(/DATA_MODE\s*=\s*local\.family_schedule_enabled\.shadow \? "live_api" : "replay"/);
    expect(src).toMatch(/SHADOW_SNAPSHOT_WRITES\s*=\s*local\.family_schedule_enabled\.shadow \? "1" : "0"/);
    expect(src).toMatch(/COLLECTION_SCHEMA_MODE\s*=\s*local\.family_schedule_enabled\.shadow \? "required" : "optional"/);
  });

  it('example tfvars keep shadow flags false', () => {
    const example = read('infra/terraform.tfvars.example');
    expect(example).toMatch(/^\s*shadow_execution_enabled\s*=\s*false\s*$/m);
    expect(example).toMatch(/^\s*shadow_create\s*=\s*false\s*$/m);
    expect(example).not.toMatch(/^\s*shadow_execution_enabled\s*=\s*true\s*$/m);
  });

  it('quiet Errors alarm is gated on create and has no SNS', () => {
    const src = read('infra/monitoring.tf');
    const start = src.indexOf('resource "aws_cloudwatch_metric_alarm" "shadow_projection_errors"');
    expect(start).toBeGreaterThanOrEqual(0);
    const next = src.indexOf('\nresource "', start + 10);
    const block = src.slice(start, next === -1 ? undefined : next);
    expect(block).toMatch(/count\s*=\s*var\.shadow_create \? 1 : 0/);
    expect(block).toMatch(/treat_missing_data\s*=\s*"notBreaching"/);
    expect(block).not.toMatch(/alarm_actions/);
  });
});
