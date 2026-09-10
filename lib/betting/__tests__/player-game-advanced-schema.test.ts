import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(process.cwd(), 'db/schemas/MIGRATION_player_game_advanced.sql'), 'utf8');
const script = readFileSync(
  join(process.cwd(), 'scripts/ingestion/materialize-player-game-advanced.ts'),
  'utf8'
);

describe('MIGRATION_player_game_advanced.sql', () => {
  it('uses compact game+player grain and does not store names, team, or raw JSON', () => {
    expect(sql).toContain('create table if not exists analytics.player_game_advanced');
    expect(sql).toContain('constraint player_game_advanced_pk primary key (game_id, player_id)');
    expect(sql).toContain('references analytics.games(game_id)');
    expect(sql).toContain('references analytics.players(player_id)');
    expect(sql).toContain('0–1 fraction');
    expect(sql).not.toContain('player_name');
    expect(sql).not.toContain('jsonb');
    expect(sql).not.toContain('team_id');
    expect(sql).toContain('No extra indexes');
    expect(sql).toContain('Do not ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('Do not GRANT to anon');
  });
});

describe('Advanced backfill script contract', () => {
  it('is idempotent via IS DISTINCT FROM and does not call BDL', () => {
    expect(script).toContain('is distinct from excluded.usage_percentage');
    expect(script).toContain('--i-understand-production-write');
    expect(script).toContain('--certify-only');
    expect(script).not.toContain('fetchLineupsFromBallDontLie');
    expect(script).not.toContain('BdlArchiveClient');
    expect(script).not.toContain('BALLDONTLIE');
  });
});
