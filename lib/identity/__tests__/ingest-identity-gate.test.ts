import { describe, expect, it } from 'vitest';
import { entityIdForNbaPlayer } from '../../roster/class-c-onboarding';
import { WILSON_BDL_ID, WILSON_NBA_ID } from '../../roster/identity-integrity';
import { entityIdForBdlPlayer } from '../../roster/player-entity-backfill';
import { buildPlayerIdentityIndex } from '../player-identity-resolve';
import {
  filterRowsByServingIdentity,
  gateIngestIdentities,
  playParticipantServingLink,
  starterGameIdentityReason,
} from '../ingest-identity-gate';

const wilsonEntity = entityIdForBdlPlayer(WILSON_BDL_ID);
const flemingsNba = '1643412';
const flemingsEntity = entityIdForNbaPlayer(flemingsNba);

const index = buildPlayerIdentityIndex({
  bridges: [
    { playerEntityId: wilsonEntity, provider: 'balldontlie', providerPlayerId: WILSON_BDL_ID },
    { playerEntityId: wilsonEntity, provider: 'nba', providerPlayerId: WILSON_NBA_ID },
    { playerEntityId: flemingsEntity, provider: 'nba', providerPlayerId: flemingsNba },
    { playerEntityId: 'e-conflict-a', provider: 'nba', providerPlayerId: '111' },
    { playerEntityId: 'e-conflict-b', provider: 'nba', providerPlayerId: '111' },
  ],
  projections: [{ playerEntityId: wilsonEntity, analyticsPlayerId: WILSON_BDL_ID }],
});

describe('ingest identity gate', () => {
  it('mixed payload: 9 serving + 1 not_serving_yet keeps 9 and quarantines 1', () => {
    const nbaGate = gateIngestIdentities({
      provider: 'nba',
      sourceContext: 'BOX_SCORE',
      providerPlayerIds: [WILSON_NBA_ID, flemingsNba],
      index,
      observedAt: '2026-09-10T00:00:00.000Z',
    });
    const partitioned = filterRowsByServingIdentity(
      [
        { playerId: WILSON_NBA_ID },
        { playerId: WILSON_NBA_ID },
        { playerId: WILSON_NBA_ID },
        { playerId: WILSON_NBA_ID },
        { playerId: WILSON_NBA_ID },
        { playerId: WILSON_NBA_ID },
        { playerId: WILSON_NBA_ID },
        { playerId: WILSON_NBA_ID },
        { playerId: WILSON_NBA_ID },
        { playerId: flemingsNba },
      ],
      (r) => r.playerId,
      nbaGate
    );
    expect(partitioned.keep).toHaveLength(9);
    expect(partitioned.skipped).toHaveLength(1);
    expect(nbaGate.accounting.notServingYet).toBe(1);
    expect(nbaGate.accounting.serving).toBe(1);
    expect(nbaGate.observations).toHaveLength(1);
    expect(nbaGate.diagnostics.find((d) => d.providerPlayerId === flemingsNba)?.status).toBe(
      'resolved'
    );
    expect(nbaGate.accounting.resolverLookups).toBe(1);
  });

  it('BDL serving player keeps the same analytics.players.player_id', () => {
    const gate = gateIngestIdentities({
      provider: 'balldontlie',
      sourceContext: 'INJURY',
      providerPlayerIds: [WILSON_BDL_ID],
      index,
      observedAt: '2026-09-10T00:00:00.000Z',
    });
    const d = gate.byId.get(WILSON_BDL_ID);
    expect(d?.serving).toEqual({ status: 'serving', analyticsPlayerId: WILSON_BDL_ID });
    expect(d?.event).toBe('identity_resolved');
  });

  it('Class C Flemings is not_serving_yet with no fabricated BDL id', () => {
    const gate = gateIngestIdentities({
      provider: 'nba',
      sourceContext: 'INJURY',
      providerPlayerIds: [flemingsNba],
      index,
      observedAt: '2026-09-10T00:00:00.000Z',
    });
    const d = gate.byId.get(flemingsNba);
    expect(d?.serving.status).toBe('not_serving_yet');
    expect(d?.event).toBe('identity_not_serving');
    expect(d?.resolution.status === 'resolved' && d.resolution.analyticsPlayerId).toBeNull();
    expect(gate.servingIds.size).toBe(0);
  });

  it('Class D unknown NBA id is fail_closed / unresolved', () => {
    const gate = gateIngestIdentities({
      provider: 'nba',
      sourceContext: 'PLAYER_PROP',
      providerPlayerIds: ['1630811'],
      index,
      observedAt: '2026-09-10T00:00:00.000Z',
    });
    expect(gate.byId.get('1630811')?.event).toBe('identity_unresolved');
    expect(gate.byId.get('1630811')?.serving).toEqual({
      status: 'fail_closed',
      reason: 'unresolved',
    });
  });

  it('conflict skips the row and continues neighbors', () => {
    const rows = [{ playerId: WILSON_NBA_ID }, { playerId: '111' }];
    const gate = gateIngestIdentities({
      provider: 'nba',
      sourceContext: 'ADVANCED',
      providerPlayerIds: rows.map((r) => r.playerId),
      index,
      observedAt: '2026-09-10T00:00:00.000Z',
    });
    const partitioned = filterRowsByServingIdentity(rows, (r) => r.playerId, gate);
    expect(partitioned.keep).toEqual([{ playerId: WILSON_NBA_ID }]);
    expect(gate.byId.get('111')?.event).toBe('identity_conflict');
    expect(gate.observations.some((o) => o.kind === 'CONFLICT')).toBe(true);
  });

  it('starter certification fails the game instead of emitting 4 starters', () => {
    const starterIds = [
      WILSON_NBA_ID,
      WILSON_NBA_ID,
      WILSON_NBA_ID,
      WILSON_NBA_ID,
      flemingsNba,
    ];
    const gate = gateIngestIdentities({
      provider: 'nba',
      sourceContext: 'LINEUP',
      providerPlayerIds: starterIds,
      index,
      observedAt: '2026-09-10T00:00:00.000Z',
    });
    expect(starterGameIdentityReason(starterIds, gate)).toBe('identity_not_serving');
  });

  it('Plays chronology can proceed without a serving participant link', () => {
    const gate = gateIngestIdentities({
      provider: 'nba',
      sourceContext: 'PLAYS',
      providerPlayerIds: [flemingsNba],
      index,
      observedAt: '2026-09-10T00:00:00.000Z',
    });
    expect(playParticipantServingLink(flemingsNba, gate)).toEqual({
      available: false,
      analyticsPlayerId: null,
    });
  });

  it('does not use names as identity', () => {
    const gate = gateIngestIdentities({
      provider: 'nba',
      sourceContext: 'OTHER',
      providerPlayerIds: ['Jalen Wilson'],
      index,
      observedAt: '2026-09-10T00:00:00.000Z',
    });
    expect(gate.byId.get('Jalen Wilson')?.event).toBe('identity_unresolved');
  });
});
