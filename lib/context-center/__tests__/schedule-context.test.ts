import { describe, expect, it } from 'vitest';
import {
  assertScheduleInvariants,
  computeTeamGameSchedule,
  etDateDiffDays,
  isEligibleCompletedGame,
  resolveHomeAway,
  selectPreviousCompletedGame,
  type ScheduleGameRow,
} from '@/lib/context-center';
import { etCalendarDate } from '@/lib/wowy/calendar';

function g(partial: Partial<ScheduleGameRow> & Pick<ScheduleGameRow, 'gameId' | 'startTime'>): ScheduleGameRow {
  return {
    season: '2025',
    status: 'Final',
    homeTeamId: '1',
    awayTeamId: '2',
    homeScore: 100,
    awayScore: 98,
    ...partial,
  };
}

describe('schedule-context-v1', () => {
  it('A/B resolves HOME and AWAY from team IDs', () => {
    const game = g({ gameId: 't1', startTime: '2025-11-11T00:00:00Z', homeTeamId: '10', awayTeamId: '20' });
    expect(resolveHomeAway('10', game)).toBe('HOME');
    expect(resolveHomeAway('20', game)).toBe('AWAY');
    expect(() => resolveHomeAway('99', game)).toThrow(/HOME\/AWAY identity failure/);
  });

  it('C/D/E exact rest outputs for consecutive basketball dates', () => {
    const prev = g({
      gameId: 'p',
      startTime: '2026-11-11T00:00:00Z', // 2026-11-10 19:00 ET
      homeTeamId: '7',
      awayTeamId: '8',
    });
    // Verify ET date of previous
    expect(etCalendarDate(prev.startTime)).toBe('2026-11-10');

    const b2b = g({
      gameId: 't0',
      startTime: '2026-11-12T00:30:00Z', // 2026-11-11 19:30 ET
      homeTeamId: '7',
      awayTeamId: '9',
    });
    expect(etCalendarDate(b2b.startTime)).toBe('2026-11-11');
    const s0 = computeTeamGameSchedule({ teamId: '7', target: b2b, history: [prev, b2b] });
    expect(s0.schedule.daysRest).toBe(0);
    expect(s0.schedule.backToBack).toBe(true);
    assertScheduleInvariants(s0);

    const d1 = g({
      gameId: 't1',
      startTime: '2026-11-13T00:00:00Z', // 2026-11-12 ET
      homeTeamId: '7',
      awayTeamId: '9',
    });
    expect(etCalendarDate(d1.startTime)).toBe('2026-11-12');
    const s1 = computeTeamGameSchedule({ teamId: '7', target: d1, history: [prev, d1] });
    expect(s1.schedule.daysRest).toBe(1);
    expect(s1.schedule.backToBack).toBe(false);

    const d2 = g({
      gameId: 't2',
      startTime: '2026-11-14T00:00:00Z', // 2026-11-13 ET
      homeTeamId: '7',
      awayTeamId: '9',
    });
    const s2 = computeTeamGameSchedule({ teamId: '7', target: d2, history: [prev, d2] });
    expect(s2.schedule.daysRest).toBe(2);
    expect(s2.schedule.backToBack).toBe(false);
  });

  it('F. season opener → null rest, backToBack false, COMPLETE', () => {
    const opener = g({ gameId: 'op', startTime: '2025-10-22T23:30:00Z', homeTeamId: '7', awayTeamId: '8' });
    // prior season final must not count
    const prevSeason = g({
      gameId: 'old',
      season: '2024',
      startTime: '2025-06-01T00:00:00Z',
      homeTeamId: '7',
      awayTeamId: '8',
    });
    const snap = computeTeamGameSchedule({
      teamId: '7',
      target: opener,
      history: [prevSeason, opener],
    });
    expect(snap.schedule.isSeasonOpener).toBe(true);
    expect(snap.schedule.daysRest).toBeNull();
    expect(snap.schedule.backToBack).toBe(false);
    expect(snap.completeness.status).toBe('COMPLETE');
    assertScheduleInvariants(snap);
  });

  it('G. same-tip prior excluded', () => {
    const tip = '2025-12-01T00:30:00Z';
    const target = g({ gameId: 't', startTime: tip, homeTeamId: '7', awayTeamId: '8' });
    const sameTip = g({ gameId: 'other', startTime: tip, homeTeamId: '7', awayTeamId: '9' });
    const earlier = g({
      gameId: 'e',
      startTime: '2025-11-28T00:30:00Z',
      homeTeamId: '7',
      awayTeamId: '10',
    });
    const prev = selectPreviousCompletedGame({
      teamId: '7',
      target,
      history: [sameTip, earlier, target],
    });
    expect(prev?.gameId).toBe('e');
  });

  it('H. future mutation does not change result', () => {
    const prev = g({
      gameId: 'p',
      startTime: '2025-11-10T00:00:00Z',
      homeTeamId: '7',
      awayTeamId: '8',
    });
    const target = g({
      gameId: 't',
      startTime: '2025-11-13T00:00:00Z',
      homeTeamId: '7',
      awayTeamId: '9',
    });
    const future = g({
      gameId: 'f',
      startTime: '2025-12-01T00:00:00Z',
      homeTeamId: '7',
      awayTeamId: '11',
    });
    const a = computeTeamGameSchedule({ teamId: '7', target, history: [prev, target] });
    const b = computeTeamGameSchedule({ teamId: '7', target, history: [prev, target, future] });
    expect(a.schedule).toEqual(b.schedule);
    expect(a.provenance.previousGameId).toBe(b.provenance.previousGameId);
  });

  it('I. postponed/non-final prior ignored', () => {
    const postponed = g({
      gameId: 'pp',
      startTime: '2025-11-10T00:00:00Z',
      status: 'Postponed',
      homeTeamId: '7',
      awayTeamId: '8',
      homeScore: null,
      awayScore: null,
    });
    const final = g({
      gameId: 'f',
      startTime: '2025-11-08T00:00:00Z',
      homeTeamId: '7',
      awayTeamId: '8',
    });
    const target = g({
      gameId: 't',
      startTime: '2025-11-12T00:00:00Z',
      homeTeamId: '7',
      awayTeamId: '9',
    });
    expect(isEligibleCompletedGame(postponed)).toBe(false);
    const prev = selectPreviousCompletedGame({
      teamId: '7',
      target,
      history: [postponed, final, target],
    });
    expect(prev?.gameId).toBe('f');
  });

  it('J. wrong-team history does not count', () => {
    const other = g({
      gameId: 'o',
      startTime: '2025-11-10T00:00:00Z',
      homeTeamId: '99',
      awayTeamId: '98',
    });
    const target = g({
      gameId: 't',
      startTime: '2025-11-12T00:00:00Z',
      homeTeamId: '7',
      awayTeamId: '8',
    });
    const snap = computeTeamGameSchedule({ teamId: '7', target, history: [other, target] });
    expect(snap.schedule.isSeasonOpener).toBe(true);
  });

  it('K. ET vs UTC basketball-date boundary', () => {
    // 00:30 UTC on Nov 12 is still Nov 11 ET
    const prev = g({
      gameId: 'p',
      startTime: '2025-11-11T00:30:00Z',
      homeTeamId: '7',
      awayTeamId: '8',
    });
    const target = g({
      gameId: 't',
      startTime: '2025-11-12T00:30:00Z',
      homeTeamId: '7',
      awayTeamId: '9',
    });
    expect(etCalendarDate(prev.startTime)).toBe('2025-11-10');
    expect(etCalendarDate(target.startTime)).toBe('2025-11-11');
    const snap = computeTeamGameSchedule({ teamId: '7', target, history: [prev, target] });
    expect(snap.schedule.daysRest).toBe(0);
    expect(snap.schedule.backToBack).toBe(true);
  });

  it('L/M month and year boundary within season', () => {
    const dec = g({
      gameId: 'd',
      season: '2024',
      startTime: '2024-12-31T00:30:00Z',
      homeTeamId: '7',
      awayTeamId: '8',
    });
    const jan = g({
      gameId: 'j',
      season: '2024',
      startTime: '2025-01-02T00:30:00Z',
      homeTeamId: '7',
      awayTeamId: '9',
    });
    const snap = computeTeamGameSchedule({ teamId: '7', target: jan, history: [dec, jan] });
    expect(snap.provenance.targetBasketballDate).toBe('2025-01-01');
    expect(snap.provenance.previousBasketballDate).toBe('2024-12-30');
    expect(snap.schedule.daysRest).toBe(1);
  });

  it('ambiguous identical prior timestamps fail closed', () => {
    const tip = '2025-11-10T00:00:00Z';
    const a = g({ gameId: 'a', startTime: tip, homeTeamId: '7', awayTeamId: '8' });
    const b = g({ gameId: 'b', startTime: tip, homeTeamId: '7', awayTeamId: '9' });
    const target = g({
      gameId: 't',
      startTime: '2025-11-12T00:00:00Z',
      homeTeamId: '7',
      awayTeamId: '10',
    });
    expect(() =>
      selectPreviousCompletedGame({ teamId: '7', target, history: [a, b, target] })
    ).toThrow(/Ambiguous prior/);
  });

  it('etDateDiffDays matches rest formula helpers', () => {
    expect(etDateDiffDays('2026-11-11', '2026-11-10')).toBe(1);
    expect(etDateDiffDays('2026-11-12', '2026-11-10')).toBe(2);
  });
});
