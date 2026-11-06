import { describe, expect, it } from 'vitest';
import { playerPeriodLinesFromPlays, reconcileGameWithBox } from '../player-period-scoring';

const play = (o: Record<string, unknown>) => ({ shooting_play: true, scoring_play: false, ...o });

const rows = [
  play({ period: 1, type: 'Jump Shot', scoring_play: true, score_value: 3, participants: [10, 20] }),
  play({ period: 1, type: 'Driving Layup Shot', scoring_play: true, score_value: 2, participants: [10] }),
  play({ period: 1, type: 'Free Throw - 1 of 1', scoring_play: true, score_value: 1, participants: [10] }),
  play({ period: 1, type: 'Jump Shot', score_value: null, participants: [20] }), // miss
  play({ period: 1, type: 'Jump Shot', score_value: null, participants: [99, 10] }), // blocked: first is not the shooter
  play({ period: 2, type: 'Dunk Shot', scoring_play: true, score_value: 2, participants: [20, 10] }),
  play({ period: 5, type: 'Free Throw - 2 of 2', scoring_play: true, score_value: 1, participants: [{ id: 20 }] }),
  { period: 1, type: 'Substitution', participants: [10, 30] },
];

describe('playerPeriodLinesFromPlays', () => {
  it('credits made shots and free throws to the first participant by period', () => {
    expect(playerPeriodLinesFromPlays(rows)).toEqual([
      { playerId: '10', period: 1, points: 6, fgm: 2, fg3m: 1, ftm: 1 },
      { playerId: '20', period: 2, points: 2, fgm: 1, fg3m: 0, ftm: 0 },
      { playerId: '20', period: 5, points: 1, fgm: 0, fg3m: 0, ftm: 1 },
    ]);
  });

  it('ignores misses, non-shots, and rows without a period or scorer', () => {
    expect(
      playerPeriodLinesFromPlays([
        play({ period: 1, score_value: null, participants: [10] }),
        play({ period: null, scoring_play: true, score_value: 2, participants: [10] }),
        play({ period: 1, scoring_play: true, score_value: 2, participants: [] }),
      ])
    ).toEqual([]);
  });
});

describe('reconcileGameWithBox', () => {
  const lines = playerPeriodLinesFromPlays(rows);

  it('passes when made stats match the box score', () => {
    const res = reconcileGameWithBox(lines, [
      { playerId: '10', points: 6, fgm: 2, fg3m: 1, ftm: 1 },
      { playerId: '20', points: 3, fgm: 1, fg3m: 0, ftm: 1 },
      { playerId: '30', points: 0, fgm: 0, fg3m: 0, ftm: 0 },
    ]);
    expect(res).toEqual({ reconciled: true, mismatches: [] });
  });

  it('fails on a misattributed basket or a scorer missing from the box', () => {
    const res = reconcileGameWithBox(lines, [
      { playerId: '10', points: 4, fgm: 1, fg3m: 1, ftm: 1 },
    ]);
    expect(res.reconciled).toBe(false);
    expect(res.mismatches).toContain('10 points 6≠4');
    expect(res.mismatches).toContain('20 not in box score');
  });

  it('never reconciles an empty box score', () => {
    expect(reconcileGameWithBox([], []).reconciled).toBe(false);
  });
});
