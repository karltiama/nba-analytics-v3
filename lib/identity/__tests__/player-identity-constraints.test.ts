import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { entityIdForNbaPlayer } from '../../roster/class-c-onboarding';
import { WILSON_BDL_ID, WILSON_NBA_ID } from '../../roster/identity-integrity';
import { entityIdForBdlPlayer } from '../../roster/player-entity-backfill';
import type { PlayerIdentityBridgeRow } from '../player-identity';

const sql = readFileSync(
  join(process.cwd(), 'db/schemas/MIGRATION_player_identity_canonical.sql'),
  'utf8'
);

function entityProviderKey(row: PlayerIdentityBridgeRow): string {
  return `${row.playerEntityId}\0${row.provider}`;
}

function providerIdKey(row: PlayerIdentityBridgeRow): string {
  return `${row.provider}\0${row.providerPlayerId}`;
}

function hasDuplicate(keys: string[]): boolean {
  return new Set(keys).size !== keys.length;
}

describe('player_provider_ids constraint contract', () => {
  it('migration adds unique (player_entity_id, provider) and keeps (provider, provider_player_id)', () => {
    expect(sql).toContain('analytics_player_provider_ids_entity_provider_uniq');
    expect(sql).toContain('unique (player_entity_id, provider)');
    expect(sql).toContain('analytics_player_provider_ids_uniq');
    expect(sql).toContain('Do not GRANT to anon');
    expect(sql).toContain('Do not ENABLE ROW LEVEL SECURITY');
    expect(sql).not.toContain('references analytics.players(player_id)');
  });

  it('rejects same entity + same provider twice', () => {
    const entity = entityIdForBdlPlayer(WILSON_BDL_ID);
    const rows: PlayerIdentityBridgeRow[] = [
      { playerEntityId: entity, provider: 'nba', providerPlayerId: WILSON_NBA_ID },
      { playerEntityId: entity, provider: 'nba', providerPlayerId: '999' },
    ];
    expect(hasDuplicate(rows.map(entityProviderKey))).toBe(true);
  });

  it('rejects same provider + provider id on two entities', () => {
    const rows: PlayerIdentityBridgeRow[] = [
      { playerEntityId: 'e-1', provider: 'nba', providerPlayerId: '111' },
      { playerEntityId: 'e-2', provider: 'nba', providerPlayerId: '111' },
    ];
    expect(hasDuplicate(rows.map(providerIdKey))).toBe(true);
  });

  it('accepts one NBA, one BDL, and one BBRef on the same canonical entity', () => {
    const entity = entityIdForNbaPlayer('1643412');
    const rows: PlayerIdentityBridgeRow[] = [
      { playerEntityId: entity, provider: 'nba', providerPlayerId: '1643412' },
      { playerEntityId: entity, provider: 'balldontlie', providerPlayerId: '555' },
      { playerEntityId: entity, provider: 'bbref', providerPlayerId: 'flemi01' },
    ];
    expect(hasDuplicate(rows.map(entityProviderKey))).toBe(false);
    expect(hasDuplicate(rows.map(providerIdKey))).toBe(false);
  });
});
