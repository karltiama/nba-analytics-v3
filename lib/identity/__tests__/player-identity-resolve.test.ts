import { describe, expect, it } from 'vitest';
import { entityIdForNbaPlayer } from '../../roster/class-c-onboarding';
import { PIPPEN_BDL_ID, WILSON_BDL_ID, WILSON_NBA_ID } from '../../roster/identity-integrity';
import { entityIdForBdlPlayer } from '../../roster/player-entity-backfill';
import {
  buildPlayerIdentityIndex,
  playerIdentityDiagnostic,
  requireAnalyticsPlayerId,
  resolvePlayerIdentities,
  resolvePlayerIdentity,
} from '../player-identity-resolve';
import type { PlayerIdentityBridgeRow } from '../player-identity';

const wilsonEntity = entityIdForBdlPlayer(WILSON_BDL_ID);
const classCNbaId = '1643412';
const classCEntity = entityIdForNbaPlayer(classCNbaId);

const bridges: PlayerIdentityBridgeRow[] = [
  { playerEntityId: wilsonEntity, provider: 'balldontlie', providerPlayerId: WILSON_BDL_ID },
  { playerEntityId: wilsonEntity, provider: 'nba', providerPlayerId: WILSON_NBA_ID },
  { playerEntityId: classCEntity, provider: 'nba', providerPlayerId: classCNbaId },
];

const index = buildPlayerIdentityIndex({
  bridges,
  projections: [{ playerEntityId: wilsonEntity, analyticsPlayerId: WILSON_BDL_ID }],
});

describe('resolvePlayerIdentity', () => {
  it('resolves a known BDL id to canonical entity + analytics projection', () => {
    const r = resolvePlayerIdentity('balldontlie', WILSON_BDL_ID, index);
    expect(r).toEqual({
      status: 'resolved',
      provider: 'balldontlie',
      providerPlayerId: WILSON_BDL_ID,
      playerEntityId: wilsonEntity,
      analyticsPlayerId: WILSON_BDL_ID,
    });
    expect(requireAnalyticsPlayerId(r)).toEqual({
      status: 'serving',
      analyticsPlayerId: WILSON_BDL_ID,
    });
  });

  it('resolves a known NBA id without a BDL projection as analyticsPlayerId=null', () => {
    const r = resolvePlayerIdentity('nba', classCNbaId, index);
    expect(r.status).toBe('resolved');
    if (r.status !== 'resolved') return;
    expect(r.playerEntityId).toBe(classCEntity);
    expect(r.analyticsPlayerId).toBeNull();
    expect(requireAnalyticsPlayerId(r)).toEqual({
      status: 'not_serving_yet',
      playerEntityId: classCEntity,
    });
  });

  it('returns unresolved for an unknown provider id', () => {
    const r = resolvePlayerIdentity('balldontlie', '999999999', index);
    expect(r).toEqual({
      status: 'unresolved',
      provider: 'balldontlie',
      providerPlayerId: '999999999',
    });
    expect(requireAnalyticsPlayerId(r)).toEqual({
      status: 'fail_closed',
      reason: 'unresolved',
    });
  });

  it('returns unresolved for a BBRef id with no bridge', () => {
    const r = resolvePlayerIdentity('bbref', 'jamesle01', index);
    expect(r.status).toBe('unresolved');
  });

  it('returns conflict when one provider id maps to multiple entities', () => {
    const dirty = buildPlayerIdentityIndex({
      bridges: [
        { playerEntityId: 'e-1', provider: 'nba', providerPlayerId: '111' },
        { playerEntityId: 'e-2', provider: 'nba', providerPlayerId: '111' },
      ],
      projections: [],
    });
    const r = resolvePlayerIdentity('nba', '111', dirty);
    expect(r.status).toBe('conflict');
    if (r.status !== 'conflict') return;
    expect(r.candidateEntityIds).toEqual(['e-1', 'e-2']);
    expect(requireAnalyticsPlayerId(r)).toEqual({
      status: 'fail_closed',
      reason: 'conflict',
    });
  });

  it('does not use name matching as an authoritative fallback', () => {
    const named = buildPlayerIdentityIndex({
      bridges: [
        { playerEntityId: wilsonEntity, provider: 'balldontlie', providerPlayerId: WILSON_BDL_ID },
      ],
      projections: [{ playerEntityId: wilsonEntity, analyticsPlayerId: WILSON_BDL_ID }],
    });
    const r = resolvePlayerIdentity('nba', 'not-a-real-id', named);
    expect(r.status).toBe('unresolved');
  });

  it('batch-resolves one payload without name fallback', () => {
    const rows = resolvePlayerIdentities(
      'nba',
      [WILSON_NBA_ID, classCNbaId, '000'],
      index
    );
    expect(rows.map((x) => x.status)).toEqual(['resolved', 'resolved', 'unresolved']);
  });

  it('emits structured diagnostics without names', () => {
    const r = resolvePlayerIdentity('nba', classCNbaId, index);
    expect(playerIdentityDiagnostic({ resolution: r, sourceContext: 'BOX_SCORE' })).toEqual({
      provider: 'nba',
      sourceContext: 'BOX_SCORE',
      status: 'resolved',
      providerPlayerId: classCNbaId,
      playerEntityId: classCEntity,
    });
  });

  it('Class D NBA ids without bridges stay unresolved (no winner chosen)', () => {
    const r = resolvePlayerIdentity('nba', '1630811', index);
    expect(r.status).toBe('unresolved');
    expect(requireAnalyticsPlayerId(r).status).toBe('fail_closed');
  });

  it('historical BDL id meaning is unchanged (Pippen distinct from Wilson)', () => {
    const pippenEntity = entityIdForBdlPlayer(PIPPEN_BDL_ID);
    const hist = buildPlayerIdentityIndex({
      bridges: [
        { playerEntityId: wilsonEntity, provider: 'balldontlie', providerPlayerId: WILSON_BDL_ID },
        { playerEntityId: pippenEntity, provider: 'balldontlie', providerPlayerId: PIPPEN_BDL_ID },
      ],
      projections: [
        { playerEntityId: wilsonEntity, analyticsPlayerId: WILSON_BDL_ID },
        { playerEntityId: pippenEntity, analyticsPlayerId: PIPPEN_BDL_ID },
      ],
    });
    const w = resolvePlayerIdentity('balldontlie', WILSON_BDL_ID, hist);
    const p = resolvePlayerIdentity('balldontlie', PIPPEN_BDL_ID, hist);
    expect(w.status === 'resolved' && w.analyticsPlayerId).toBe(WILSON_BDL_ID);
    expect(p.status === 'resolved' && p.analyticsPlayerId).toBe(PIPPEN_BDL_ID);
    expect(w.status === 'resolved' && p.status === 'resolved' && w.playerEntityId !== p.playerEntityId).toBe(
      true
    );
  });
});
