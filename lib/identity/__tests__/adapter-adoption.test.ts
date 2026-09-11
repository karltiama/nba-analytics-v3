import { describe, expect, it } from 'vitest';
import { failStarterCertificationIfIdentityUnsafe } from '@/lib/archive/game-starters-from-lineups';
import { entityIdForNbaPlayer } from '@/lib/roster/class-c-onboarding';
import { WILSON_BDL_ID, WILSON_NBA_ID } from '@/lib/roster/identity-integrity';
import { entityIdForBdlPlayer } from '@/lib/roster/player-entity-backfill';
import { selectArchiveRowsForServing, starterGameIdentityReason } from '../archive-identity';
import { BBREF_IDENTITY_ADOPTION, BBREF_IDENTITY_DEFER_REASON } from '../bbref-identity';
import { selectBoxRowsForPgl, BDL_SERVING_PROJECTION_OWNER } from '../box-identity';
import { gateIngestIdentities } from '../ingest-identity-gate';
import { TIMELINE_IDENTITY_FALLBACK, playParticipantServingLink } from '../plays-identity';
import { selectPropRowsForAnalytics } from '../prop-identity';
import { buildPlayerIdentityIndex } from '../player-identity-resolve';

const wilsonEntity = entityIdForBdlPlayer(WILSON_BDL_ID);
const flemingsNba = '1643412';
const flemingsEntity = entityIdForNbaPlayer(flemingsNba);
const classDNba = '1630811';

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

describe('13R.3 adapter identity adoption', () => {
  it('box PGL: 9 serving + 1 non-serving keeps 9 and does not fabricate BDL ids', () => {
    const rows = [
      ...Array.from({ length: 9 }, () => ({ playerId: WILSON_BDL_ID })),
      { playerId: flemingsNba },
    ];
    const { keep, skipped, gate } = selectBoxRowsForPgl(
      rows,
      (row) => row.playerId,
      index,
      '2026-09-10T00:00:00.000Z'
    );
    expect(keep).toHaveLength(9);
    expect(skipped).toHaveLength(1);
    expect(gate.accounting.resolverLookups).toBe(1);
    expect(keep.every((row) => row.playerId === WILSON_BDL_ID)).toBe(true);
    expect(BDL_SERVING_PROJECTION_OWNER).toContain('upsertAnalyticsPlayer');
  });

  it('player props: one unresolved player does not fail the slate', () => {
    const rows = [
      ...Array.from({ length: 9 }, (_, i) => ({ player_id: WILSON_BDL_ID, n: i })),
      { player_id: '999999', n: 9 },
    ];
    const { keep, skipped, gate, accounting } = selectPropRowsForAnalytics(
      rows,
      (row) => row.player_id,
      index,
      '2026-09-10T00:00:00.000Z',
      'game-1'
    );
    expect(keep).toHaveLength(9);
    expect(skipped).toHaveLength(1);
    expect(gate.byId.get('999999')?.event).toBe('identity_unresolved');
    expect(accounting.outputRows).toBe(9);
  });

  it('Advanced / Role: serving rows materialize; Class C and conflicts skip', () => {
    const rows = [
      { playerId: WILSON_BDL_ID },
      { playerId: flemingsNba },
      { playerId: classDNba },
    ];
    const advanced = selectArchiveRowsForServing(
      'ADVANCED',
      rows,
      (row) => row.playerId,
      index,
      '2026-09-10T00:00:00.000Z'
    );
    const role = selectArchiveRowsForServing(
      'SEASON_AVERAGE',
      rows,
      (row) => row.playerId,
      index,
      '2026-09-10T00:00:00.000Z'
    );
    expect(advanced.keep).toEqual([{ playerId: WILSON_BDL_ID }]);
    expect(role.keep).toEqual([{ playerId: WILSON_BDL_ID }]);
    expect(advanced.gate.accounting.resolverLookups).toBe(1);
  });

  it('Starting Five: one unresolved starter fails the game instead of emitting 4', () => {
    const starterIds = [WILSON_BDL_ID, WILSON_BDL_ID, WILSON_BDL_ID, WILSON_BDL_ID, '999999'];
    const gate = gateIngestIdentities({
      provider: 'balldontlie',
      sourceContext: 'LINEUP',
      providerPlayerIds: starterIds,
      index,
      observedAt: '2026-09-10T00:00:00.000Z',
    });
    expect(starterGameIdentityReason(starterIds, gate)).toBe('identity_unresolved');
    const cert = failStarterCertificationIfIdentityUnsafe(
      { productEligible: true, reason: 'valid_5_plus_5', homeCount: 5, awayCount: 5 },
      'identity_unresolved'
    );
    expect(cert.productEligible).toBe(false);
    expect(cert.reason).toBe('canonical_identity_unresolved');
    expect(cert.homeCount).toBe(0);
  });

  it('Plays: chronology remains valid without a serving participant link', () => {
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
    expect(TIMELINE_IDENTITY_FALLBACK.chronologyValidWithoutServingLink).toBe(true);
    expect(TIMELINE_IDENTITY_FALLBACK.publicPlayerHref).toBeNull();
  });

  it('existing BDL serving player keeps the same analytics.players.player_id', () => {
    const { keep } = selectPropRowsForAnalytics(
      [{ player_id: WILSON_BDL_ID }],
      (row) => row.player_id,
      index,
      '2026-09-10T00:00:00.000Z'
    );
    expect(keep[0]?.player_id).toBe(WILSON_BDL_ID);
  });

  it('Class D remains unresolved with no name fallback', () => {
    const { skipped, gate } = selectPropRowsForAnalytics(
      [{ player_id: classDNba, name: 'Unknown Rookie' }],
      (row) => row.player_id,
      index,
      '2026-09-10T00:00:00.000Z'
    );
    expect(skipped).toHaveLength(1);
    expect(gate.byId.get(classDNba)?.event).toBe('identity_unresolved');
  });

  it('BBRef identity adoption is deferred', () => {
    expect(BBREF_IDENTITY_ADOPTION).toBe('DEFERRED');
    expect(BBREF_IDENTITY_DEFER_REASON).toMatch(/name matching/i);
  });
});
