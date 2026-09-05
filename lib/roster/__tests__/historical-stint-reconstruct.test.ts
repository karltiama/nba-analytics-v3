import { describe, expect, it } from 'vitest';
import {
  assertNoTransactionDateClaims,
  contiguousTeamSegments,
  findMultipleOpenPlayers,
  planHistoricalReconstruction,
  type FinalRosterMembership,
  type PglAppearance,
} from '../historical-stint-reconstruct';

const season = '2025';

function apps(
  playerId: string,
  rows: Array<{ teamId: string; date: string; gameId?: string }>
): PglAppearance[] {
  return rows.map((r) => ({
    playerId,
    teamId: r.teamId,
    gameDate: r.date,
    gameId: r.gameId,
  }));
}

function final(
  partial: Partial<FinalRosterMembership> &
    Pick<FinalRosterMembership, 'playerId' | 'teamId' | 'stintId'>
): FinalRosterMembership {
  return {
    observedFrom: '2026-09-04',
    source: 'nba_stats',
    sourcePlayerId: 'nba-x',
    jersey: '1',
    position: 'G',
    ...partial,
  };
}

describe('contiguousTeamSegments', () => {
  it('groups contiguous same-team appearances', () => {
    const segs = contiguousTeamSegments(
      apps('p1', [
        { teamId: 'DET', date: '2025-10-24', gameId: '1' },
        { teamId: 'DET', date: '2026-01-29', gameId: '2' },
        { teamId: 'MIA', date: '2026-02-03', gameId: '3' },
        { teamId: 'MIA', date: '2026-04-10', gameId: '4' },
      ])
    );
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({
      teamId: 'DET',
      observedFrom: '2025-10-24',
      observedTo: '2026-01-29',
      games: 2,
    });
    expect(segs[1]).toMatchObject({
      teamId: 'MIA',
      observedFrom: '2026-02-03',
      observedTo: '2026-04-10',
      games: 2,
    });
  });
});

describe('planHistoricalReconstruction', () => {
  it('1. one-team player → single open final stint (reconcile from), no inferred duplicate', () => {
    const plan = planHistoricalReconstruction({
      season,
      appearances: apps('p1', [
        { teamId: 'BKN', date: '2025-10-22' },
        { teamId: 'BKN', date: '2026-04-10' },
      ]),
      finalOpenByPlayer: new Map([
        ['p1', final({ playerId: 'p1', teamId: 'BKN', stintId: 1 })],
      ]),
    });
    expect(plan.inferredStints).toHaveLength(0);
    expect(plan.reconcileOpens).toEqual([
      expect.objectContaining({
        playerId: 'p1',
        teamId: 'BKN',
        observedFrom: '2025-10-22',
        confidence: 'nba_plus_pgl',
      }),
    ]);
    expect(plan.conflicts).toHaveLength(0);
  });

  it('2. traded player → closed old stint + open new stint', () => {
    const plan = planHistoricalReconstruction({
      season,
      appearances: apps('p2', [
        { teamId: 'DET', date: '2025-10-24' },
        { teamId: 'DET', date: '2026-01-29' },
        { teamId: 'MIA', date: '2026-02-03' },
        { teamId: 'MIA', date: '2026-04-10' },
      ]),
      finalOpenByPlayer: new Map([
        ['p2', final({ playerId: 'p2', teamId: 'MIA', stintId: 2 })],
      ]),
    });
    expect(plan.inferredStints).toEqual([
      expect.objectContaining({
        teamId: 'DET',
        observedFrom: '2025-10-24',
        observedTo: '2026-01-29',
        source: 'inferred_pgl',
      }),
    ]);
    expect(plan.reconcileOpens[0]?.teamId).toBe('MIA');
    expect(plan.reconcileOpens[0]?.observedFrom).toBe('2026-02-03');
  });

  it('3. three-team player → chronological non-overlapping closed + open final', () => {
    const plan = planHistoricalReconstruction({
      season,
      appearances: apps('p3', [
        { teamId: 'ATL', date: '2025-11-01' },
        { teamId: 'ATL', date: '2025-12-01' },
        { teamId: 'MEM', date: '2026-01-05' },
        { teamId: 'MEM', date: '2026-02-01' },
        { teamId: 'LAL', date: '2026-02-15' },
        { teamId: 'LAL', date: '2026-04-01' },
      ]),
      finalOpenByPlayer: new Map([
        ['p3', final({ playerId: 'p3', teamId: 'LAL', stintId: 3 })],
      ]),
    });
    expect(plan.inferredStints.map((s) => s.teamId)).toEqual(['ATL', 'MEM']);
    expect(plan.inferredStints.every((s) => s.observedTo != null)).toBe(true);
    expect(plan.reconcileOpens[0]?.teamId).toBe('LAL');
    // Non-overlapping chronology
    const [a, m] = plan.inferredStints;
    expect(a!.observedTo! < m!.observedFrom).toBe(true);
    expect(m!.observedTo! < plan.reconcileOpens[0]!.observedFrom).toBe(true);
  });

  it('4. short-term player absent final snapshot → closed historical stint only', () => {
    const plan = planHistoricalReconstruction({
      season,
      appearances: apps('p4', [
        { teamId: 'CHI', date: '2026-01-10' },
        { teamId: 'CHI', date: '2026-01-20' },
      ]),
      finalOpenByPlayer: new Map(),
    });
    expect(plan.inferredStints).toEqual([
      expect.objectContaining({
        playerId: 'p4',
        teamId: 'CHI',
        observedFrom: '2026-01-10',
        observedTo: '2026-01-20',
        source: 'inferred_pgl',
        membershipType: null,
      }),
    ]);
    expect(plan.reconcileOpens).toHaveLength(0);
    expect(plan.stats.pglOnlyHistoricalPlayers).toBe(1);
  });

  it('5. final roster + matching PGL → no duplicate inferred stint for final team', () => {
    const plan = planHistoricalReconstruction({
      season,
      appearances: apps('p5', [{ teamId: 'BOS', date: '2025-10-22' }]),
      finalOpenByPlayer: new Map([
        ['p5', final({ playerId: 'p5', teamId: 'BOS', stintId: 5 })],
      ]),
    });
    expect(plan.inferredStints.filter((s) => s.teamId === 'BOS')).toHaveLength(
      0
    );
  });

  it('6. final roster vs conflicting last PGL → conflict queue; no rewrite of open', () => {
    const plan = planHistoricalReconstruction({
      season,
      appearances: apps('p6', [
        { teamId: 'NYK', date: '2025-11-01' },
        { teamId: 'NYK', date: '2026-03-01' },
        { teamId: 'DAL', date: '2026-03-15' },
      ]),
      finalOpenByPlayer: new Map([
        ['p6', final({ playerId: 'p6', teamId: 'NYK', stintId: 6 })],
      ]),
    });
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0]).toMatchObject({
      finalTeamId: 'NYK',
      lastPglTeamId: 'DAL',
      classification: 'unresolved_source_conflict',
    });
    expect(plan.manualQueue.some((m) => m.kind === 'source_conflict')).toBe(
      true
    );
    // Closed PGL for DAL only; no inferred open; no reconcile from conflicting last team
    expect(plan.inferredStints.map((s) => s.teamId)).toEqual(['DAL']);
    expect(plan.reconcileOpens).toHaveLength(0);
  });

  it('7. unresolved identity skipped', () => {
    const plan = planHistoricalReconstruction({
      season,
      appearances: apps('skip-me', [
        { teamId: 'ATL', date: '2025-11-01' },
      ]),
      finalOpenByPlayer: new Map(),
      skipPlayerIds: new Set(['skip-me']),
    });
    expect(plan.inferredStints).toHaveLength(0);
    expect(plan.skippedUnresolvedPlayerIds).toEqual(['skip-me']);
  });

  it('8. rerun idempotent — same inputs → same plan', () => {
    const args = {
      season,
      appearances: apps('p8', [
        { teamId: 'DET', date: '2025-10-24' },
        { teamId: 'MIA', date: '2026-02-03' },
      ]),
      finalOpenByPlayer: new Map([
        ['p8', final({ playerId: 'p8', teamId: 'MIA', stintId: 8 })],
      ]),
    };
    const a = planHistoricalReconstruction(args);
    const b = planHistoricalReconstruction(args);
    expect(a).toEqual(b);
  });

  it('9. no more than one open stint/player/season in plan union', () => {
    const finals = [
      final({ playerId: 'p9', teamId: 'MEM', stintId: 9 }),
    ];
    const plan = planHistoricalReconstruction({
      season,
      appearances: apps('p9', [
        { teamId: 'BKN', date: '2025-11-01' },
        { teamId: 'MEM', date: '2026-02-01' },
      ]),
      finalOpenByPlayer: new Map([['p9', finals[0]!]]),
    });
    // inferred are all closed
    expect(plan.inferredStints.every((s) => s.observedTo != null)).toBe(true);
    expect(findMultipleOpenPlayers(finals, plan.inferredStints)).toEqual([]);
  });

  it('10. Wilson and Pippen remain distinct', () => {
    const wilson = '56677722';
    const pippen = '38017656';
    const plan = planHistoricalReconstruction({
      season,
      appearances: [
        ...apps(wilson, [
          { teamId: 'BKN', date: '2025-10-22' },
          { teamId: 'BKN', date: '2026-04-10' },
        ]),
        ...apps(pippen, [
          { teamId: 'MEM', date: '2025-10-22' },
          { teamId: 'MEM', date: '2026-04-10' },
        ]),
      ],
      finalOpenByPlayer: new Map([
        [
          wilson,
          final({ playerId: wilson, teamId: 'BKN', stintId: 100 }),
        ],
        [
          pippen,
          final({ playerId: pippen, teamId: 'MEM', stintId: 101 }),
        ],
      ]),
    });
    expect(plan.reconcileOpens.map((r) => r.playerId).sort()).toEqual([
      pippen,
      wilson,
    ]);
    expect(plan.reconcileOpens.find((r) => r.playerId === wilson)?.teamId).toBe(
      'BKN'
    );
    expect(plan.reconcileOpens.find((r) => r.playerId === pippen)?.teamId).toBe(
      'MEM'
    );
    expect(wilson).not.toBe(pippen);
  });

  it('11. no exact transaction-date claim derived from PGL', () => {
    const plan = planHistoricalReconstruction({
      season,
      appearances: apps('p11', [
        { teamId: 'DET', date: '2026-01-29' },
        { teamId: 'MIA', date: '2026-02-03' },
      ]),
      finalOpenByPlayer: new Map([
        ['p11', final({ playerId: 'p11', teamId: 'MIA', stintId: 11 })],
      ]),
    });
    assertNoTransactionDateClaims(plan.inferredStints);
    for (const s of plan.inferredStints) {
      expect(s).not.toHaveProperty('tradeDate');
      expect(s).not.toHaveProperty('trade_date');
      expect(s.source).toBe('inferred_pgl');
    }
  });
});
