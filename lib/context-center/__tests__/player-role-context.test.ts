import { describe, expect, it } from 'vitest';
import {
  PLAYER_ROLE_CONTEXT_VERSION,
  ROLE_DEFINITIONS,
  assertRegistryIntegrity,
  computePlayerRoleContext,
  estimatePlayerRole,
  getContextDefinition,
  historyFromAccum,
  ingestPlayedIntoAccum,
  selectPriorPlayedGames,
  type RoleHistoryGame,
} from '@/lib/context-center';

const TIP = '2024-01-15T00:30:00Z';

function g(partial: Partial<RoleHistoryGame> & Pick<RoleHistoryGame, 'gameId' | 'gameStart'>): RoleHistoryGame {
  return {
    season: '2023',
    teamId: '10',
    minutes: 30,
    points: 20,
    field_goals_attempted: 10,
    free_throws_attempted: 4,
    assists: 5,
    three_pointers_attempted: 4,
    three_pointers_made: 1,
    rebounds: 5,
    ...partial,
  };
}

describe('player-role-context-v1 registry', () => {
  it('registers exactly 10 ROLE fields', () => {
    expect(ROLE_DEFINITIONS).toHaveLength(10);
    for (const d of ROLE_DEFINITIONS) {
      expect(d.family).toBe('ROLE');
      expect(d.grain).toBe('PLAYER_GAME');
      expect(d.kind).toBe('DERIVED_CONTEXT');
      expect(d.version).toBe(PLAYER_ROLE_CONTEXT_VERSION);
      expect(d.predictiveStatus).toBe('NOT_TESTED');
      expect(d.displayStatus).toBe('DISPLAYABLE');
      expect(d.mayAdjustProjection).toBe(false);
    }
    expect(assertRegistryIntegrity().ok).toBe(true);
    expect(getContextDefinition('role.season_minutes')?.contextId).toBe('role.season_minutes');
  });
});

describe('player-role-context-v1 semantics', () => {
  it('42. synthetic exact season/recent means', () => {
    const history = [
      g({
        gameId: '1',
        gameStart: '2024-01-01T00:00:00Z',
        minutes: 30,
        field_goals_attempted: 10,
        free_throws_attempted: 4,
        assists: 5,
        three_pointers_attempted: 4,
      }),
      g({
        gameId: '2',
        gameStart: '2024-01-05T00:00:00Z',
        minutes: 34,
        field_goals_attempted: 14,
        free_throws_attempted: 6,
        assists: 7,
        three_pointers_attempted: 8,
      }),
    ];
    const snap = computePlayerRoleContext({
      gameId: 'T',
      playerEntityId: 'P',
      teamId: '10',
      season: '2023',
      targetGameStart: TIP,
      history,
    });
    expect(snap.seasonRole.historyN).toBe(2);
    expect(snap.seasonRole.minutes).toBe(32);
    expect(snap.seasonRole.fga).toBe(12);
    expect(snap.seasonRole.fta).toBe(5);
    expect(snap.seasonRole.ast).toBe(6);
    expect(snap.seasonRole.tpa).toBe(6);
    expect(snap.recentRole.historyN).toBe(2);
    expect(snap.recentRole.minutes).toBe(32);
    expect(snap.completeness.status).toBe('COMPLETE');
  });

  it('43/35. target outcome mutation does not change context', () => {
    const history = [
      g({ gameId: '1', gameStart: '2024-01-01T00:00:00Z', minutes: 30, field_goals_attempted: 10 }),
      g({ gameId: '2', gameStart: '2024-01-05T00:00:00Z', minutes: 34, field_goals_attempted: 14 }),
      g({
        gameId: 'T',
        gameStart: TIP,
        minutes: 48,
        field_goals_attempted: 40,
        free_throws_attempted: 20,
        assists: 20,
        three_pointers_attempted: 25,
      }),
    ];
    const snap = computePlayerRoleContext({
      gameId: 'T',
      playerEntityId: 'P',
      teamId: '10',
      season: '2023',
      targetGameStart: TIP,
      history,
    });
    expect(snap.seasonRole.minutes).toBe(32);
    expect(snap.seasonRole.fga).toBe(12);
  });

  it('41. DNP excluded from means', () => {
    const history = [
      g({ gameId: '1', gameStart: '2024-01-01T00:00:00Z', minutes: 30 }),
      g({
        gameId: 'dnp',
        gameStart: '2024-01-03T00:00:00Z',
        minutes: '00',
        points: 0,
        field_goals_attempted: 0,
        free_throws_attempted: 0,
        assists: 0,
        three_pointers_attempted: 0,
        three_pointers_made: 0,
        rebounds: 0,
      }),
      g({ gameId: '2', gameStart: '2024-01-05T00:00:00Z', minutes: 34 }),
    ];
    const snap = computePlayerRoleContext({
      gameId: 'T',
      playerEntityId: 'P',
      teamId: '10',
      season: '2023',
      targetGameStart: TIP,
      history,
    });
    expect(snap.seasonRole.historyN).toBe(2);
    expect(snap.seasonRole.minutes).toBe(32);
  });

  it('A. cold start', () => {
    const snap = computePlayerRoleContext({
      gameId: 'T',
      playerEntityId: 'P',
      teamId: '10',
      season: '2023',
      targetGameStart: TIP,
      history: [],
    });
    expect(snap.seasonRole.historyN).toBe(0);
    expect(snap.recentRole.historyN).toBe(0);
    expect(snap.seasonRole.minutes).toBeNull();
    expect(snap.completeness.status).toBe('SOURCE_ONLY');
  });

  it('16. trade reset', () => {
    const history = [
      g({ gameId: 'a1', gameStart: '2024-01-01T00:00:00Z', teamId: 'A', minutes: 40 }),
      g({ gameId: 'a2', gameStart: '2024-01-05T00:00:00Z', teamId: 'A', minutes: 40 }),
    ];
    const snap = computePlayerRoleContext({
      gameId: 'T',
      playerEntityId: 'P',
      teamId: 'B',
      season: '2023',
      targetGameStart: TIP,
      history,
    });
    expect(snap.seasonRole.historyN).toBe(0);
    expect(snap.completeness.status).toBe('SOURCE_ONLY');

    const withB = [
      ...history,
      g({ gameId: 'b1', gameStart: '2024-01-10T00:00:00Z', teamId: 'B', minutes: 20 }),
    ];
    const snap2 = computePlayerRoleContext({
      gameId: 'T',
      playerEntityId: 'P',
      teamId: 'B',
      season: '2023',
      targetGameStart: TIP,
      history: withB,
    });
    expect(snap2.seasonRole.historyN).toBe(1);
    expect(snap2.seasonRole.minutes).toBe(20);
  });

  it('39. return A→B→A reuses prior A', () => {
    const history = [
      g({ gameId: 'a1', gameStart: '2024-01-01T00:00:00Z', teamId: 'A', minutes: 30 }),
      g({ gameId: 'a2', gameStart: '2024-01-05T00:00:00Z', teamId: 'A', minutes: 34 }),
      g({ gameId: 'b1', gameStart: '2024-01-08T00:00:00Z', teamId: 'B', minutes: 20 }),
    ];
    const snap = computePlayerRoleContext({
      gameId: 'T',
      playerEntityId: 'P',
      teamId: 'A',
      season: '2023',
      targetGameStart: TIP,
      history,
    });
    expect(snap.seasonRole.historyN).toBe(2);
    expect(snap.seasonRole.minutes).toBe(32);
  });

  it('40. recent window rollover last ≤10', () => {
    const history: RoleHistoryGame[] = [];
    for (let i = 1; i <= 12; i++) {
      history.push(
        g({
          gameId: `g${i}`,
          gameStart: `2024-01-${String(i).padStart(2, '0')}T00:00:00Z`,
          minutes: i, // 1..12
          field_goals_attempted: i,
        })
      );
    }
    const tip = '2024-01-20T00:00:00Z';
    const snap = computePlayerRoleContext({
      gameId: 'T',
      playerEntityId: 'P',
      teamId: '10',
      season: '2023',
      targetGameStart: tip,
      history,
    });
    expect(snap.seasonRole.historyN).toBe(12);
    expect(snap.seasonRole.minutes).toBe((12 * 13) / 2 / 12); // mean 1..12 = 6.5
    expect(snap.recentRole.historyN).toBe(10);
    expect(snap.recentRole.minutes).toBe((3 + 4 + 5 + 6 + 7 + 8 + 9 + 10 + 11 + 12) / 10);
    // add earlier game — recent still last 10 of the 13
    history.unshift(g({ gameId: 'g0', gameStart: '2023-12-20T00:00:00Z', minutes: 100 }));
    const snap2 = computePlayerRoleContext({
      gameId: 'T',
      playerEntityId: 'P',
      teamId: '10',
      season: '2023',
      targetGameStart: tip,
      history,
    });
    expect(snap2.seasonRole.historyN).toBe(13);
    expect(snap2.recentRole.historyN).toBe(10);
    expect(snap2.recentRole.minutes).toBe(snap.recentRole.minutes);
  });

  it('37. same-tip exclusion', () => {
    const history = [
      g({ gameId: '1', gameStart: '2024-01-01T00:00:00Z', minutes: 30 }),
      g({ gameId: 'same', gameStart: TIP, minutes: 48, field_goals_attempted: 40 }),
    ];
    const snap = computePlayerRoleContext({
      gameId: 'T',
      playerEntityId: 'P',
      teamId: '10',
      season: '2023',
      targetGameStart: TIP,
      history,
    });
    expect(snap.seasonRole.historyN).toBe(1);
    expect(snap.seasonRole.minutes).toBe(30);
  });

  it('45. season reset', () => {
    const history = [
      g({ gameId: 'old', gameStart: '2023-01-01T00:00:00Z', season: '2022', minutes: 40 }),
    ];
    const snap = computePlayerRoleContext({
      gameId: 'T',
      playerEntityId: 'P',
      teamId: '10',
      season: '2023',
      targetGameStart: TIP,
      history,
    });
    expect(snap.seasonRole.historyN).toBe(0);
  });

  it('44/10. emit then ingest streaming order', () => {
    const map = new Map();
    const prior = g({ gameId: '1', gameStart: '2024-01-01T00:00:00Z', minutes: 30, field_goals_attempted: 10 });
    ingestPlayedIntoAccum(map, { ...prior, playerEntityId: 'P' });

    const target = g({
      gameId: 'T',
      gameStart: TIP,
      minutes: 48,
      field_goals_attempted: 40,
      free_throws_attempted: 20,
      assists: 20,
      three_pointers_attempted: 25,
    });
    const histBefore = historyFromAccum(map, '2023', '10', 'P');
    const snap = computePlayerRoleContext({
      gameId: 'T',
      playerEntityId: 'P',
      teamId: '10',
      season: '2023',
      targetGameStart: TIP,
      history: histBefore,
    });
    expect(snap.seasonRole.minutes).toBe(30);
    expect(snap.seasonRole.fga).toBe(10);

    ingestPlayedIntoAccum(map, { ...target, playerEntityId: 'P' });
    const nextTip = '2024-01-20T00:00:00Z';
    const snapNext = computePlayerRoleContext({
      gameId: 'NEXT',
      playerEntityId: 'P',
      teamId: '10',
      season: '2023',
      targetGameStart: nextTip,
      history: historyFromAccum(map, '2023', '10', 'P'),
    });
    expect(snapNext.seasonRole.historyN).toBe(2);
    expect(snapNext.seasonRole.minutes).toBe(39); // (30+48)/2
    expect(snapNext.seasonRole.fga).toBe(25); // (10+40)/2
  });

  it('OT minutes > 48 allowed', () => {
    const history = [g({ gameId: 'ot', gameStart: '2024-01-01T00:00:00Z', minutes: 53 })];
    const snap = computePlayerRoleContext({
      gameId: 'T',
      playerEntityId: 'P',
      teamId: '10',
      season: '2023',
      targetGameStart: TIP,
      history,
    });
    expect(snap.seasonRole.minutes).toBe(53);
  });

  it('ROLE_EXPECTATION_BACKWARD_PARITY for minutes/FGA/PTS', () => {
    const history = [
      g({
        gameId: '1',
        gameStart: '2024-01-01T00:00:00Z',
        minutes: 20,
        points: 10,
        field_goals_attempted: 8,
      }),
      g({
        gameId: '2',
        gameStart: '2024-01-05T00:00:00Z',
        minutes: 40,
        points: 30,
        field_goals_attempted: 22,
      }),
    ];
    const est = estimatePlayerRole({
      playerEntityId: 'A',
      season: '2023',
      teamId: '10',
      targetGameStart: TIP,
      history,
    });
    const snap = computePlayerRoleContext({
      gameId: 'T',
      playerEntityId: 'A',
      teamId: '10',
      season: '2023',
      targetGameStart: TIP,
      history,
    });
    expect(est.status).toBe('OK');
    if (est.status !== 'OK') return;
    expect(est.estimate.expectedMinutes).toBe(snap.seasonRole.minutes);
    expect(est.estimate.expectedFga).toBe(snap.seasonRole.fga);
    expect(est.estimate.expectedPoints).toBe(20);
    expect(est.estimate.historyN).toBe(snap.seasonRole.historyN);
  });

  it('selectPriorPlayedGames deterministic gameId tie-break', () => {
    const history = [
      g({ gameId: 'b', gameStart: '2024-01-01T00:00:00Z', minutes: 10 }),
      g({ gameId: 'a', gameStart: '2024-01-01T00:00:00Z', minutes: 20 }),
    ];
    const prior = selectPriorPlayedGames({
      season: '2023',
      teamId: '10',
      targetGameStart: TIP,
      history,
    });
    expect(prior.map((p) => p.gameId)).toEqual(['a', 'b']);
  });
});
