import { describe, expect, it } from 'vitest';
import {
  ENTITY_BACKFILL_WRITES_STINTS,
  entityIdForBdlPlayer,
  planPlayerEntityBackfill,
  assertWilsonPippenDistinct,
  decideNbaAttach,
  type AnalyticsPlayerRow,
  type LegacyProviderMapRow,
} from '../player-entity-backfill';
import {
  PIPPEN_BDL_ID,
  PIPPEN_NBA_ID,
  WILSON_BDL_ID,
  WILSON_NBA_ID,
} from '../identity-integrity';

function player(
  partial: Partial<AnalyticsPlayerRow> & Pick<AnalyticsPlayerRow, 'playerId' | 'fullName'>
): AnalyticsPlayerRow {
  return {
    firstName: null,
    lastName: null,
    position: 'G',
    playerEntityId: null,
    ...partial,
  };
}

describe('player-entity-backfill', () => {
  it('1. existing BDL player gets exactly one deterministic entity', () => {
    const plan = planPlayerEntityBackfill({
      analyticsPlayers: [player({ playerId: '111', fullName: 'Test Player' })],
      legacyMaps: [],
      existingProviderRows: [],
    });
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]!.playerEntityId).toBe(entityIdForBdlPlayer('111'));
    expect(plan.items[0]!.createEntity).toBe(true);
    expect(plan.items[0]!.createBdlMapping).toBe(true);
  });

  it('2. BDL provider id points to that entity', () => {
    const plan = planPlayerEntityBackfill({
      analyticsPlayers: [player({ playerId: '222', fullName: 'B' })],
      legacyMaps: [],
      existingProviderRows: [],
    });
    expect(plan.items[0]!.analyticsPlayerId).toBe('222');
    expect(plan.items[0]!.createBdlMapping).toBe(true);
  });

  it('3. unique NBA bridge attaches to same entity', () => {
    const maps: LegacyProviderMapRow[] = [
      { provider: 'balldontlie', providerId: '333', internalId: '900' },
      { provider: 'nba', providerId: '900', internalId: '900' },
    ];
    const plan = planPlayerEntityBackfill({
      analyticsPlayers: [player({ playerId: '333', fullName: 'C' })],
      legacyMaps: maps,
      existingProviderRows: [],
    });
    expect(plan.items[0]!.createNbaMapping).toBe(true);
    expect(plan.items[0]!.nbaPlayerId).toBe('900');
    expect(plan.items[0]!.playerEntityId).toBe(entityIdForBdlPlayer('333'));
  });

  it('4. NBA-only provider row is NOT created without analytics entity in this phase', () => {
    // No analytics player for NBA 999 — planner only iterates analytics.players
    const plan = planPlayerEntityBackfill({
      analyticsPlayers: [],
      legacyMaps: [
        { provider: 'nba', providerId: '999', internalId: '999' },
      ],
      existingProviderRows: [],
    });
    expect(plan.items).toHaveLength(0);
    expect(plan.stats.nbaMappingsProposed).toBe(0);
  });

  it('5–6. rerun reuses entity and does not duplicate mappings', () => {
    const entityId = entityIdForBdlPlayer('444');
    const plan = planPlayerEntityBackfill({
      analyticsPlayers: [
        player({
          playerId: '444',
          fullName: 'D',
          playerEntityId: entityId,
        }),
      ],
      legacyMaps: [
        { provider: 'balldontlie', providerId: '444', internalId: '800' },
        { provider: 'nba', providerId: '800', internalId: '800' },
      ],
      existingProviderRows: [
        {
          playerEntityId: entityId,
          provider: 'balldontlie',
          providerPlayerId: '444',
        },
        {
          playerEntityId: entityId,
          provider: 'nba',
          providerPlayerId: '800',
        },
      ],
    });
    expect(plan.items[0]!.reuseExistingEntity).toBe(true);
    expect(plan.items[0]!.createEntity).toBe(false);
    expect(plan.items[0]!.createBdlMapping).toBe(false);
    expect(plan.items[0]!.createNbaMapping).toBe(false);
  });

  it('7–8. provider / multi-BDL conflict fails closed (no NBA attach / no merge)', () => {
    const decision = decideNbaAttach({
      bdlPlayerId: 'A',
      legacyMaps: [
        { provider: 'balldontlie', providerId: 'A', internalId: 'N1' },
        { provider: 'balldontlie', providerId: 'B', internalId: 'N1' },
        { provider: 'nba', providerId: 'N1', internalId: 'N1' },
      ],
    });
    expect(decision.kind).toBe('conflict');

    const plan = planPlayerEntityBackfill({
      analyticsPlayers: [
        player({ playerId: 'A', fullName: 'One' }),
        player({ playerId: 'B', fullName: 'Two' }),
      ],
      legacyMaps: [
        { provider: 'balldontlie', providerId: 'A', internalId: 'N1' },
        { provider: 'balldontlie', providerId: 'B', internalId: 'N1' },
        { provider: 'nba', providerId: 'N1', internalId: 'N1' },
      ],
      existingProviderRows: [],
    });
    // Still creates separate entities for A and B — no merge
    expect(plan.items.map((i) => i.playerEntityId)).toEqual([
      entityIdForBdlPlayer('A'),
      entityIdForBdlPlayer('B'),
    ]);
    expect(plan.items.every((i) => !i.createNbaMapping)).toBe(true);
    expect(
      plan.conflicts.some((c) => c.kind === 'multi_bdl_same_nba_internal')
    ).toBe(true);
  });

  it('9. Wilson and Pippen remain distinct', () => {
    const maps: LegacyProviderMapRow[] = [
      {
        provider: 'balldontlie',
        providerId: WILSON_BDL_ID,
        internalId: WILSON_NBA_ID,
      },
      {
        provider: 'nba',
        providerId: WILSON_NBA_ID,
        internalId: WILSON_NBA_ID,
      },
      {
        provider: 'balldontlie',
        providerId: PIPPEN_BDL_ID,
        internalId: PIPPEN_NBA_ID,
      },
      {
        provider: 'nba',
        providerId: PIPPEN_NBA_ID,
        internalId: PIPPEN_NBA_ID,
      },
    ];
    const plan = planPlayerEntityBackfill({
      analyticsPlayers: [
        player({ playerId: WILSON_BDL_ID, fullName: 'Jalen Wilson' }),
        player({
          playerId: PIPPEN_BDL_ID,
          fullName: 'Scotty Pippen Jr.',
        }),
      ],
      legacyMaps: maps,
      existingProviderRows: [],
    });
    const check = assertWilsonPippenDistinct(plan.items);
    expect(check.ok).toBe(true);
    expect(plan.items.find((i) => i.analyticsPlayerId === WILSON_BDL_ID)?.nbaPlayerId).toBe(
      WILSON_NBA_ID
    );
    expect(plan.items.find((i) => i.analyticsPlayerId === PIPPEN_BDL_ID)?.nbaPlayerId).toBe(
      PIPPEN_NBA_ID
    );
  });

  it('10. analytics.players.player_id remains the plan key (unchanged identity)', () => {
    const plan = planPlayerEntityBackfill({
      analyticsPlayers: [player({ playerId: '555', fullName: 'E' })],
      legacyMaps: [],
      existingProviderRows: [],
    });
    expect(plan.items[0]!.analyticsPlayerId).toBe('555');
    expect(plan.items[0]!.playerEntityId).not.toBe('555');
  });

  it('11. dry-run contract never writes stints', () => {
    expect(ENTITY_BACKFILL_WRITES_STINTS).toBe(false);
  });

  it('12. deterministic entity id is stable across calls', () => {
    expect(entityIdForBdlPlayer('xyz')).toBe(entityIdForBdlPlayer('xyz'));
  });
});
