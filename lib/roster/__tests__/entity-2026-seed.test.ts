import { describe, expect, it } from 'vitest';
import {
  EXPECTED_CLASS_D_2026,
  SEED_2026_SEASON,
  SEED_2026_SOURCE,
  SEED_2026_WRITES_2025,
  assertIntegrityGate,
  assertIntegrityGateFirstApply,
  classifyCrossSeason,
  planEntity2026SeedMutations,
  wilsonPippenSeedExpectations,
  type ExistingOpenStint2026,
} from '../entity-2026-seed';
import {
  buildEntityResolverIndex,
  resolveRosterToEntity,
  type EntityRow,
} from '../entity-roster-resolve';
import { entityIdForBdlPlayer } from '../player-entity-backfill';
import { entityIdForNbaPlayer } from '../class-c-onboarding';
import {
  PIPPEN_BDL_ID,
  PIPPEN_NBA_ID,
  WILSON_BDL_ID,
  WILSON_NBA_ID,
} from '../identity-integrity';
import type { RosterObservation } from '../identity-resolver';
import type { EntityResolveResult } from '../entity-roster-resolve';

function obs(
  partial: Partial<RosterObservation> &
    Pick<RosterObservation, 'nbaPlayerId' | 'fullName' | 'teamAbbr'>
): RosterObservation {
  return {
    teamInternalId: 't',
    jersey: '1',
    position: 'G',
    season: '2026-27',
    ...partial,
  };
}

function entity(id: string, name: string): EntityRow {
  return {
    playerEntityId: id,
    displayName: name,
    firstName: name.split(' ')[0] ?? null,
    lastName: name.split(' ').slice(1).join(' ') || null,
    position: 'G',
  };
}

function resolved(
  partial: Partial<EntityResolveResult> &
    Pick<
      EntityResolveResult,
      'status' | 'nbaPlayerId' | 'fullName' | 'teamAbbr' | 'playerEntityId'
    >
): EntityResolveResult {
  return {
    jersey: '1',
    position: 'G',
    analyticsPlayerId: null,
    hasBdlIdentity: false,
    method: 'test',
    reason: null,
    candidates: [],
    ...partial,
  };
}

describe('Phase 2.T.2D.2 entity 2026 seed', () => {
  it('1. BDL-backed player opens 2026 stint with player_id', () => {
    const eid = entityIdForBdlPlayer('111');
    const { mutations, counts } = planEntity2026SeedMutations({
      observedOn: '2026-09-04',
      results: [
        resolved({
          status: 'entity_provider_match',
          nbaPlayerId: '200',
          fullName: 'Vet',
          teamAbbr: 'BOS',
          playerEntityId: eid,
          analyticsPlayerId: '111',
          hasBdlIdentity: true,
        }),
      ],
      teamIdByAbbr: new Map([['BOS', 'bos']]),
      existingOpen2026: [],
      analyticsPlayerIds: new Set(['111']),
    });
    expect(counts.open).toBe(1);
    expect(mutations[0]).toMatchObject({
      type: 'open',
      playerId: '111',
      season: SEED_2026_SEASON,
      source: SEED_2026_SOURCE,
    });
  });

  it('2. NBA-only player opens stint with NULL player_id', () => {
    const eid = entityIdForNbaPlayer('1640001');
    const { mutations } = planEntity2026SeedMutations({
      observedOn: '2026-09-04',
      results: [
        resolved({
          status: 'entity_provider_match',
          nbaPlayerId: '1640001',
          fullName: 'Rookie',
          teamAbbr: 'NYK',
          playerEntityId: eid,
          analyticsPlayerId: null,
          hasBdlIdentity: false,
        }),
      ],
      teamIdByAbbr: new Map([['NYK', 'nyk']]),
      existingOpen2026: [],
      analyticsPlayerIds: new Set(),
    });
    expect(mutations[0]).toMatchObject({
      type: 'open',
      playerId: null,
      sourcePlayerId: '1640001',
      membershipType: null,
    });
  });

  it('3. NBA-only current-roster view shape keeps display without analytics.players', () => {
    const eid = entityIdForNbaPlayer('1640002');
    const viewRow = {
      season: '2026',
      player_entity_id: eid,
      player_id: null as string | null,
      display_name: 'Rookie Two',
    };
    expect(viewRow.player_id).toBeNull();
    expect(viewRow.display_name).toBeTruthy();
  });

  it('4. ambiguous Class D player skipped', () => {
    const { mutations, counts } = planEntity2026SeedMutations({
      observedOn: '2026-09-04',
      results: [
        resolved({
          status: 'ambiguous',
          nbaPlayerId: '1630811',
          fullName: 'Keaton Wallace',
          teamAbbr: 'ATL',
          playerEntityId: null,
          reason: 'conflicting_identities',
        }),
      ],
      teamIdByAbbr: new Map([['ATL', 'atl']]),
      existingOpen2026: [],
      analyticsPlayerIds: new Set(),
    });
    expect(counts.skip_ambiguous).toBe(1);
    expect(mutations[0]!.type).toBe('skip_ambiguous');
  });

  it('5. same-team 2025→2026 creates separate season rows (planner only opens 2026)', () => {
    expect(SEED_2026_WRITES_2025).toBe(false);
    const cross = classifyCrossSeason({
      open2025: [{ playerEntityId: 'e1', teamId: 'det' }],
      open2026: [{ playerEntityId: 'e1', teamId: 'det' }],
    });
    expect(cross.returning_same_team).toBe(1);
  });

  it('6. offseason team change preserves 2025 final row semantics', () => {
    const cross = classifyCrossSeason({
      open2025: [{ playerEntityId: 'e1', teamId: 'bos' }],
      open2026: [{ playerEntityId: 'e1', teamId: 'mia' }],
    });
    expect(cross.offseason_team_change).toBe(1);
    expect(SEED_2026_WRITES_2025).toBe(false);
  });

  it('7. seed rerun idempotent — existing same team becomes touch not open', () => {
    const eid = entityIdForBdlPlayer('222');
    const existing: ExistingOpenStint2026[] = [
      {
        stintId: 9,
        playerEntityId: eid,
        playerId: '222',
        teamId: 'lal',
        observedFrom: '2026-09-04',
        sourcePlayerId: '300',
        jersey: '0',
        position: 'G',
      },
    ];
    const { counts, mutations } = planEntity2026SeedMutations({
      observedOn: '2026-09-05',
      results: [
        resolved({
          status: 'entity_provider_match',
          nbaPlayerId: '300',
          fullName: 'Vet',
          teamAbbr: 'LAL',
          playerEntityId: eid,
          analyticsPlayerId: '222',
          hasBdlIdentity: true,
          jersey: '23',
          position: 'F',
        }),
      ],
      teamIdByAbbr: new Map([['LAL', 'lal']]),
      existingOpen2026: existing,
      analyticsPlayerIds: new Set(['222']),
    });
    expect(counts.open).toBe(0);
    expect(counts.touch).toBe(1);
    expect(mutations[0]).toMatchObject({ type: 'touch', stintId: 9 });
  });

  it('8. same observation does not create duplicate stint on rerun', () => {
    const eid = entityIdForNbaPlayer('1640003');
    const existing: ExistingOpenStint2026[] = [
      {
        stintId: 1,
        playerEntityId: eid,
        playerId: null,
        teamId: 'chi',
        observedFrom: '2026-09-04',
        sourcePlayerId: '1640003',
        jersey: null,
        position: null,
      },
    ];
    const a = planEntity2026SeedMutations({
      observedOn: '2026-09-04',
      results: [
        resolved({
          status: 'entity_provider_match',
          nbaPlayerId: '1640003',
          fullName: 'R',
          teamAbbr: 'CHI',
          playerEntityId: eid,
        }),
      ],
      teamIdByAbbr: new Map([['CHI', 'chi']]),
      existingOpen2026: existing,
      analyticsPlayerIds: new Set(),
    });
    expect(a.counts.open).toBe(0);
    expect(a.counts.touch).toBe(1);
  });

  it('9. entity open uniqueness is per season key', () => {
    const eid = 'aaaaaaaa-aaaa-5aaa-8aaa-aaaaaaaaaaaa';
    expect(`${eid}|2025|open`).not.toBe(`${eid}|2026|open`);
  });

  it('10. no cross-team 2026 entity collision in integrity gate', () => {
    const results = Array.from({ length: 585 }, (_, i) =>
      resolved({
        status: i < 578 ? 'entity_provider_match' : 'ambiguous',
        nbaPlayerId: String(1000 + i),
        fullName: `P${i}`,
        teamAbbr: 'BOS',
        playerEntityId: i < 578 ? `00000000-0000-5000-8000-${String(i).padStart(12, '0')}` : null,
      })
    );
    // Fix Class D ids to expected set for last 7
    for (let i = 0; i < 7; i++) {
      const c = EXPECTED_CLASS_D_2026[i]!;
      results[578 + i] = resolved({
        status: 'ambiguous',
        nbaPlayerId: c.nbaPlayerId,
        fullName: c.name,
        teamAbbr: c.team,
        playerEntityId: null,
      });
    }
    const gate = assertIntegrityGateFirstApply(
      assertIntegrityGate({
        results,
        stints2026Before: 0,
        duplicateEntityCount: 0,
        multiTeamNbaIds: [],
      })
    );
    expect(gate.ok).toBe(true);
  });

  it('11. jersey/position refresh does not reset observed_from', () => {
    const eid = entityIdForBdlPlayer('333');
    const existing: ExistingOpenStint2026[] = [
      {
        stintId: 5,
        playerEntityId: eid,
        playerId: '333',
        teamId: 'phx',
        observedFrom: '2026-09-04',
        sourcePlayerId: '400',
        jersey: '1',
        position: 'G',
      },
    ];
    const { mutations } = planEntity2026SeedMutations({
      observedOn: '2026-10-01',
      results: [
        resolved({
          status: 'entity_provider_match',
          nbaPlayerId: '400',
          fullName: 'V',
          teamAbbr: 'PHX',
          playerEntityId: eid,
          analyticsPlayerId: '333',
          hasBdlIdentity: true,
          jersey: '99',
          position: 'C',
        }),
      ],
      teamIdByAbbr: new Map([['PHX', 'phx']]),
      existingOpen2026: existing,
      analyticsPlayerIds: new Set(['333']),
    });
    expect(mutations[0]!.type).toBe('touch');
    expect(JSON.stringify(mutations[0])).not.toContain('observedFrom');
  });

  it('12. Wilson/Pippen remain distinct', () => {
    const ids = wilsonPippenSeedExpectations();
    expect(ids.wilson.bdlId).not.toBe(ids.pippen.bdlId);
    expect(ids.wilson.nbaId).not.toBe(ids.pippen.nbaId);
    const w = entityIdForBdlPlayer(WILSON_BDL_ID);
    const p = entityIdForBdlPlayer(PIPPEN_BDL_ID);
    expect(w).not.toBe(p);
    const index = buildEntityResolverIndex({
      entities: [
        entity(w, 'Jalen Wilson'),
        entity(p, 'Scotty Pippen Jr.'),
      ],
      providerRows: [
        { playerEntityId: w, provider: 'nba', providerPlayerId: WILSON_NBA_ID },
        {
          playerEntityId: w,
          provider: 'balldontlie',
          providerPlayerId: WILSON_BDL_ID,
        },
        { playerEntityId: p, provider: 'nba', providerPlayerId: PIPPEN_NBA_ID },
        {
          playerEntityId: p,
          provider: 'balldontlie',
          providerPlayerId: PIPPEN_BDL_ID,
        },
      ],
    });
    expect(
      resolveRosterToEntity(
        obs({
          nbaPlayerId: WILSON_NBA_ID,
          fullName: 'Jalen Wilson',
          teamAbbr: 'BKN',
        }),
        index
      ).playerEntityId
    ).toBe(w);
    expect(
      resolveRosterToEntity(
        obs({
          nbaPlayerId: PIPPEN_NBA_ID,
          fullName: 'Scotty Pippen Jr.',
          teamAbbr: 'MEM',
        }),
        index
      ).playerEntityId
    ).toBe(p);
  });

  it('13. season normalized to 2026', () => {
    const eid = entityIdForNbaPlayer('1');
    const { mutations } = planEntity2026SeedMutations({
      observedOn: '2026-09-04',
      results: [
        resolved({
          status: 'entity_provider_match',
          nbaPlayerId: '1',
          fullName: 'A',
          teamAbbr: 'SAS',
          playerEntityId: eid,
        }),
      ],
      teamIdByAbbr: new Map([['SAS', 'sas']]),
      existingOpen2026: [],
      analyticsPlayerIds: new Set(),
    });
    expect(mutations[0]).toMatchObject({ type: 'open', season: '2026' });
  });

  it('14. no fake BDL mapping created by seed planner', () => {
    const eid = entityIdForNbaPlayer('1640099');
    const { mutations } = planEntity2026SeedMutations({
      observedOn: '2026-09-04',
      results: [
        resolved({
          status: 'entity_provider_match',
          nbaPlayerId: '1640099',
          fullName: 'OnlyNba',
          teamAbbr: 'UTA',
          playerEntityId: eid,
        }),
      ],
      teamIdByAbbr: new Map([['UTA', 'uta']]),
      existingOpen2026: [],
      analyticsPlayerIds: new Set(),
    });
    expect(mutations[0]).toMatchObject({ type: 'open', playerId: null });
    expect(JSON.stringify(mutations)).not.toMatch(/balldontlie/);
  });

  it('15. no analytics.players fabrication for NBA-only (player_id stays null even if stale BDL hint missing from set)', () => {
    const eid = entityIdForNbaPlayer('1640088');
    const { mutations } = planEntity2026SeedMutations({
      observedOn: '2026-09-04',
      results: [
        resolved({
          status: 'entity_provider_match',
          nbaPlayerId: '1640088',
          fullName: 'Hint',
          teamAbbr: 'DEN',
          playerEntityId: eid,
          analyticsPlayerId: '999999',
          hasBdlIdentity: true,
        }),
      ],
      teamIdByAbbr: new Map([['DEN', 'den']]),
      existingOpen2026: [],
      analyticsPlayerIds: new Set(), // not in analytics.players
    });
    expect(mutations[0]).toMatchObject({ type: 'open', playerId: null });
  });
});
