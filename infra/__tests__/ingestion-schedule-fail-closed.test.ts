import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../..');

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
}

const SCHEDULE_RESOURCES = [
  'aws_cloudwatch_event_rule" "nightly_bdl_schedule',
  'aws_cloudwatch_event_rule" "odds_schedule',
  'aws_cloudwatch_event_rule" "injuries_schedule',
  'aws_cloudwatch_event_rule" "boxscore_schedule',
  'aws_scheduler_schedule" "player_props_crons',
  'aws_scheduler_schedule" "player_props_rate',
] as const;

function resourceBlock(src: string, marker: string): string {
  const start = src.indexOf(`resource "${marker}`);
  expect(start, marker).toBeGreaterThanOrEqual(0);
  const next = src.indexOf('\nresource "', start + 10);
  return src.slice(start, next === -1 ? undefined : next);
}

describe('ingestion schedule fail-closed (frozen configuration)', () => {
  it('live_ingestion_enabled defaults to false', () => {
    const src = read('infra/variables.tf');
    const block = src.match(/variable "live_ingestion_enabled"[\s\S]*?default\s*=\s*(true|false)/);
    expect(block?.[1]).toBe('false');
  });

  it('maps the master switch to DISABLED unless explicitly authorized', () => {
    const src = read('infra/lambda.tf');
    expect(src).toMatch(
      /ingestion_schedule_state\s*=\s*var\.live_ingestion_enabled\s*\?\s*"ENABLED"\s*:\s*"DISABLED"/
    );
  });

  it('does not hardcode ENABLED on any EventBridge or Scheduler resource', () => {
    const src = read('infra/lambda.tf');
    expect(src).not.toMatch(/state\s*=\s*"ENABLED"/);
  });

  it('every BDL and related ingestion schedule resource uses the master state', () => {
    const src = read('infra/lambda.tf');
    for (const marker of SCHEDULE_RESOURCES) {
      const block = resourceBlock(src, marker);
      expect(block, marker).toMatch(/state\s*=\s*local\.ingestion_schedule_state/);
    }
  });

  it('includes EventBridge Scheduler props rules in the same audit', () => {
    const src = read('infra/lambda.tf');
    expect(src).toMatch(/resource "aws_scheduler_schedule" "player_props_crons"/);
    expect(src).toMatch(/resource "aws_scheduler_schedule" "player_props_rate"/);
    expect(resourceBlock(src, 'aws_scheduler_schedule" "player_props_crons')).toMatch(
      /state\s*=\s*local\.ingestion_schedule_state/
    );
    expect(resourceBlock(src, 'aws_scheduler_schedule" "player_props_rate')).toMatch(
      /state\s*=\s*local\.ingestion_schedule_state/
    );
  });

  it('example tfvars stay frozen at the master switch', () => {
    const example = read('infra/terraform.tfvars.example');
    expect(example).toMatch(/^\s*live_ingestion_enabled\s*=\s*false\s*$/m);
    expect(example).not.toMatch(/^\s*live_ingestion_enabled\s*=\s*true\s*$/m);
  });
});

describe('ingestion schedule activation configuration', () => {
  it('only live_ingestion_enabled can resolve ENABLED', () => {
    const src = read('infra/lambda.tf');
    const assigns = [...src.matchAll(/^\s*state\s*=\s*([^\n]+)/gm)].map((m) => m[1].trim());
    expect(assigns.length).toBeGreaterThanOrEqual(SCHEDULE_RESOURCES.length);
    expect(assigns.every((line) => line === 'local.ingestion_schedule_state')).toBe(true);
  });

  it('per-family enable flags cannot silently thaw state on an unrelated apply', () => {
    const src = read('infra/lambda.tf');
    const nightly = resourceBlock(src, 'aws_cloudwatch_event_rule" "nightly_bdl_schedule');
    const odds = resourceBlock(src, 'aws_cloudwatch_event_rule" "odds_schedule');
    const injuries = resourceBlock(src, 'aws_cloudwatch_event_rule" "injuries_schedule');
    const props = resourceBlock(src, 'aws_scheduler_schedule" "player_props_crons');

    expect(nightly).toMatch(/count\s*=\s*var\.enable_schedule/);
    expect(nightly).toMatch(/state\s*=\s*local\.ingestion_schedule_state/);
    expect(nightly).not.toMatch(/state\s*=\s*var\.enable_schedule/);

    expect(odds).toMatch(/count\s*=\s*length\(local\.odds_crons\)/);
    expect(odds).toMatch(/state\s*=\s*local\.ingestion_schedule_state/);
    expect(odds).not.toMatch(/state\s*=\s*var\.odds_enable_schedule/);

    expect(injuries).toMatch(/count\s*=\s*var\.injuries_enable_schedule/);
    expect(injuries).not.toMatch(/state\s*=\s*var\.injuries_enable_schedule/);

    expect(props).toMatch(/count\s*=\s*var\.player_props_enable_schedule/);
    expect(props).not.toMatch(/state\s*=\s*var\.player_props_enable_schedule/);
  });
});
