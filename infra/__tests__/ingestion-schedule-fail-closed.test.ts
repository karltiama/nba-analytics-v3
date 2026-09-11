import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../..');

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
}

const SCHEDULE_RESOURCES: Array<{ marker: string; state: string }> = [
  { marker: 'aws_cloudwatch_event_rule" "nightly_bdl_schedule', state: 'local.nightly_schedule_state' },
  { marker: 'aws_cloudwatch_event_rule" "odds_schedule', state: 'local.odds_schedule_state' },
  { marker: 'aws_cloudwatch_event_rule" "injuries_schedule', state: 'local.injuries_schedule_state' },
  { marker: 'aws_cloudwatch_event_rule" "boxscore_schedule', state: 'local.boxscore_schedule_state' },
  { marker: 'aws_scheduler_schedule" "player_props_crons', state: 'local.player_props_schedule_state' },
  { marker: 'aws_scheduler_schedule" "player_props_rate', state: 'local.player_props_schedule_state' },
];

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

  it('family execution flags default to false', () => {
    const src = read('infra/variables.tf');
    for (const name of [
      'nightly_execution_enabled',
      'odds_execution_enabled',
      'injuries_execution_enabled',
      'player_props_execution_enabled',
      'boxscore_execution_enabled',
      'game_status_sync_execution_enabled',
      'postgame_execution_enabled',
    ]) {
      const block = src.match(new RegExp(`variable "${name}"[\\s\\S]*?default\\s*=\\s*(true|false)`));
      expect(block?.[1], name).toBe('false');
    }
  });

  it('effective family execution requires live AND family flags', () => {
    const src = read('infra/lambda.tf');
    expect(src).toMatch(
      /nightly\s*=\s*var\.live_ingestion_enabled\s*&&\s*var\.nightly_execution_enabled/
    );
    expect(src).toMatch(
      /odds\s*=\s*var\.live_ingestion_enabled\s*&&\s*var\.odds_execution_enabled/
    );
    expect(src).toMatch(
      /injuries\s*=\s*var\.live_ingestion_enabled\s*&&\s*var\.injuries_execution_enabled/
    );
    expect(src).toMatch(
      /player_props\s*=\s*var\.live_ingestion_enabled\s*&&\s*var\.player_props_execution_enabled/
    );
    expect(src).toMatch(
      /boxscore\s*=\s*var\.live_ingestion_enabled\s*&&\s*var\.boxscore_execution_enabled/
    );
    expect(src).toMatch(
      /game_status_sync\s*=\s*var\.live_ingestion_enabled\s*&&\s*var\.game_status_sync_execution_enabled/
    );
    expect(src).toMatch(
      /postgame\s*=\s*var\.live_ingestion_enabled\s*&&\s*var\.postgame_execution_enabled/
    );
    expect(src).not.toMatch(
      /ingestion_schedule_state\s*=\s*var\.live_ingestion_enabled\s*\?\s*"ENABLED"\s*:\s*"DISABLED"/
    );
  });

  it('does not hardcode ENABLED on any EventBridge or Scheduler resource', () => {
    const src = read('infra/lambda.tf');
    expect(src).not.toMatch(/state\s*=\s*"ENABLED"/);
  });

  it('every BDL and related ingestion schedule resource uses its family state', () => {
    const src = read('infra/lambda.tf');
    for (const { marker, state } of SCHEDULE_RESOURCES) {
      const block = resourceBlock(src, marker);
      expect(block, marker).toMatch(new RegExp(`state\\s*=\\s*${state.replace('.', '\\.')}`));
    }
  });

  it('example tfvars stay frozen at the master switch and family flags', () => {
    const example = read('infra/terraform.tfvars.example');
    expect(example).toMatch(/^\s*live_ingestion_enabled\s*=\s*false\s*$/m);
    expect(example).not.toMatch(/^\s*live_ingestion_enabled\s*=\s*true\s*$/m);
    expect(example).toMatch(/^\s*nightly_execution_enabled\s*=\s*false\s*$/m);
    expect(example).toMatch(/^\s*game_status_sync_create\s*=\s*false\s*$/m);
    expect(example).toMatch(/^\s*postgame_create\s*=\s*false\s*$/m);
  });
});

describe('ingestion schedule activation configuration', () => {
  it('schedule state locals cannot ENABLED from global live alone', () => {
    const src = read('infra/lambda.tf');
    expect(src).toMatch(
      /nightly_schedule_state\s*=\s*local\.family_schedule_enabled\.nightly \? "ENABLED" : "DISABLED"/
    );
    expect(src).toMatch(
      /player_props_schedule_state\s*=\s*local\.family_schedule_enabled\.player_props \? "ENABLED" : "DISABLED"/
    );
  });

  it('per-family enable flags cannot silently thaw state on an unrelated apply', () => {
    const src = read('infra/lambda.tf');
    const nightly = resourceBlock(src, 'aws_cloudwatch_event_rule" "nightly_bdl_schedule');
    const odds = resourceBlock(src, 'aws_cloudwatch_event_rule" "odds_schedule');
    const injuries = resourceBlock(src, 'aws_cloudwatch_event_rule" "injuries_schedule');
    const props = resourceBlock(src, 'aws_scheduler_schedule" "player_props_crons');

    expect(nightly).toMatch(/count\s*=\s*var\.enable_schedule/);
    expect(nightly).toMatch(/state\s*=\s*local\.nightly_schedule_state/);
    expect(nightly).not.toMatch(/state\s*=\s*var\.enable_schedule/);

    expect(odds).toMatch(/count\s*=\s*length\(local\.odds_crons\)/);
    expect(odds).toMatch(/state\s*=\s*local\.odds_schedule_state/);
    expect(odds).not.toMatch(/state\s*=\s*var\.odds_enable_schedule/);

    expect(injuries).toMatch(/count\s*=\s*var\.injuries_enable_schedule/);
    expect(injuries).not.toMatch(/state\s*=\s*var\.injuries_enable_schedule/);

    expect(props).toMatch(/count\s*=\s*var\.player_props_enable_schedule/);
    expect(props).not.toMatch(/state\s*=\s*var\.player_props_enable_schedule/);
  });

  it('game-status-sync schedule uses family freeze mapping and requires create', () => {
    const src = read('infra/game-status-sync.tf');
    const start = src.indexOf('resource "aws_scheduler_schedule" "game_status_sync"');
    expect(start).toBeGreaterThanOrEqual(0);
    const block = src.slice(start);
    expect(block).toMatch(
      /count\s*=\s*var\.game_status_sync_create && var\.game_status_sync_enable_schedule \? 1 : 0/
    );
    expect(block).toMatch(/state\s*=\s*local\.game_status_sync_schedule_state/);
    expect(block).not.toMatch(/state\s*=\s*"ENABLED"/);
    expect(block).not.toMatch(/state\s*=\s*var\.game_status_sync_enable_schedule/);
  });

  it('props worker ESM follows the same freeze model as props schedules', () => {
    const src = read('infra/lambda.tf');
    const block = resourceBlock(src, 'aws_lambda_event_source_mapping" "player_props_worker_queue');
    expect(block).toMatch(/enabled\s*=\s*local\.family_schedule_enabled\.player_props/);
  });
});
