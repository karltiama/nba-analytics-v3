import { describe, expect, it } from 'vitest';
import { extractPeriodScores, periodScoresParams } from '../period-scores';

const base = {
  id: 18446819,
  season: 2025,
  status: 'Final',
  home_team_score: 104,
  visitor_team_score: 104,
  home_q1: 27, home_q2: 24, home_q3: 24, home_q4: 29,
  visitor_q1: 30, visitor_q2: 27, visitor_q3: 22, visitor_q4: 25,
  home_ot1: null, home_ot2: null, home_ot3: null,
  visitor_ot1: null, visitor_ot2: null, visitor_ot3: null,
};

describe('extractPeriodScores', () => {
  it('reads four quarters for a regulation Final', () => {
    const p = extractPeriodScores(base)!;
    expect(p.homePeriods).toEqual([27, 24, 24, 29]);
    expect(p.visitorPeriods).toEqual([30, 27, 22, 25]);
    expect(p.periodCount).toBe(4);
    expect(p.overtimeCount).toBe(0);
    expect(p.reconciled).toBe(true);
  });

  it('appends overtime periods until the first missing one', () => {
    const p = extractPeriodScores({
      ...base,
      home_team_score: 125,
      visitor_team_score: 124,
      home_ot1: 11, visitor_ot1: 11,
      home_ot2: 10, visitor_ot2: 9,
    })!;
    expect(p.homePeriods).toEqual([27, 24, 24, 29, 11, 10]);
    expect(p.overtimeCount).toBe(2);
    expect(p.reconciled).toBe(true);
  });

  it('flags quarter sums that do not match the final', () => {
    expect(extractPeriodScores({ ...base, home_team_score: 105 })!.reconciled).toBe(false);
  });

  it('skips non-final games and games missing a quarter', () => {
    expect(extractPeriodScores({ ...base, status: '7:00 pm ET' })).toBeNull();
    expect(extractPeriodScores({ ...base, status: '3rd Qtr' })).toBeNull();
    expect(extractPeriodScores({ ...base, visitor_q3: null })).toBeNull();
    expect(extractPeriodScores({ ...base, id: undefined })).toBeNull();
  });

  it('builds params in SQL column order', () => {
    expect(periodScoresParams(extractPeriodScores(base)!)).toEqual([
      18446819, 2025, [27, 24, 24, 29], [30, 27, 22, 25], 4, 0, true,
    ]);
  });
});
