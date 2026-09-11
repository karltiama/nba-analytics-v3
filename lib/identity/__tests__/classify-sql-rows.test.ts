import { describe, expect, it } from 'vitest';
import { entityIdForNbaPlayer } from '../../roster/class-c-onboarding';
import { WILSON_BDL_ID } from '../../roster/identity-integrity';
import { entityIdForBdlPlayer } from '../../roster/player-entity-backfill';
import { classifyFromSqlRows } from '../classify-sql-rows';
import { buildPlayerIdentityIndex } from '../player-identity-resolve';
import { gateIngestIdentities } from '../ingest-identity-gate';

const wilsonEntity = entityIdForBdlPlayer(WILSON_BDL_ID);
const flemingsNba = '1643412';
const flemingsEntity = entityIdForNbaPlayer(flemingsNba);

describe('classifyFromSqlRows', () => {
  it('adds the provider id (not a fabricated id) to servingIds', () => {
    const result = classifyFromSqlRows(
      [WILSON_BDL_ID],
      [{ provider_player_id: WILSON_BDL_ID, player_entity_id: wilsonEntity }],
      [{ player_entity_id: wilsonEntity, analytics_player_id: WILSON_BDL_ID }]
    );
    expect([...result.servingIds]).toEqual([WILSON_BDL_ID]);
    expect(result.quarantine).toEqual([]);
  });

  it('Class C NBA-only without BDL projection is quarantined, not serving', () => {
    const result = classifyFromSqlRows(
      [flemingsNba],
      [{ provider_player_id: flemingsNba, player_entity_id: flemingsEntity }],
      []
    );
    expect(result.servingIds.size).toBe(0);
    expect(result.quarantine).toEqual([{ providerPlayerId: flemingsNba, status: 'UNRESOLVED' }]);
  });

  it('unknown ids are unresolved; conflicts stay distinct', () => {
    const result = classifyFromSqlRows(
      ['1630811', '111', WILSON_BDL_ID],
      [
        { provider_player_id: '111', player_entity_id: 'e-a' },
        { provider_player_id: '111', player_entity_id: 'e-b' },
        { provider_player_id: WILSON_BDL_ID, player_entity_id: wilsonEntity },
      ],
      [{ player_entity_id: wilsonEntity, analytics_player_id: WILSON_BDL_ID }]
    );
    expect(result.servingIds.has(WILSON_BDL_ID)).toBe(true);
    expect(result.quarantine).toEqual([
      { providerPlayerId: '1630811', status: 'UNRESOLVED' },
      { providerPlayerId: '111', status: 'CONFLICT' },
    ]);
  });

  it('matches the in-memory gate serving split for BDL payloads', () => {
    const ids = [WILSON_BDL_ID, '999999'];
    const index = buildPlayerIdentityIndex({
      bridges: [
        {
          playerEntityId: wilsonEntity,
          provider: 'balldontlie',
          providerPlayerId: WILSON_BDL_ID,
        },
      ],
      projections: [{ playerEntityId: wilsonEntity, analyticsPlayerId: WILSON_BDL_ID }],
    });
    const gate = gateIngestIdentities({
      provider: 'balldontlie',
      sourceContext: 'INJURY',
      providerPlayerIds: ids,
      index,
      observedAt: '2026-09-10T00:00:00.000Z',
    });
    const sql = classifyFromSqlRows(
      ids,
      [{ provider_player_id: WILSON_BDL_ID, player_entity_id: wilsonEntity }],
      [{ player_entity_id: wilsonEntity, analytics_player_id: WILSON_BDL_ID }]
    );
    expect([...sql.servingIds]).toEqual([...gate.servingIds]);
    expect(sql.quarantine.map((row) => row.providerPlayerId)).toEqual(
      gate.observations.map((row) => row.providerPlayerId)
    );
  });
});
