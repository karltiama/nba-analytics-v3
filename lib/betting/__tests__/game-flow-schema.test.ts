import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(process.cwd(), 'db/schemas/MIGRATION_game_flow.sql'), 'utf8');
const script = readFileSync(
  join(process.cwd(), 'scripts/ingestion/materialize-game-flow-2025.ts'),
  'utf8'
);
const server = readFileSync(join(process.cwd(), 'lib/betting/historical-timeline-server.ts'), 'utf8');

describe('MIGRATION_game_flow.sql', () => {
  it('uses compact game grain and does not store names or raw event JSON', () => {
    expect(sql).toContain('create table if not exists analytics.game_flow');
    expect(sql).toContain('constraint game_flow_pk primary key (game_id)');
    expect(sql).toContain('references analytics.games(game_id)');
    expect(sql).toContain('timeline_available');
    expect(sql).toContain('score_reconciled');
    expect(sql).toContain('rotation_available');
    expect(sql).not.toContain('player_name');
    expect(sql).not.toContain('jsonb');
    expect(sql).not.toMatch(/^\s*game_valid\b/m);
    expect(sql).toContain('never a single game_valid');
    expect(sql).toContain('No extra indexes');
    expect(sql).toContain('Do not ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('Do not GRANT to anon');
  });
});

describe('game_flow backfill script contract', () => {
  it('is idempotent via IS DISTINCT FROM and does not call BDL', () => {
    expect(script).toContain('is distinct from excluded.timeline_available');
    expect(script).toContain('--i-understand-production-write');
    expect(script).toContain('--certify-only');
    expect(script).toContain("dataMode !== 'replay'");
    expect(script).not.toContain('fetchLineupsFromBallDontLie');
    expect(script).not.toContain('BdlArchiveClient');
    expect(script).not.toContain('BALLDONTLIE');
    expect(script).not.toContain('putJson');
  });
});

describe('timeline server cache policy', () => {
  it('keeps events on S3 and uses a process cache rather than a Postgres event table', () => {
    expect(server).toContain('PROCESS_CACHE_MAX');
    expect(server).toContain('readCanonicalPlaysObject');
    expect(server).toContain('next-unstable-cache-plus-process-lru');
    expect(server).not.toContain('insert into analytics.plays');
  });
});
