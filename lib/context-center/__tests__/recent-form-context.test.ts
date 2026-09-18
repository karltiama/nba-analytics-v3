import { describe, expect, it } from 'vitest';
import {
  FORM_DEFINITIONS,
  RECENT_FORM_CONTEXT_VERSION,
  assertRegistryIntegrity,
  computePlayerRoleContext,
  computeRecentFormContext,
  getContextDefinition,
  historyFromAccum,
  ingestPlayedIntoAccum,
  selectFormPriorHistory,
  selectPriorPlayedGames,
  type RoleHistoryGame,
} from '@/lib/context-center';

const TIP = '2024-01-15T00:30:00Z';

function g(
  partial: Partial<RoleHistoryGame> & Pick<RoleHistoryGame, 'gameId' | 'gameStart'>
): RoleHistoryGame {
  return {
    season: '2023',
    teamId: '10',
    minutes: 30,
    points: 20,
    rebounds: 5,
    assists: 5,
    field_goals_made: 8,
    field_goals_attempted: 16,
    three_pointers_made: 2,
    three_pointers_attempted: 6,
    free_throws_attempted: 4,
    ...partial,
  };
}

describe('recent-form-context-v1 registry', () => {
  it('registers exactly 10 RECENT_FORM fields', () => {
    expect(FORM_DEFINITIONS).toHaveLength(10);
    for (const d of FORM_DEFINITIONS) {
      expect(d.family).toBe('RECENT_FORM');
      expect(d.grain).toBe('PLAYER_GAME');
      expect(d.kind).toBe('DERIVED_CONTEXT');
      expect(d.version).toBe(RECENT_FORM_CONTEXT_VERSION);
      expect(d.predictiveStatus).toBe('NOT_TESTED');
      expect(d.displayStatus).toBe('DISPLAYABLE');
      expect(d.mayAdjustProjection).toBe(false);
    }
    expect(assertRegistryIntegrity().ok).toBe(true);
    expect(getContextDefinition('form.season_points')?.contextId).toBe('form.season_points');
  });
});

describe('recent-form-context-v1 semantics', () => {
  it('37. counting-stat exact synthetic case', () => {
    const history = [
      g({
        gameId: '1',
        gameStart: '2024-01-01T00:00:00Z',
        points: 20,
        rebounds: 5,
        three_pointers_made: 2,
      }),
      g({
        gameId: '2',
        gameStart: '2024-01-05T00:00:00Z',
        points: 30,
        rebounds: 7,
        three_pointers_made: 4,
      }),
    ];
    const snap = computeRecentFormContext({
      gameId: 'T',
      playerEntityId: 'P',
      teamId: '10',
      season: '2023',
      targetGameStart: TIP,
      history,
    });
    expect(snap.seasonForm.historyN).toBe(2);
    expect(snap.seasonForm.points).toBe(25);
    expect(snap.seasonForm.rebounds).toBe(6);
    expect(snap.seasonForm.tpm).toBe(3);
    expect(snap.recentForm.points).toBe(25);
    expect(snap.completeness.status).toBe('COMPLETE');
  });

  it('38. FG% pooled not mean of game percentages', () => {
    const history = [
      g({
        gameId: '1',
        gameStart: '2024-01-01T00:00:00Z',
        field_goals_made: 5,
        field_goals_attempted: 10,
      }),
      g({
        gameId: '2',
        gameStart: '2024-01-05T00:00:00Z',
        field_goals_made: 9,
        field_goals_attempted: 20,
      }),
    ];
    const snap = computeRecentFormContext({
      gameId: 'T',
      playerEntityId: 'P',
      teamId: '10',
      season: '2023',
      targetGameStart: TIP,
      history,
    });
    expect(snap.seasonForm.fgPct).toBeCloseTo(14 / 30, 10);
    expect(snap.seasonForm.fgPct).not.toBeCloseTo(0.475, 10);
    expect(snap.seasonForm.fgMade).toBe(14);
    expect(snap.seasonForm.fgAttempted).toBe(30);
  });

  it('39. 3P% pooled not mean of game percentages', () => {
    const history = [
      g({
        gameId: '1',
        gameStart: '2024-01-01T00:00:00Z',
        three_pointers_made: 1,
        three_pointers_attempted: 2,
      }),
      g({
        gameId: '2',
        gameStart: '2024-01-05T00:00:00Z',
        three_pointers_made: 3,
        three_pointers_attempted: 10,
      }),
    ];
    const snap = computeRecentFormContext({
      gameId: 'T',
      playerEntityId: 'P',
      teamId: '10',
      season: '2023',
      targetGameStart: TIP,
      history,
    });
    expect(snap.seasonForm.threePct).toBeCloseTo(4 / 12, 10);
    expect(snap.seasonForm.threePct).not.toBeCloseTo(0.4, 10);
  });

  it('40. zero-attempt 3P% is null → PARTIAL', () => {
    const history = [
      g({
        gameId: '1',
        gameStart: '2024-01-01T00:00:00Z',
        points: 10,
        rebounds: 4,
        three_pointers_made: 0,
        three_pointers_attempted: 0,
        field_goals_made: 4,
        field_goals_attempted: 8,
      }),
      g({
        gameId: '2',
        gameStart: '2024-01-05T00:00:00Z',
        points: 12,
        rebounds: 6,
        three_pointers_made: 0,
        three_pointers_attempted: 0,
        field_goals_made: 5,
        field_goals_attempted: 10,
      }),
    ];
    const snap = computeRecentFormContext({
      gameId: 'T',
      playerEntityId: 'P',
      teamId: '10',
      season: '2023',
      targetGameStart: TIP,
      history,
    });
    expect(snap.seasonForm.points).toBe(11);
    expect(snap.seasonForm.rebounds).toBe(5);
    expect(snap.seasonForm.tpm).toBe(0);
    expect(snap.seasonForm.fgPct).toBeCloseTo(9 / 18, 10);
    expect(snap.seasonForm.threePct).toBeNull();
    expect(snap.recentForm.threePct).toBeNull();
    expect(snap.completeness.status).toBe('PARTIAL');
  });

  it('36. DNP exclusion from counting means', () => {
    const history = [
      g({ gameId: '1', gameStart: '2024-01-01T00:00:00Z', points: 20 }),
      g({
        gameId: 'dnp',
        gameStart: '2024-01-03T00:00:00Z',
        minutes: '00',
        points: 0,
        rebounds: 0,
        three_pointers_made: 0,
        three_pointers_attempted: 0,
        field_goals_made: 0,
        field_goals_attempted: 0,
      }),
      g({ gameId: '2', gameStart: '2024-01-05T00:00:00Z', points: 30 }),
    ];
    const snap = computeRecentFormContext({
      gameId: 'T',
      playerEntityId: 'P',
      teamId: '10',
      season: '2023',
      targetGameStart: TIP,
      history,
    });
    expect(snap.seasonForm.historyN).toBe(2);
    expect(snap.seasonForm.points).toBe(25);
  });

  it('31/32. target outcome mutation does not change form', () => {
    const history = [
      g({
        gameId: '1',
        gameStart: '2024-01-01T00:00:00Z',
        points: 20,
        rebounds: 5,
        three_pointers_made: 2,
        field_goals_made: 5,
        field_goals_attempted: 10,
        three_pointers_attempted: 4,
      }),
      g({
        gameId: 'T',
        gameStart: TIP,
        points: 80,
        rebounds: 30,
        three_pointers_made: 15,
        field_goals_made: 40,
        field_goals_attempted: 50,
        three_pointers_attempted: 40,
      }),
    ];
    const snap = computeRecentFormContext({
      gameId: 'T',
      playerEntityId: 'P',
      teamId: '10',
      season: '2023',
      targetGameStart: TIP,
      history,
    });
    expect(snap.seasonForm.points).toBe(20);
    expect(snap.seasonForm.rebounds).toBe(5);
    expect(snap.seasonForm.tpm).toBe(2);
    expect(snap.seasonForm.fgPct).toBe(0.5);
    expect(snap.seasonForm.threePct).toBe(0.5);
  });

  it('34. future mutation excluded', () => {
    const history = [
      g({ gameId: '1', gameStart: '2024-01-01T00:00:00Z', points: 20 }),
      g({ gameId: 'future', gameStart: '2024-02-01T00:00:00Z', points: 50 }),
    ];
    const snap = computeRecentFormContext({
      gameId: 'T',
      playerEntityId: 'P',
      teamId: '10',
      season: '2023',
      targetGameStart: TIP,
      history,
    });
    expect(snap.seasonForm.historyN).toBe(1);
    expect(snap.seasonForm.points).toBe(20);
  });

  it('35. same-tip exclusion', () => {
    const history = [
      g({ gameId: '1', gameStart: '2024-01-01T00:00:00Z', points: 20 }),
      g({ gameId: 'same', gameStart: TIP, points: 80, field_goals_made: 40, field_goals_attempted: 40 }),
    ];
    const snap = computeRecentFormContext({
      gameId: 'T',
      playerEntityId: 'P',
      teamId: '10',
      season: '2023',
      targetGameStart: TIP,
      history,
    });
    expect(snap.seasonForm.historyN).toBe(1);
    expect(snap.seasonForm.points).toBe(20);
  });

  it('A. cold start SOURCE_ONLY', () => {
    const snap = computeRecentFormContext({
      gameId: 'T',
      playerEntityId: 'P',
      teamId: '10',
      season: '2023',
      targetGameStart: TIP,
      history: [],
    });
    expect(snap.seasonForm.historyN).toBe(0);
    expect(snap.recentForm.historyN).toBe(0);
    expect(snap.seasonForm.points).toBeNull();
    expect(snap.seasonForm.fgPct).toBeNull();
    expect(snap.completeness.status).toBe('SOURCE_ONLY');
  });

  it('42. trade reset', () => {
    const history = [
      g({ gameId: 'a1', gameStart: '2024-01-01T00:00:00Z', teamId: 'A', points: 30 }),
      g({ gameId: 'a2', gameStart: '2024-01-05T00:00:00Z', teamId: 'A', points: 30 }),
    ];
    const snap = computeRecentFormContext({
      gameId: 'T',
      playerEntityId: 'P',
      teamId: 'B',
      season: '2023',
      targetGameStart: TIP,
      history,
    });
    expect(snap.seasonForm.historyN).toBe(0);
    expect(snap.completeness.status).toBe('SOURCE_ONLY');
  });

  it('43. A→B→A reuses Team A history', () => {
    const history = [
      g({ gameId: 'a1', gameStart: '2024-01-01T00:00:00Z', teamId: 'A', points: 20 }),
      g({ gameId: 'a2', gameStart: '2024-01-05T00:00:00Z', teamId: 'A', points: 30 }),
      g({ gameId: 'b1', gameStart: '2024-01-08T00:00:00Z', teamId: 'B', points: 40 }),
    ];
    const snap = computeRecentFormContext({
      gameId: 'T',
      playerEntityId: 'P',
      teamId: 'A',
      season: '2023',
      targetGameStart: TIP,
      history,
    });
    expect(snap.seasonForm.historyN).toBe(2);
    expect(snap.seasonForm.points).toBe(25);
  });

  it('44. season reset', () => {
    const history = [
      g({ gameId: 'old', gameStart: '2023-01-01T00:00:00Z', season: '2022', points: 40 }),
    ];
    const snap = computeRecentFormContext({
      gameId: 'T',
      playerEntityId: 'P',
      teamId: '10',
      season: '2023',
      targetGameStart: TIP,
      history,
    });
    expect(snap.seasonForm.historyN).toBe(0);
  });

  it('41. recent denominator rollover last ≤10', () => {
    const history: RoleHistoryGame[] = [];
    for (let i = 1; i <= 12; i++) {
      history.push(
        g({
          gameId: `g${i}`,
          gameStart: `2024-01-${String(i).padStart(2, '0')}T00:00:00Z`,
          points: i,
          field_goals_made: i,
          field_goals_attempted: 10,
          three_pointers_made: i % 3,
          three_pointers_attempted: 3,
        })
      );
    }
    const tip = '2024-01-20T00:00:00Z';
    const snap = computeRecentFormContext({
      gameId: 'T',
      playerEntityId: 'P',
      teamId: '10',
      season: '2023',
      targetGameStart: tip,
      history,
    });
    expect(snap.seasonForm.historyN).toBe(12);
    expect(snap.recentForm.historyN).toBe(10);
    expect(snap.seasonForm.points).toBe((12 * 13) / 2 / 12);
    expect(snap.recentForm.points).toBe((3 + 4 + 5 + 6 + 7 + 8 + 9 + 10 + 11 + 12) / 10);
    // season FG% includes games 1-2; recent does not
    expect(snap.seasonForm.fgMade).toBe((12 * 13) / 2);
    expect(snap.seasonForm.fgAttempted).toBe(120);
    expect(snap.recentForm.fgMade).toBe(3 + 4 + 5 + 6 + 7 + 8 + 9 + 10 + 11 + 12);
    expect(snap.recentForm.fgAttempted).toBe(100);
  });

  it('33. emit then ingest next-game includes prior target', () => {
    const map = new Map();
    const prior = g({
      gameId: '1',
      gameStart: '2024-01-01T00:00:00Z',
      points: 20,
      field_goals_made: 5,
      field_goals_attempted: 10,
    });
    ingestPlayedIntoAccum(map, { ...prior, playerEntityId: 'P' });

    const target = g({
      gameId: 'T',
      gameStart: TIP,
      points: 40,
      field_goals_made: 15,
      field_goals_attempted: 20,
    });
    const snap = computeRecentFormContext({
      gameId: 'T',
      playerEntityId: 'P',
      teamId: '10',
      season: '2023',
      targetGameStart: TIP,
      history: historyFromAccum(map, '2023', '10', 'P'),
    });
    expect(snap.seasonForm.points).toBe(20);
    expect(snap.seasonForm.fgPct).toBe(0.5);

    ingestPlayedIntoAccum(map, { ...target, playerEntityId: 'P' });
    const nextTip = '2024-01-20T00:00:00Z';
    const snapNext = computeRecentFormContext({
      gameId: 'NEXT',
      playerEntityId: 'P',
      teamId: '10',
      season: '2023',
      targetGameStart: nextTip,
      history: historyFromAccum(map, '2023', '10', 'P'),
    });
    expect(snapNext.seasonForm.historyN).toBe(2);
    expect(snapNext.seasonForm.points).toBe(30);
    expect(snapNext.seasonForm.fgPct).toBeCloseTo(20 / 30, 10);
  });

  it('59. ROLE_FORM_HISTORY_SET_PARITY', () => {
    const history = [
      g({ gameId: '1', gameStart: '2024-01-01T00:00:00Z', points: 10 }),
      g({
        gameId: 'dnp',
        gameStart: '2024-01-03T00:00:00Z',
        minutes: '00',
        points: 0,
      }),
      g({ gameId: '2', gameStart: '2024-01-05T00:00:00Z', points: 20 }),
      g({ gameId: 'same', gameStart: TIP, points: 99 }),
      g({ gameId: 'future', gameStart: '2024-02-01T00:00:00Z', points: 99 }),
    ];
    const rolePrior = selectPriorPlayedGames({
      season: '2023',
      teamId: '10',
      targetGameStart: TIP,
      history,
    });
    const formPrior = selectFormPriorHistory({
      season: '2023',
      teamId: '10',
      targetGameStart: TIP,
      history,
    });
    expect(formPrior.season.map((x) => x.gameId)).toEqual(rolePrior.map((x) => x.gameId));

    const roleSnap = computePlayerRoleContext({
      gameId: 'T',
      playerEntityId: 'P',
      teamId: '10',
      season: '2023',
      targetGameStart: TIP,
      history,
    });
    const formSnap = computeRecentFormContext({
      gameId: 'T',
      playerEntityId: 'P',
      teamId: '10',
      season: '2023',
      targetGameStart: TIP,
      history,
    });
    expect(formSnap.seasonForm.historyN).toBe(roleSnap.seasonRole.historyN);
    expect(formSnap.recentForm.historyN).toBe(roleSnap.recentRole.historyN);
  });
});
