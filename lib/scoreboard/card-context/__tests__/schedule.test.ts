import { describe, expect, it } from 'vitest';
import {
  buildScheduleLine,
  deriveTeamSchedule,
  etDateFromInstant,
  etDayDiff,
  type ScheduleGameRow,
} from '@/lib/scoreboard/card-context/schedule';

const GAME = '2026-11-04';

function row(over: Partial<ScheduleGameRow> & Pick<ScheduleGameRow, 'etDate'>): ScheduleGameRow {
  return {
    seasonPhase: 'REGULAR',
    status: 'Final',
    homeTeamId: 'okc',
    awayTeamId: 'other',
    ...over,
  };
}

function line(games: ScheduleGameRow[] | null, away = 'okc', home = 'cle', gameEtDate = GAME, season = '2026') {
  return buildScheduleLine({
    gameEtDate,
    season,
    awayTeamId: away,
    homeTeamId: home,
    awayAbbr: 'OKC',
    homeAbbr: 'CLE',
    games,
  });
}

describe('schedule context', () => {
  it('counts a back-to-back, 1 day, 2 days, and 3 or more days of rest', () => {
    expect(deriveTeamSchedule({ teamId: 'okc', gameEtDate: GAME, season: '2026', games: [row({ etDate: '2026-11-03' })] })).toEqual({
      kind: 'rest',
      daysRest: 0,
      thirdInFour: false,
    });
    expect(deriveTeamSchedule({ teamId: 'okc', gameEtDate: GAME, season: '2026', games: [row({ etDate: '2026-11-02' })] })).toMatchObject({
      daysRest: 1,
    });
    expect(deriveTeamSchedule({ teamId: 'okc', gameEtDate: GAME, season: '2026', games: [row({ etDate: '2026-11-01' })] })).toMatchObject({
      daysRest: 2,
    });
    expect(deriveTeamSchedule({ teamId: 'okc', gameEtDate: GAME, season: '2026', games: [row({ etDate: '2026-10-30' })] })).toMatchObject({
      daysRest: 4,
    });
    expect(line([row({ etDate: '2026-11-03' }), row({ etDate: '2026-11-02', homeTeamId: 'cle', awayTeamId: 'other' })])).toEqual({
      status: 'ready',
      text: 'OKC on 2nd night of a back-to-back · CLE 1 day rest',
    });
    expect(line([row({ etDate: '2026-11-01' }), row({ etDate: '2026-11-01', homeTeamId: 'cle', awayTeamId: 'other' })])).toEqual({
      status: 'ready',
      text: 'Both teams on 2 days rest',
    });
  });

  it('prefers 3rd game in 4 nights over a back-to-back on the same team', () => {
    const games = [
      row({ etDate: '2026-11-01', homeTeamId: 'det' }),
      row({ etDate: '2026-11-03', homeTeamId: 'det' }),
      row({ etDate: '2026-11-02', homeTeamId: 'cha' }),
    ];
    expect(
      buildScheduleLine({
        gameEtDate: GAME,
        season: '2026',
        awayTeamId: 'det',
        homeTeamId: 'cha',
        awayAbbr: 'DET',
        homeAbbr: 'CHA',
        games,
      })
    ).toEqual({
      status: 'ready',
      text: 'DET: 3rd game in 4 nights · CHA 1 day rest',
    });
  });

  it('does not call a coverage gap a season opener once opening week has passed', () => {
    expect(line([])).toEqual({ status: 'unavailable', text: 'Schedule context unavailable.' });
    expect(line([row({ etDate: '2026-11-02', homeTeamId: 'cle' })])).toEqual({
      status: 'ready',
      text: 'OKC: rest unavailable · CLE 1 day rest',
    });
  });

  it('allows a season opener only within 7 ET days of the regular-season open', () => {
    expect(deriveTeamSchedule({ teamId: 'okc', gameEtDate: '2026-10-20', season: '2026', games: [] })).toEqual({
      kind: 'opener',
    });
    expect(deriveTeamSchedule({ teamId: 'okc', gameEtDate: '2026-10-25', season: '2026', games: [] })).toEqual({
      kind: 'opener',
    });
    expect(deriveTeamSchedule({ teamId: 'okc', gameEtDate: '2026-11-03', season: '2026', games: [] })).toEqual({
      kind: 'unavailable',
    });
    expect(deriveTeamSchedule({ teamId: 'okc', gameEtDate: '2026-10-20', season: '2099', games: [] })).toEqual({
      kind: 'unavailable',
    });
    expect(line([], 'okc', 'cle', '2026-10-20')).toEqual({ status: 'ready', text: 'Both teams: season openers' });
    expect(line([], 'okc', 'cle', '2026-10-25').text).toBe('Both teams: season openers');
    expect(line([], 'okc', 'cle', '2026-11-03')).toEqual({
      status: 'unavailable',
      text: 'Schedule context unavailable.',
    });
    expect(line([], 'okc', 'cle', '2026-10-20', '2099')).toEqual({
      status: 'unavailable',
      text: 'Schedule context unavailable.',
    });
  });

  it('counts an IST game and refuses rest off a playoff or unclassified game', () => {
    expect(
      line([
        row({ etDate: '2026-11-03', seasonPhase: 'IST' }),
        row({ etDate: '2026-11-03', homeTeamId: 'cle', seasonPhase: 'IST' }),
      ]).text
    ).toBe('Both teams on the 2nd night of a back-to-back');
    expect(line([row({ etDate: '2026-11-03', seasonPhase: 'PLAYOFFS' })])).toEqual({
      status: 'unavailable',
      text: 'Schedule context unavailable.',
    });
  });

  it('ignores preseason and does not use it as the previous game', () => {
    const games = [
      row({ etDate: '2026-11-03', seasonPhase: 'PRESEASON' }),
      row({ etDate: '2026-11-01' }),
      row({ etDate: '2026-11-01', homeTeamId: 'cle' }),
    ];
    expect(line(games).text).toBe('Both teams on 2 days rest');
  });

  it('says rest is unavailable when the previous game is missing, duplicated, or not a verified final', () => {
    expect(line(null)).toEqual({ status: 'unavailable', text: 'Schedule context unavailable.' });
    expect(line([row({ etDate: '2026-11-03', homeTeamId: 'cle' })])).toEqual({
      status: 'ready',
      text: 'OKC: rest unavailable · CLE on 2nd night of a back-to-back',
    });
    const missingAway = line(null);
    expect(missingAway.status).toBe('unavailable');
    expect(
      buildScheduleLine({
        gameEtDate: GAME,
        season: '2026',
        awayTeamId: 'okc',
        homeTeamId: 'cle',
        awayAbbr: 'OKC',
        homeAbbr: 'CLE',
        games: [row({ etDate: '2026-11-03' }), row({ etDate: '2026-11-03', awayTeamId: 'dup' })],
      })
    ).toEqual({ status: 'unavailable', text: 'Schedule context unavailable.' });
    expect(line([row({ etDate: '2026-11-03', status: 'In Progress' }), row({ etDate: '2026-11-02', homeTeamId: 'cle' })]).text).toBe(
      'OKC: rest unavailable · CLE 1 day rest'
    );
    expect(line([row({ etDate: '2026-11-03', seasonPhase: 'UNCLASSIFIED' })])).toEqual({
      status: 'unavailable',
      text: 'Schedule context unavailable.',
    });
  });

  it('uses the ET date, so a late West Coast tip is the next basketball day', () => {
    expect(etDateFromInstant(new Date('2026-11-02T03:00:00.000Z'))).toBe('2026-11-01');
    expect(etDateFromInstant(new Date('2026-11-02T06:30:00.000Z'))).toBe('2026-11-02');
    expect(etDayDiff('2026-11-02', '2026-11-01')).toBe(1);
    const prior = row({ etDate: '2026-11-01' });
    const home = row({ etDate: '2026-11-01', homeTeamId: 'cle' });
    expect(
      buildScheduleLine({
        gameEtDate: '2026-11-02',
        season: '2026',
        awayTeamId: 'okc',
        homeTeamId: 'cle',
        awayAbbr: 'OKC',
        homeAbbr: 'CLE',
        games: [prior, home],
      }).text
    ).toBe('Both teams on the 2nd night of a back-to-back');
  });
});
