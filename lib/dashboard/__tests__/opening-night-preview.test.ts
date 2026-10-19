import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GameCard } from '@/components/betting/GameCard';
import {
  OPENING_NIGHT_DATE_LABEL,
  OPENING_NIGHT_GAMES_SQL,
  OPENING_NIGHT_HEADING,
  decideOpeningNightPreview,
  formatOpeningNightTip,
  isRenderableOpeningNightCard,
  presentOpeningNightGames,
  type OpeningNightSourceRow,
} from '@/lib/dashboard/opening-night-preview';

const NOON_OCT_18 = new Date('2026-10-18T16:00:00.000Z');
const BOS_TIP = new Date('2026-10-20T19:00:00.000Z');
const AFTER_PHI = new Date('2026-10-20T23:30:00.000Z');
const AFTER_ALL = new Date('2026-10-21T02:00:00.000Z');

function row(over: Partial<OpeningNightSourceRow> = {}): OpeningNightSourceRow {
  return {
    game_id: '21717855',
    season: '2026',
    season_phase: 'REGULAR',
    start_time: '2026-10-20T19:00:00.000Z',
    home_id: '9',
    home_name: 'Detroit Pistons',
    home_abbr: 'DET',
    away_id: '2',
    away_name: 'Boston Celtics',
    away_abbr: 'BOS',
    ...over,
  };
}

const SLATE: OpeningNightSourceRow[] = [
  row(),
  row({
    game_id: '21717856',
    start_time: '2026-10-20T23:00:00.000Z',
    home_id: '20',
    home_name: 'New York Knicks',
    home_abbr: 'NYK',
    away_id: '23',
    away_name: 'Philadelphia 76ers',
    away_abbr: 'PHI',
  }),
  row({
    game_id: '21717857',
    start_time: '2026-10-21T01:30:00.000Z',
    home_id: '27',
    home_name: 'San Antonio Spurs',
    home_abbr: 'SAS',
    away_id: '21',
    away_name: 'Oklahoma City Thunder',
    away_abbr: 'OKC',
  }),
];

function gate(over: Partial<Parameters<typeof decideOpeningNightPreview>[0]> = {}) {
  return decideOpeningNightPreview({
    todayEt: '2026-10-18',
    selectedDate: '2026-10-18',
    availability: 'ready',
    presentableScoreboardGames: 0,
    ...over,
  });
}

describe('opening night preview decision', () => {
  it('shows the preview on an empty default slate for October 18 and 19', () => {
    expect(gate().kind).toBe('preview');
    expect(gate({ todayEt: '2026-10-19', selectedDate: '2026-10-19' }).kind).toBe('preview');
  });

  it('lets real scoreboard games take precedence on October 20', () => {
    expect(
      gate({ todayEt: '2026-10-20', selectedDate: '2026-10-20', presentableScoreboardGames: 3 }).kind
    ).toBe('scoreboard');
  });

  it('uses the schedule preview on October 20 when the scoreboard slate is empty', () => {
    expect(gate({ todayEt: '2026-10-20', selectedDate: '2026-10-20' }).kind).toBe('preview');
  });

  it('expires on October 21', () => {
    expect(gate({ todayEt: '2026-10-21', selectedDate: '2026-10-21' }).kind).toBe('scoreboard');
  });

  it('leaves a manually selected date on the scoreboard path', () => {
    expect(gate({ selectedDate: '2026-10-16' }).kind).toBe('scoreboard');
    expect(gate({ selectedDate: '2026-10-20' }).kind).toBe('scoreboard');
    expect(gate({ todayEt: '2026-10-20', selectedDate: '2026-10-19' }).kind).toBe('scoreboard');
  });

  it('does not cover a scoreboard error or a disabled scoreboard', () => {
    expect(gate({ availability: 'error' }).kind).toBe('scoreboard');
    expect(gate({ availability: 'disabled' }).kind).toBe('scoreboard');
    expect(gate({ availability: 'loading' }).kind).toBe('defer');
  });
});

describe('opening night schedule rows', () => {
  it('keeps the verified teams, home/away order, and Eastern tip times', () => {
    const games = presentOpeningNightGames(SLATE, NOON_OCT_18);
    expect(games.map((game) => `${game.awayTeam.abbreviation}@${game.homeTeam.abbreviation} ${game.startTime}`)).toEqual([
      'BOS@DET 3:00 PM ET',
      'PHI@NYK 7:00 PM ET',
      'OKC@SAS 9:30 PM ET',
    ]);
    expect(games.map((game) => game.gameDate)).toEqual(['2026-10-20', '2026-10-20', '2026-10-20']);
    expect(games.every((game) => game.schedulePreview?.tipPassed === false)).toBe(true);
    expect(OPENING_NIGHT_HEADING).toBe('Opening Night Games');
    expect(OPENING_NIGHT_DATE_LABEL).toBe('Tuesday, October 20');
  });

  it('accepts the timestamptz text Postgres returns for the same instants', () => {
    const games = presentOpeningNightGames(
      [
        row({ start_time: '2026-10-20 19:00:00+00' }),
        row({
          game_id: '21717856',
          start_time: '2026-10-20 23:00:00+00',
          home_id: '20',
          home_name: 'New York Knicks',
          home_abbr: 'NYK',
          away_id: '23',
          away_name: 'Philadelphia 76ers',
          away_abbr: 'PHI',
        }),
        row({
          game_id: '21717857',
          start_time: '2026-10-21 01:30:00+00',
          home_id: '27',
          home_name: 'San Antonio Spurs',
          home_abbr: 'SAS',
          away_id: '21',
          away_name: 'Oklahoma City Thunder',
          away_abbr: 'OKC',
        }),
      ],
      NOON_OCT_18
    );
    expect(games.map((game) => game.startTime)).toEqual(['3:00 PM ET', '7:00 PM ET', '9:30 PM ET']);
  });

  it('formats the three tip instants in Eastern Time regardless of the host zone', () => {
    expect(formatOpeningNightTip('2026-10-20T19:00:00.000Z')).toBe('3:00 PM ET');
    expect(formatOpeningNightTip('2026-10-20T23:00:00.000Z')).toBe('7:00 PM ET');
    expect(formatOpeningNightTip('2026-10-21T01:30:00.000Z')).toBe('9:30 PM ET');
  });

  it('does not treat a raw ISO status or a stored 0-0 as a live game', () => {
    const polluted = SLATE.map((entry) => ({
      ...entry,
      status: entry.start_time,
      home_score: 0,
      away_score: 0,
    }));
    const games = presentOpeningNightGames(polluted, NOON_OCT_18);
    expect(games).toHaveLength(3);
    for (const game of games) {
      expect(game.status).toBeUndefined();
      expect(game.homeScore).toBeUndefined();
      expect(game.awayScore).toBeUndefined();
      expect(game.hasOdds).toBe(false);
      expect(game.scoreboard).toBeUndefined();
      expect(isRenderableOpeningNightCard(game)).toBe(true);
    }
  });

  it('marks only games whose tip has arrived, without calling them pregame', () => {
    const atTip = presentOpeningNightGames(SLATE, BOS_TIP);
    expect(atTip.map((game) => game.schedulePreview?.tipPassed)).toEqual([true, false, false]);
    const midSlate = presentOpeningNightGames(SLATE, AFTER_PHI);
    expect(midSlate.map((game) => game.schedulePreview?.tipPassed)).toEqual([true, true, false]);
    const done = presentOpeningNightGames(SLATE, AFTER_ALL);
    expect(done.every((game) => game.schedulePreview?.tipPassed)).toBe(true);
  });

  it('returns an honest empty list when analytics has no verified rows', () => {
    expect(presentOpeningNightGames([], NOON_OCT_18)).toEqual([]);
    expect(
      presentOpeningNightGames(
        [row({ away_abbr: 'NYK', home_abbr: 'BOS', start_time: '2026-10-20T23:30:00.000Z' })],
        NOON_OCT_18
      )
    ).toEqual([]);
  });

  it('drops a duplicated matchup instead of merging it', () => {
    const games = presentOpeningNightGames(
      [row(), row({ game_id: '999' }), SLATE[1], SLATE[2]],
      NOON_OCT_18
    );
    expect(games.map((game) => game.id)).toEqual(['21717856', '21717857']);
  });

  it('does not read scores or status in the schedule query', () => {
    expect(OPENING_NIGHT_GAMES_SQL).toMatch(/season_phase = 'REGULAR'/);
    expect(OPENING_NIGHT_GAMES_SQL).toMatch(/DATE '2026-10-20'/);
    expect(OPENING_NIGHT_GAMES_SQL).not.toMatch(/home_score|away_score|\bstatus\b/i);
    expect(OPENING_NIGHT_GAMES_SQL).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
  });
});

describe('opening night card', () => {
  it('renders schedule-only cards and a tip-passed card without a fictional live state', () => {
    const [upcoming, , later] = presentOpeningNightGames(SLATE, BOS_TIP);
    const before = renderToStaticMarkup(
      createElement(GameCard, { game: upcoming, presentation: 'scoreboard' })
    );
    const after = renderToStaticMarkup(
      createElement(GameCard, { game: later, presentation: 'scoreboard' })
    );
    expect(before).toContain('data-schedule-preview="tip-passed"');
    expect(before.indexOf('Boston')).toBeLessThan(before.indexOf('Detroit'));
    expect(before).toContain('Celtics');
    expect(before).toContain('Pistons');
    expect(before).toContain('3:00 PM ET');
    expect(before).toContain('Live score unavailable');
    expect(before).not.toContain('Scheduled');
    expect(before).not.toContain('data-phase="pregame"');
    expect(before).not.toContain('data-phase="live"');
    expect(before).not.toContain('>LIVE<');
    expect(before).not.toContain('Market spread');
    expect(before).not.toContain('0 – 0');
    expect(before).not.toContain('href="/betting/games/');

    expect(after).toContain('data-schedule-preview="upcoming"');
    expect(after.indexOf('Oklahoma')).toBeLessThan(after.indexOf('Antonio'));
    expect(after).toContain('Thunder');
    expect(after).toContain('Spurs');
    expect(after).toContain('9:30 PM ET');
    expect(after).toContain('Schedule preview');
    expect(after).not.toContain('Live score unavailable');
    expect(after).not.toContain('Scheduled');
  });
});
