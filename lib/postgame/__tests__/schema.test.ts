import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { POSTGAME_STAGES } from '../types';

const sql = fs
  .readFileSync(path.resolve(__dirname, '../../../db/schemas/MIGRATION_postgame_game_stages.sql'), 'utf8')
  .replace(/\r\n/g, '\n');
const sql13f3 = fs
  .readFileSync(
    path.resolve(__dirname, '../../../db/schemas/MIGRATION_postgame_game_stages_13f3.sql'),
    'utf8'
  )
  .replace(/\r\n/g, '\n');

describe('analytics.postgame_game_stages schema', () => {
  it('is grain (game_id, stage) with the five postgame stages only', () => {
    expect(sql).toContain('constraint postgame_game_stages_pk primary key (game_id, stage)');
    for (const stage of POSTGAME_STAGES) {
      expect(sql).toContain(`'${stage}'`);
    }
    expect(sql).not.toMatch(/'role'/);
    expect(sql).not.toMatch(/'injuries'/);
    expect(sql).not.toMatch(/'odds'/);
    expect(sql).not.toMatch(/'props'/);
    expect(sql).not.toMatch(/market_movement/);
  });

  it('uses the compact status vocabulary and stores no payloads', () => {
    for (const status of [
      'WAITING',
      'QUEUED',
      'RUNNING',
      'READY',
      'BLOCKED',
      'EXPECTED_ABSENCE',
      'FAILED',
    ]) {
      expect(sql).toContain(`'${status}'`);
    }
    expect(sql).not.toMatch(/jsonb/i);
    expect(sql).not.toMatch(/stack_trace/i);
    expect(sql).not.toMatch(/^\s*grant\s+/im);
    expect(sql).toContain('Do not GRANT to anon');
  });

  it('13F.3 additive columns stay unapplied comments and do not drop the table', () => {
    expect(sql13f3).toContain('last_attempt_at');
    expect(sql13f3).toContain('next_attempt_at');
    expect(sql13f3).toContain('Do not apply to production in this step');
    expect(sql13f3).not.toMatch(/drop table/i);
  });
});
