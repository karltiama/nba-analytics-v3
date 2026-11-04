import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PregameMatchupView } from '@/components/scoreboard/PregameMatchupView';
import type { TeamSumRow } from '@/lib/pregame-matchup/aggregate';
import { CURRENT_SEASON_MIN_GAMES, partialTeamProfile, teamProfile } from '@/lib/pregame-matchup/aggregate';
import { buildPregameMatchup, seasonSpan, type MatchupGameContext } from '@/lib/pregame-matchup/compose';
import { mergeSeasonRows, presentMatchupOverview, RATINGS_SCOPE } from '@/lib/pregame-matchup/overview';
import { currentSeasonTeamQuery } from '@/lib/pregame-matchup/queries';
import { presentRoster } from '@/lib/pregame-matchup/roster';
import { currentSeasonWindow } from '@/lib/pregame-matchup/window';

const ROSTER = presentRoster({ gameDate: '2026-11-04', day: null, teams: [] });

function sum(teamId: string, games: number, over: Partial<TeamSumRow> = {}): TeamSumRow {
  return {
    teamId,
    rows: games,
    games,
    points: games * 112,
    pointsAllowed: games * 110,
    possessions: games * 100,
    fgm: games * 42,
    fga: games * 88,
    fg3m: games * 12,
    fg3a: games * 35,
    fta: games * 22,
    turnovers: games * 13,
    offensiveRebounds: games * 10,
    defensiveRebounds: games * 33,
    opponentOffensiveRebounds: games * 10,
    opponentDefensiveRebounds: games * 33,
    badPossessions: 0,
    badShot: 0,
    badRebounds: 0,
    badTurnovers: 0,
    ...over,
  };
}

function league(): TeamSumRow[] {
  return Array.from({ length: 30 }, (_, index) => sum(String(index + 1), 82, { fg3a: 82 * (30 + index * 0.2) }));
}

const BASE = {
  gameId: '21718027',
  awayTeamId: '22',
  homeTeamId: '6',
  awayAbbr: 'ORL',
  awayName: 'Orlando Magic',
  homeAbbr: 'CLE',
  homeName: 'Cleveland Cavaliers',
  tipLabel: '7:00 PM EST',
  seasonLabel: 'Regular season',
  statusLabel: 'Scheduled',
  updatedLabel: 'Scoreboard Updated 4:03 PM EST',
  returnHref: '/dashboard?date=2026-11-04',
  identityConfirmed: true,
  teamRows: league(),
  playerRows: [],
  roster: ROSTER,
  quote: { quote: null, note: 'No verified pregame price is available.' },
};

describe('current-season window', () => {
  it('covers opening night up to, not including, the matchup date', () => {
    expect(currentSeasonWindow('2026', '2026-11-04')).toEqual({
      season: '2026',
      startInclusive: '2026-10-20',
      endExclusive: '2026-11-04',
      excludeDate: null,
    });
  });

  it('is absent on or before opening night, for the historical season, and for unknown seasons', () => {
    expect(currentSeasonWindow('2026', '2026-10-20')).toBeNull();
    expect(currentSeasonWindow('2026', '2026-10-11')).toBeNull();
    expect(currentSeasonWindow('2025', '2026-01-10')).toBeNull();
    expect(currentSeasonWindow('2031', '2031-11-04')).toBeNull();
  });

  it('skips the Cup Final only when its date is known', () => {
    const window = currentSeasonWindow('2026', '2026-11-04')!;
    const query = currentSeasonTeamQuery(window);
    expect(query.params).toEqual(['2026', '2026-10-20', '2026-11-04', null]);
    expect(query.text).toContain('$4::date IS NULL OR game_date <> $4::date');
    expect(query.text).toContain('FROM analytics.team_game_stats');
  });
});

describe('partial team profile', () => {
  it('accepts a short clean sample at the floor and rejects below it', () => {
    expect(partialTeamProfile(sum('1', CURRENT_SEASON_MIN_GAMES))?.games).toBe(CURRENT_SEASON_MIN_GAMES);
    expect(partialTeamProfile(sum('1', CURRENT_SEASON_MIN_GAMES - 1))).toBeNull();
    expect(teamProfile(sum('1', 8))).toBeNull();
  });

  it('rejects duplicate rows and incomplete box scores', () => {
    expect(partialTeamProfile(sum('1', 6, { rows: 7 }))).toBeNull();
    expect(partialTeamProfile(sum('1', 6, { badPossessions: 1 }))).toBeNull();
  });
});

describe('current season in the matchup model', () => {
  it('leads the comparison with this season and keeps 2025–26 under each value', () => {
    const model = buildPregameMatchup({
      ...BASE,
      current: { season: '2026', teamRows: [sum('22', 7, { points: 7 * 120 }), sum('6', 8)] },
    });
    expect(model.current?.seasonLabel).toBe('2026–27');
    expect(model.current?.label).toBe('2026–27 so far · ORL 7 games · CLE 8 games');
    expect(model.currentNote).toBeNull();
    const merged = mergeSeasonRows(model.current, model.history?.rows);
    const offense = merged.find((row) => row.label === 'Offensive rating')!;
    expect(offense.away).toBe('120.0');
    expect(offense.priorAway).toBe('112.0');

    const overview = presentMatchupOverview({ ...model, current: model.current });
    expect(overview.comparison.label).toBe(model.current?.label);
    expect(overview.comparison.rows[0]?.priorAway).toBeDefined();
    expect(overview.story.caveat).not.toContain(RATINGS_SCOPE);
    expect(overview.story.caveat).toContain('Key findings use full 2025–26');
  });

  it('explains a missing current sample instead of showing a partial one', () => {
    const model = buildPregameMatchup({
      ...BASE,
      current: { season: '2026', teamRows: [sum('22', 2), sum('6', 8)] },
    });
    expect(model.current).toBeNull();
    expect(model.currentNote).toBe('2026–27 numbers appear once both teams have 3 complete games.');
  });

  it('shows no current season when team identity is unconfirmed', () => {
    const model = buildPregameMatchup({
      ...BASE,
      identityConfirmed: false,
      current: { season: '2026', teamRows: [sum('22', 7), sum('6', 8)] },
    });
    expect(model.current).toBeNull();
    expect(model.currentNote).toBeNull();
  });

  it('formats season spans', () => {
    expect(seasonSpan('2026')).toBe('2026–27');
    expect(seasonSpan('2099')).toBe('2099–00');
  });
});

describe('matchup page', () => {
  const context: MatchupGameContext = {
    schedule: 'ORL on a back-to-back · CLE 2 days rest',
    injuries: {
      status: 'listed',
      text: 'ORL: Banchero (Out) · CLE: no key injuries listed · as of 3:10 PM ET',
      asOfLabel: 'as of 3:10 PM ET',
      teams: [
        { abbr: 'ORL', players: [{ name: 'Banchero', status: 'Out' }], extra: 1 },
        { abbr: 'CLE', players: [], extra: 0 },
      ],
    },
  };

  it('renders the Tonight strip and current values with 2025–26 underneath', () => {
    const model = buildPregameMatchup({
      ...BASE,
      current: { season: '2026', teamRows: [sum('22', 7), sum('6', 8)] },
      context,
    });
    const html = renderToStaticMarkup(createElement(PregameMatchupView, { model }));
    expect(html).toContain('id="section-tonight"');
    expect(html).toContain('href="#section-tonight"');
    expect(html).toContain('ORL on a back-to-back');
    expect(html).toContain('Banchero');
    expect(html).toContain('+1 more');
    expect(html).toContain('No key injuries listed');
    expect(html).toContain('Team Comparison');
    expect(html).toContain('data-prior-value');
  });

  it('omits the strip when card context is off, and keeps the 2025–26 heading without a current sample', () => {
    const model = buildPregameMatchup(BASE);
    const html = renderToStaticMarkup(createElement(PregameMatchupView, { model }));
    expect(html).not.toContain('section-tonight');
    expect(html).toContain('2025–26 Team Identity');
    expect(html).not.toContain('data-prior-value');
  });

  it('shows the unavailable injury text as-is', () => {
    const model = buildPregameMatchup({
      ...BASE,
      context: { schedule: null, injuries: { status: 'unavailable', text: 'Injury report unavailable', asOfLabel: null, teams: null } },
    });
    const html = renderToStaticMarkup(createElement(PregameMatchupView, { model }));
    expect(html).toContain('Injury report unavailable');
    expect(html).toContain('Schedule context unavailable.');
  });
});
