import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(process.cwd(), 'db/schemas/MIGRATION_player_role_profile.sql'), 'utf8');
const script = readFileSync(
  join(process.cwd(), 'scripts/ingestion/materialize-player-role-profile.ts'),
  'utf8'
);

describe('MIGRATION_player_role_profile.sql', () => {
  it('uses compact player+season grain and does not store names, team, raw JSON, or playtype gp', () => {
    expect(sql).toContain('create table if not exists analytics.player_role_profile');
    expect(sql).toContain('constraint player_role_profile_pk primary key (player_id, season)');
    expect(sql).toContain('references analytics.players(player_id)');
    expect(sql).toContain('isolation_poss_pct');
    expect(sql).toContain('pnr_ball_handler_poss_pct');
    expect(sql).toContain('0–1 share');
    expect(sql).not.toContain('player_name');
    expect(sql).not.toContain('jsonb');
    expect(sql).not.toContain('team_id');
    expect(sql).not.toMatch(/isolation_gp|playtype_gp/);
    expect(sql).toContain('Do not ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('Do not GRANT to anon');
  });
});

describe('Role Profile backfill script contract', () => {
  it('is idempotent via IS DISTINCT FROM and does not call BDL', () => {
    expect(script).toContain('is distinct from excluded.isolation_poss_pct');
    expect(script).toContain('--i-understand-production-write');
    expect(script).toContain('--certify-only');
    expect(script).not.toContain('fetchLineupsFromBallDontLie');
    expect(script).not.toContain('BdlArchiveClient');
    expect(script).not.toContain('BALLDONTLIE');
  });
});
