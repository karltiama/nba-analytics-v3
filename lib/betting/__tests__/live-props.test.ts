import { describe, expect, it } from 'vitest';
import {
  blowoutRisk,
  buildLivePropRows,
  consensusLines,
  decimalToAmerican,
  gameElapsedMinutes,
  gameMinutesLeft,
  liveProgress,
  sortLiveProps,
  type PropQuoteRow,
} from '@/lib/betting/live-props';

const q = (book: string, line: number, side: 'over' | 'under', odds: number, propType = 'points', playerId = '1'): PropQuoteRow => ({
  playerId,
  playerName: 'Joel Embiid',
  sportsbook: book,
  propType,
  lineValue: line,
  side,
  oddsAmerican: odds,
  oddsDecimal: null,
});

describe('consensusLines', () => {
  it('takes each book main line, then the line most books agree on', () => {
    const rows = [
      // fanduel ladder: 24.5 is the even line
      q('fanduel', 22.5, 'over', -200), q('fanduel', 22.5, 'under', 160),
      q('fanduel', 24.5, 'over', -110), q('fanduel', 24.5, 'under', -110),
      q('draftkings', 24.5, 'over', -115), q('draftkings', 24.5, 'under', -105),
      q('caesars', 25.5, 'over', -105), q('caesars', 25.5, 'under', -115),
    ];
    const [line] = consensusLines(rows);
    expect(line).toMatchObject({ playerId: '1', playerName: 'Joel Embiid', propType: 'points', line: 24.5, books: 2, totalBooks: 3 });
  });

  it('gives the pregame median price and no-vig over chance from the books on that line', () => {
    const rows = [
      q('fanduel', 24.5, 'over', -110), q('fanduel', 24.5, 'under', -110),
      q('draftkings', 24.5, 'over', -130), q('draftkings', 24.5, 'under', 110),
      q('betmgm', 24.5, 'over', -120), q('betmgm', 24.5, 'under', 100),
      // caesars' main line is 25.5, so its prices are left out
      q('caesars', 25.5, 'over', 200), q('caesars', 25.5, 'under', -250),
      q('caesars', 24.5, 'over', -300), q('caesars', 24.5, 'under', 230),
    ];
    const [line] = consensusLines(rows);
    expect(line.line).toBe(24.5);
    expect(line.overOdds).toBe(-120);
    expect(line.underOdds).toBe(100);
    // betmgm -120/+100: 0.5455 / (0.5455 + 0.5) = 0.5217; the median of three books
    expect(line.overProb).toBeCloseTo(0.5217, 3);
  });

  it('converts decimal odds back to American', () => {
    expect(decimalToAmerican(2)).toBe(100);
    expect(decimalToAmerican(2.5)).toBe(150);
    expect(decimalToAmerican(1 + 100 / 110)).toBe(-110);
  });

  it('skips props the live box cannot grade and one-sided books', () => {
    const rows = [q('fanduel', 1.5, 'over', -110, 'steals'), q('fanduel', 1.5, 'under', -110, 'steals'), q('dk', 5.5, 'over', -110, 'assists')];
    expect(consensusLines(rows)).toEqual([]);
  });

  it('breaks a tie toward the lower line', () => {
    const rows = [
      q('a', 24.5, 'over', -110), q('a', 24.5, 'under', -110),
      q('b', 25.5, 'over', -110), q('b', 25.5, 'under', -110),
    ];
    expect(consensusLines(rows)[0].line).toBe(24.5);
  });
});

describe('game clock', () => {
  it('reads quarter clocks, halftime and overtime', () => {
    expect(gameElapsedMinutes(3, 'Q3 3:28')).toBeCloseTo(32.53, 2);
    expect(gameElapsedMinutes(2, 'Half')).toBe(24);
    expect(gameElapsedMinutes(1, 'Q1 12:00')).toBe(0);
    expect(gameElapsedMinutes(5, 'OT1 2:00')).toBe(51);
    expect(gameElapsedMinutes(2, 'End of 2nd')).toBe(24);
    expect(gameElapsedMinutes(null, 'Q1 5:00')).toBeNull();
    expect(gameElapsedMinutes(2, null)).toBeNull();
  });

  it('counts minutes left in regulation or the current overtime', () => {
    expect(gameMinutesLeft(3, 30)).toBe(18);
    expect(gameMinutesLeft(5, 51)).toBe(2);
    expect(gameMinutesLeft(3, null)).toBeNull();
  });
});

describe('liveProgress', () => {
  const base = { line: 24.5, typicalMinutes: 32, gameMinutesLeft: 20, gameElapsed: 28, final: false };

  it('marks a cleared line as hit', () => {
    expect(liveProgress({ ...base, current: 25, minutes: '20:00' })).toMatchObject({ status: 'hit', needed: 0 });
  });

  it('projects from per-minute rate over his remaining usual minutes', () => {
    // 16 pts in 20 min, 12 usual minutes left: 16 + 0.8 * 12 = 25.6
    const p = liveProgress({ ...base, current: 16, minutes: '20:00' });
    expect(p.status).toBe('on_pace');
    expect(p.projected).toBeCloseTo(25.6, 5);
    expect(p.needed).toBe(9);
  });

  it('caps remaining minutes by the game clock', () => {
    const p = liveProgress({ ...base, current: 16, minutes: '20:00', gameMinutesLeft: 4 });
    expect(p.minutesLeft).toBe(4);
    expect(p.status).toBe('behind');
  });

  it('falls back to his share of the game when usual minutes are unknown', () => {
    const p = liveProgress({ ...base, current: 14, minutes: '14:00', typicalMinutes: null, gameElapsed: 28, gameMinutesLeft: 20 });
    expect(p.minutesLeft).toBeCloseTo(10, 5);
    expect(p.projected).toBeCloseTo(24, 5);
    expect(p.status).toBe('behind');
  });

  it('holds off on pace before a few minutes and for players not in yet', () => {
    expect(liveProgress({ ...base, current: 2, minutes: '2:30' }).status).toBe('too_early');
    expect(liveProgress({ ...base, current: 0, minutes: '0:00' }).status).toBe('not_in');
    expect(liveProgress({ ...base, current: null, minutes: null }).status).toBe('not_in');
  });

  it('grades a finished game as hit or missed', () => {
    expect(liveProgress({ ...base, current: 20, minutes: '34:00', final: true })).toMatchObject({ status: 'missed', needed: 5 });
  });
});

describe('blowoutRisk', () => {
  it('flags big second-half margins', () => {
    expect(blowoutRisk(15, 4, 5)).toBeNull();
    expect(blowoutRisk(22, 2, 20)).toBeNull();
    expect(blowoutRisk(-22, 3, 15)?.level).toBe('watch');
    expect(blowoutRisk(21, 4, 6)?.level).toBe('high');
    expect(blowoutRisk(31, 3, 14)?.level).toBe('high');
  });
});

describe('buildLivePropRows and sorting', () => {
  const noPrice = { overOdds: null, underOdds: null, overProb: null };
  const lines = [
    { playerId: '1', playerName: 'A', propType: 'points', line: 20.5, books: 3, totalBooks: 3, ...noPrice },
    { playerId: '2', playerName: 'B', propType: 'rebounds', line: 8.5, books: 3, totalBooks: 3, ...noPrice },
    { playerId: '3', playerName: 'C', propType: 'points_rebounds_assists', line: 30.5, books: 3, totalBooks: 3, ...noPrice },
    { playerId: '4', playerName: 'D', propType: 'threes', line: 2.5, books: 3, totalBooks: 3, ...noPrice },
  ];
  const box = [
    { playerId: '1', teamId: 't', name: 'Alpha', min: '20:00', pts: 18, reb: 2, ast: 1, fg3m: 2 },
    { playerId: '2', teamId: 't', name: 'Bravo', min: '20:00', pts: 4, reb: 2, ast: 0, fg3m: 0 },
    { playerId: '3', teamId: 't', name: 'Charlie', min: '20:00', pts: 20, reb: 8, ast: 5, fg3m: 1 },
  ];
  const rows = buildLivePropRows({
    lines,
    box,
    typicalMinutes: new Map([['1', 32], ['2', 32], ['3', 32]]),
    period: 3,
    clock: 'Q3 8:00',
    final: false,
  });

  it('joins box stats to lines and sums combo props', () => {
    const c = rows.find((r) => r.playerId === '3')!;
    expect(c.current).toBe(33);
    expect(c.status).toBe('hit');
    expect(c.playerName).toBe('Charlie');
    const d = rows.find((r) => r.playerId === '4')!;
    expect(d.status).toBe('not_in');
    expect(d.playerName).toBe('D');
  });

  it('sorts closest-to-hitting and furthest-behind', () => {
    expect(sortLiveProps(rows, 'closest').map((r) => r.playerId)).toEqual(['1', '2', '4', '3']);
    expect(sortLiveProps(rows, 'behind')[0].playerId).toBe('2');
    expect(sortLiveProps(rows, 'behind').at(-1)!.playerId).toBe('3');
  });
});
