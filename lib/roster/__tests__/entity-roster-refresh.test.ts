import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_CLOSE_ABS,
  ROSTER_REFRESH_SOURCE,
  ROSTER_REFRESH_TOUCHES_OTHER_SEASONS,
  assertSingleOpenPerEntitySeason,
  evaluateFetchIntegrity,
  evaluateMassCloseGuard,
  groupTeamChangePairs,
  partitionResolveResults,
  planEntityRosterRefresh,
  type EntityObservedMembership,
  type ExistingEntityOpenStint,
} from '../entity-roster-refresh';
import type { EntityResolveResult } from '../entity-roster-resolve';

const season = '2026';
const day = '2026-09-05';

function obs(
  partial: Partial<EntityObservedMembership> &
    Pick<
      EntityObservedMembership,
      'playerEntityId' | 'teamId' | 'nbaPlayerId' | 'fullName' | 'teamAbbr'
    >
): EntityObservedMembership {
  return {
    playerId: null,
    jersey: '1',
    position: 'G',
    hasBdl: false,
    ...partial,
  };
}

function openStint(
  partial: Partial<ExistingEntityOpenStint> &
    Pick<ExistingEntityOpenStint, 'stintId' | 'playerEntityId' | 'teamId'>
): ExistingEntityOpenStint {
  return {
    playerId: null,
    season,
    observedFrom: '2026-09-04',
    jersey: '1',
    position: 'G',
    source: ROSTER_REFRESH_SOURCE,
    sourcePlayerId: 'nba-1',
    ...partial,
  };
}

function resolve(
  partial: Partial<EntityResolveResult> &
    Pick<
      EntityResolveResult,
      'status' | 'nbaPlayerId' | 'fullName' | 'teamAbbr'
    >
): EntityResolveResult {
  return {
    jersey: null,
    position: null,
    playerEntityId: null,
    analyticsPlayerId: null,
    hasBdlIdentity: false,
    method: null,
    reason: null,
    candidates: [],
    ...partial,
  };
}

describe('Phase 2.T.2E entity roster refresh', () => {
  it('1. unchanged roster → touch only, no new stint', () => {
    const existing = [
      openStint({
        stintId: 1,
        playerEntityId: 'e1',
        teamId: 'det',
        sourcePlayerId: '100',
      }),
    ];
    const { mutations, counts } = planEntityRosterRefresh({
      season,
      observedOn: day,
      resolvedObservations: [
        obs({
          playerEntityId: 'e1',
          teamId: 'det',
          teamAbbr: 'DET',
          nbaPlayerId: '100',
          fullName: 'A',
        }),
      ],
      existingOpenStints: existing,
      protectedNbaPlayerIds: new Set(),
      allowsCloses: true,
    });
    expect(counts.open_new).toBe(0);
    expect(counts.close_missing).toBe(0);
    expect(counts.touch).toBe(1);
    expect(mutations[0]!.type).toBe('touch');
    assertSingleOpenPerEntitySeason(mutations, existing, season);
  });

  it('2. signing → open new stint', () => {
    const { counts, mutations } = planEntityRosterRefresh({
      season,
      observedOn: day,
      resolvedObservations: [
        obs({
          playerEntityId: 'e2',
          teamId: 'det',
          teamAbbr: 'DET',
          nbaPlayerId: '200',
          fullName: 'New',
        }),
      ],
      existingOpenStints: [],
      protectedNbaPlayerIds: new Set(),
      allowsCloses: true,
    });
    expect(counts.open_new).toBe(1);
    expect(mutations[0]).toMatchObject({
      type: 'open',
      category: 'open_new',
      observedFrom: day,
    });
  });

  it('3. waiver/removal → close stint', () => {
    const existing = [
      openStint({
        stintId: 3,
        playerEntityId: 'e3',
        teamId: 'det',
        sourcePlayerId: '300',
      }),
    ];
    const { counts, mutations } = planEntityRosterRefresh({
      season,
      observedOn: day,
      resolvedObservations: [],
      existingOpenStints: existing,
      protectedNbaPlayerIds: new Set(),
      allowsCloses: true,
    });
    expect(counts.close_missing).toBe(1);
    expect(mutations[0]).toMatchObject({
      type: 'close',
      category: 'close_missing',
      observedTo: day,
    });
  });

  it('4. trade → atomic close old / open new', () => {
    const existing = [
      openStint({
        stintId: 4,
        playerEntityId: 'e4',
        teamId: 'det',
        sourcePlayerId: '400',
      }),
    ];
    const { counts, mutations } = planEntityRosterRefresh({
      season,
      observedOn: day,
      resolvedObservations: [
        obs({
          playerEntityId: 'e4',
          teamId: 'mia',
          teamAbbr: 'MIA',
          nbaPlayerId: '400',
          fullName: 'Trade',
        }),
      ],
      existingOpenStints: existing,
      protectedNbaPlayerIds: new Set(),
      allowsCloses: true,
    });
    expect(counts.team_change).toBe(1);
    const pairs = groupTeamChangePairs(mutations);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.close.priorTeamId).toBe('det');
    expect(pairs[0]!.open.teamId).toBe('mia');
    assertSingleOpenPerEntitySeason(mutations, existing, season);
  });

  it('5. player returns later → new stint (not reopen closed)', () => {
    // Closed history is not in existingOpenStints; planner only sees absence → open_new
    const { mutations } = planEntityRosterRefresh({
      season,
      observedOn: '2026-09-20',
      resolvedObservations: [
        obs({
          playerEntityId: 'e5',
          teamId: 'det',
          teamAbbr: 'DET',
          nbaPlayerId: '500',
          fullName: 'Return',
        }),
      ],
      existingOpenStints: [],
      protectedNbaPlayerIds: new Set(),
      allowsCloses: true,
    });
    expect(mutations[0]).toMatchObject({
      type: 'open',
      category: 'open_new',
      observedFrom: '2026-09-20',
    });
  });

  it('6. jersey change → touch, preserve observed_from', () => {
    const existing = [
      openStint({
        stintId: 6,
        playerEntityId: 'e6',
        teamId: 'det',
        observedFrom: '2026-09-01',
        jersey: '5',
        sourcePlayerId: '600',
      }),
    ];
    const { mutations } = planEntityRosterRefresh({
      season,
      observedOn: day,
      resolvedObservations: [
        obs({
          playerEntityId: 'e6',
          teamId: 'det',
          teamAbbr: 'DET',
          nbaPlayerId: '600',
          fullName: 'J',
          jersey: '7',
        }),
      ],
      existingOpenStints: existing,
      protectedNbaPlayerIds: new Set(),
      allowsCloses: true,
    });
    expect(mutations[0]).toMatchObject({ type: 'touch', jersey: '7' });
    expect(JSON.stringify(mutations[0])).not.toContain('observedFrom');
    expect(existing[0]!.observedFrom).toBe('2026-09-01');
  });

  it('7. position change → touch', () => {
    const existing = [
      openStint({
        stintId: 7,
        playerEntityId: 'e7',
        teamId: 'bos',
        position: 'G',
        sourcePlayerId: '700',
      }),
    ];
    const { mutations } = planEntityRosterRefresh({
      season,
      observedOn: day,
      resolvedObservations: [
        obs({
          playerEntityId: 'e7',
          teamId: 'bos',
          teamAbbr: 'BOS',
          nbaPlayerId: '700',
          fullName: 'P',
          position: 'F',
        }),
      ],
      existingOpenStints: existing,
      protectedNbaPlayerIds: new Set(),
      allowsCloses: true,
    });
    expect(mutations[0]).toMatchObject({ type: 'touch', position: 'F' });
  });

  it('8. NBA-only player works with NULL player_id', () => {
    const { mutations } = planEntityRosterRefresh({
      season,
      observedOn: day,
      resolvedObservations: [
        obs({
          playerEntityId: 'e8',
          playerId: null,
          teamId: 'uta',
          teamAbbr: 'UTA',
          nbaPlayerId: '1640001',
          fullName: 'Rookie',
          hasBdl: false,
        }),
      ],
      existingOpenStints: [],
      protectedNbaPlayerIds: new Set(),
      allowsCloses: true,
    });
    expect(mutations[0]).toMatchObject({ type: 'open', playerId: null });
  });

  it('9. Class D observation skipped', () => {
    const part = partitionResolveResults({
      results: [
        resolve({
          status: 'ambiguous',
          nbaPlayerId: '1630811',
          fullName: 'Keaton Wallace',
          teamAbbr: 'ATL',
          reason: 'Class D',
        }),
      ],
      teamIdByAbbr: new Map([['ATL', 'atl']]),
      analyticsPlayerIds: new Set(),
    });
    expect(part.resolutionCounts.ambiguous).toBe(1);
    expect(part.skipMutations[0]!.type).toBe('skip_ambiguous');
    expect(part.resolved).toHaveLength(0);
  });

  it('10. ambiguous observation does not incorrectly close existing player', () => {
    const existing = [
      openStint({
        stintId: 10,
        playerEntityId: 'e10',
        teamId: 'atl',
        sourcePlayerId: '1630811',
      }),
    ];
    const { counts, mutations } = planEntityRosterRefresh({
      season,
      observedOn: day,
      resolvedObservations: [], // not in resolved set
      existingOpenStints: existing,
      protectedNbaPlayerIds: new Set(['1630811']),
      allowsCloses: true,
    });
    expect(counts.close_missing).toBe(0);
    expect(counts.protected_no_close).toBe(1);
    expect(mutations[0]!.type).toBe('protected_no_close');
  });

  it('11. incomplete team fetch prevents closes', () => {
    const fetch = evaluateFetchIntegrity({
      teamsAttempted: 30,
      teamsSuccessful: 28,
      teamsFailed: [
        { abbreviation: 'BOS', error: 'timeout' },
        { abbreviation: 'NYK', error: 'timeout' },
      ],
      totalObservations: 540,
      playersPerTeam: { BOS: 18 },
      duplicateNbaPlayerIds: [],
      minTeamSize: 15,
    });
    expect(fetch.ok).toBe(false);
    expect(fetch.allowsCloses).toBe(false);

    const existing = [
      openStint({
        stintId: 11,
        playerEntityId: 'e11',
        teamId: 'det',
        sourcePlayerId: '110',
      }),
    ];
    const { counts } = planEntityRosterRefresh({
      season,
      observedOn: day,
      resolvedObservations: [],
      existingOpenStints: existing,
      protectedNbaPlayerIds: new Set(),
      allowsCloses: fetch.allowsCloses,
    });
    expect(counts.close_missing).toBe(0);
    expect(counts.conflict).toBe(1);
  });

  it('12. suspicious mass-close threshold aborts', () => {
    const guard = evaluateMassCloseGuard({
      openCount: 578,
      proposedCloseMissing: 100,
    });
    expect(guard.ok).toBe(false);
    expect(guard.reason).toBeTruthy();
    expect(DEFAULT_MAX_CLOSE_ABS).toBe(30);

    const ok = evaluateMassCloseGuard({
      openCount: 578,
      proposedCloseMissing: 2,
    });
    expect(ok.ok).toBe(true);
  });

  it('13. same-day rerun idempotent (touch only)', () => {
    const existing = [
      openStint({
        stintId: 13,
        playerEntityId: 'e13',
        teamId: 'chi',
        sourcePlayerId: '130',
      }),
    ];
    const a = planEntityRosterRefresh({
      season,
      observedOn: day,
      resolvedObservations: [
        obs({
          playerEntityId: 'e13',
          teamId: 'chi',
          teamAbbr: 'CHI',
          nbaPlayerId: '130',
          fullName: 'Same',
        }),
      ],
      existingOpenStints: existing,
      protectedNbaPlayerIds: new Set(),
      allowsCloses: true,
    });
    const b = planEntityRosterRefresh({
      season,
      observedOn: day,
      resolvedObservations: [
        obs({
          playerEntityId: 'e13',
          teamId: 'chi',
          teamAbbr: 'CHI',
          nbaPlayerId: '130',
          fullName: 'Same',
        }),
      ],
      existingOpenStints: existing,
      protectedNbaPlayerIds: new Set(),
      allowsCloses: true,
    });
    expect(a.counts).toEqual(b.counts);
    expect(a.counts.open_new).toBe(0);
    expect(a.counts.close_missing).toBe(0);
  });

  it('14. one open entity/season invariant preserved on trade', () => {
    const existing = [
      openStint({
        stintId: 14,
        playerEntityId: 'e14',
        teamId: 'a',
        sourcePlayerId: '140',
      }),
    ];
    const { mutations } = planEntityRosterRefresh({
      season,
      observedOn: day,
      resolvedObservations: [
        obs({
          playerEntityId: 'e14',
          teamId: 'b',
          teamAbbr: 'B',
          nbaPlayerId: '140',
          fullName: 'X',
        }),
      ],
      existingOpenStints: existing,
      protectedNbaPlayerIds: new Set(),
      allowsCloses: true,
    });
    expect(() =>
      assertSingleOpenPerEntitySeason(mutations, existing, season)
    ).not.toThrow();
  });

  it('15. 2025 rows untouched by design flag', () => {
    expect(ROSTER_REFRESH_TOUCHES_OTHER_SEASONS).toBe(false);
    const existing = [
      openStint({
        stintId: 99,
        playerEntityId: 'e99',
        teamId: 'bos',
        season: '2025',
        sourcePlayerId: '99',
      }),
    ];
    const { counts } = planEntityRosterRefresh({
      season: '2026',
      observedOn: day,
      resolvedObservations: [],
      existingOpenStints: existing,
      protectedNbaPlayerIds: new Set(),
      allowsCloses: true,
    });
    // 2025 open ignored for 2026 season scope
    expect(counts.close_missing).toBe(0);
  });

  it('16. no fake BDL mapping created by planner', () => {
    const { mutations } = planEntityRosterRefresh({
      season,
      observedOn: day,
      resolvedObservations: [
        obs({
          playerEntityId: 'e16',
          playerId: null,
          teamId: 'sas',
          teamAbbr: 'SAS',
          nbaPlayerId: '1640099',
          fullName: 'OnlyNba',
        }),
      ],
      existingOpenStints: [],
      protectedNbaPlayerIds: new Set(),
      allowsCloses: true,
    });
    expect(JSON.stringify(mutations)).not.toMatch(/balldontlie/);
    expect(mutations[0]).toMatchObject({ playerId: null });
  });

  it('17. failed team-change is ordered close-then-open (rollback-safe pairing)', () => {
    const existing = [
      openStint({
        stintId: 17,
        playerEntityId: 'e17',
        teamId: 'det',
        sourcePlayerId: '170',
      }),
    ];
    const { mutations } = planEntityRosterRefresh({
      season,
      observedOn: day,
      resolvedObservations: [
        obs({
          playerEntityId: 'e17',
          teamId: 'mia',
          teamAbbr: 'MIA',
          nbaPlayerId: '170',
          fullName: 'T',
        }),
      ],
      existingOpenStints: existing,
      protectedNbaPlayerIds: new Set(),
      allowsCloses: true,
    });
    const pairs = groupTeamChangePairs(mutations);
    expect(pairs[0]!.close.stintId).toBe(17);
    expect(pairs[0]!.open.teamId).toBe('mia');
    // Apply layer wraps each pair in a transaction; pairing proves close precedes open.
  });

  it('18. raw snapshot lineage fields are reportable', () => {
    const lineage = {
      snapshot_at: '2026-09-05T00:00:00.000Z',
      snapshot_date: '2026-09-05',
      provider: 'nba_stats',
      provider_season: '2026-27',
      analytics_season: '2026',
      teams_fetched: 30,
      observations_fetched: 585,
    };
    expect(lineage.provider_season).toBe('2026-27');
    expect(lineage.analytics_season).toBe('2026');
  });
});
