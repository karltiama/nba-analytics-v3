import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ResearchMatchupOverview } from '@/components/matchup/ResearchMatchupOverview';
import type { TeamSumRow } from '@/lib/pregame-matchup/aggregate';
import { buildPregameMatchup } from '@/lib/pregame-matchup/compose';
import { loadResearchOverview } from '@/lib/pregame-matchup/from-analytics-game';
import { presentRoster } from '@/lib/pregame-matchup/roster';
import {
  etCalendarDate,
  researchOverviewAllowsLifecycle,
  researchOverviewTemporalDecision,
} from '@/lib/pregame-matchup/research-overview';
import { MIN_STANDARDIZED_GAP } from '@/lib/pregame-matchup/signals';

const NOW = new Date('2026-10-20T16:00:00.000Z');
const TIP = '2026-10-20T23:00:00.000Z';
const BATCH_ID = '65912e16-9343-51b0-8e29-9cbb99ada16b';

function sum(teamId: string, over: Partial<TeamSumRow> = {}): TeamSumRow {
  return {
    teamId,
    rows: 82,
    games: 82,
    points: 82 * 112,
    pointsAllowed: 82 * 110,
    possessions: 82 * 100,
    fgm: 82 * 42,
    fga: 82 * 88,
    fg3m: 82 * 12,
    fg3a: 82 * 35,
    fta: 82 * 22,
    turnovers: 82 * 13,
    offensiveRebounds: 82 * 10,
    defensiveRebounds: 82 * 33,
    opponentOffensiveRebounds: 82 * 10,
    opponentDefensiveRebounds: 82 * 33,
    badPossessions: 0,
    badShot: 0,
    badRebounds: 0,
    badTurnovers: 0,
    ...over,
  };
}

function league(): TeamSumRow[] {
  return Array.from({ length: 30 }, (_, index) => {
    const teamId = String(index + 1);
    return sum(teamId, {
      fg3a: 82 * (30 + index * 0.4),
      points: 82 * (100 + (teamId === '2' ? 28 : 8)),
      pointsAllowed: 82 * (100 + (teamId === '9' ? 2 : 14)),
    });
  });
}

function teamSql(row: TeamSumRow): Record<string, unknown> {
  return {
    team_id: row.teamId,
    rows: row.rows,
    games: row.games,
    points: row.points,
    points_allowed: row.pointsAllowed,
    possessions: row.possessions,
    fgm: row.fgm,
    fga: row.fga,
    fg3m: row.fg3m,
    fg3a: row.fg3a,
    fta: row.fta,
    turnovers: row.turnovers,
    offensive_rebounds: row.offensiveRebounds,
    defensive_rebounds: row.defensiveRebounds,
    opponent_offensive_rebounds: row.opponentOffensiveRebounds,
    opponent_defensive_rebounds: row.opponentDefensiveRebounds,
    bad_possessions: row.badPossessions,
    bad_shot: row.badShot,
    bad_rebounds: row.badRebounds,
    bad_turnovers: row.badTurnovers,
  };
}

function gameRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    game_id: '21681995',
    start_time: TIP,
    status: 'Scheduled',
    home_score: null,
    away_score: null,
    home_team_id: '9',
    away_team_id: '2',
    home_team_name: 'Detroit Pistons',
    home_team_abbr: 'DET',
    home_conference: 'East',
    away_team_name: 'Boston Celtics',
    away_team_abbr: 'BOS',
    away_conference: 'East',
    ...over,
  };
}

function identityRows(): Record<string, unknown>[] {
  return [
    { team_id: '2', abbreviation: 'BOS', full_name: 'Boston Celtics', conference: 'East' },
    { team_id: '9', abbreviation: 'DET', full_name: 'Detroit Pistons', conference: 'East' },
  ];
}

type Fixture = {
  game?: Record<string, unknown>[] | 'throw' | 'throw-history';
  identity?: Record<string, unknown>[];
  teams?: TeamSumRow[];
  players?: Record<string, unknown>[];
  stored?: Record<string, unknown> | null;
  latest?: Record<string, unknown> | null;
  members?: Record<string, unknown>[];
  production?: Record<string, unknown>[];
  other?: Record<string, unknown>[];
  map?: Record<string, unknown>[];
};

function fixtureSql(input: Fixture = {}) {
  const calls: string[] = [];
  const run = async (text: string, params?: unknown[]) => {
    calls.push(text);
    expect(text).not.toMatch(/\b(insert|update|delete)\b/i);
    expect(text).not.toContain('scoreboard_games');
    if (text.includes('FROM analytics.games')) {
      if (input.game === 'throw' || input.game === 'throw-history') throw new Error('connection refused');
      return input.game ?? [gameRow()];
    }
    if (text.includes('collected_at <')) return input.stored ? [input.stored] : [];
    if (text.includes('roster_observation_batches')) return input.latest ? [input.latest] : [];
    if (text.includes('FROM raw.teams')) return input.map ?? [];
    if (text.includes('roster_observation_members')) {
      const abbr = String(params?.[1] ?? '');
      return (input.members ?? []).filter((row) => String(row.team_abbreviation) === abbr);
    }
    if (text.includes('analytics.team_game_stats')) {
      if (input.game === 'throw-history') throw new Error('connection refused');
      return (input.teams ?? league()).map(teamSql);
    }
    if (text.includes('pl.full_name')) return input.players ?? [];
    if (text.includes('NOT (l.team_id')) return input.other ?? [];
    if (text.includes('free_throws_attempted')) return input.production ?? [];
    if (text.includes('FROM analytics.teams')) return input.identity ?? identityRows();
    throw new Error(`unexpected sql: ${text.slice(0, 120)}`);
  };
  return { run, calls };
}

function batch(over: Record<string, unknown> = {}) {
  return {
    batch_id: BATCH_ID,
    provider: 'balldontlie',
    season_label: '2026-27',
    collected_at: '2026-10-19T15:00:00.000Z',
    status: 'complete',
    gate_ok: true,
    team_count: 30,
    player_count: 500,
    ...over,
  };
}

describe('research overview eligibility', () => {
  it('hides the 2025–26 sample for games inside that season, including a late UTC tip that is still the prior Eastern date', () => {
    expect(researchOverviewTemporalDecision('2026-01-15').reason).toBe('during_or_before_baseline');
    expect(researchOverviewTemporalDecision('2026-04-13').reason).toBe('during_or_before_baseline');
    expect(researchOverviewTemporalDecision('2025-12-25').eligible).toBe(false);
    expect(researchOverviewTemporalDecision(null).reason).toBe('missing_date');
    expect(researchOverviewTemporalDecision('2026-04-14')).toEqual({ eligible: true, gameEtDate: '2026-04-14' });
    expect(etCalendarDate(new Date('2026-04-14T03:30:00.000Z'))).toBe('2026-04-13');
    expect(etCalendarDate(new Date('2026-04-14T04:00:00.000Z'))).toBe('2026-04-14');
    expect(researchOverviewAllowsLifecycle('scheduled')).toBe(true);
    expect(researchOverviewAllowsLifecycle('live')).toBe(true);
    expect(researchOverviewAllowsLifecycle('final')).toBe(false);
    expect(researchOverviewAllowsLifecycle('unknown')).toBe(false);
    expect(MIN_STANDARDIZED_GAP).toBe(1);
  });
});

describe('loadResearchOverview', () => {
  it('loads an analytics game with no scoreboard row and matches the shared historical model', async () => {
    const players = [
      { team_id: '2', player_id: '10', full_name: 'Jayson Tatum', games: 70, minutes: 2400, points: 1900, fga: 1400, usage_mass: 280, usage_possessions: 1000 },
      { team_id: '9', player_id: '20', full_name: 'Cade Cunningham', games: 68, minutes: 2300, points: 1600, fga: 1300, usage_mass: 250, usage_possessions: 1000 },
    ];
    const sql = fixtureSql({ players });
    const overview = await loadResearchOverview({ gameId: '21681995', now: NOW, query: sql.run });
    const direct = buildPregameMatchup({
      gameId: '21681995',
      awayTeamId: '2',
      homeTeamId: '9',
      awayAbbr: 'BOS',
      awayName: 'Boston Celtics',
      homeAbbr: 'DET',
      homeName: 'Detroit Pistons',
      tipLabel: '',
      seasonLabel: '',
      statusLabel: '',
      updatedLabel: '',
      returnHref: '',
      identityConfirmed: true,
      teamRows: league(),
      playerRows: players.map((row) => ({
        teamId: String(row.team_id),
        playerId: String(row.player_id),
        name: String(row.full_name),
        games: row.games,
        minutes: row.minutes,
        points: row.points,
        fga: row.fga,
        usageMass: row.usage_mass,
        usagePossessions: row.usage_possessions,
      })),
      roster: presentRoster({ gameDate: '2026-10-20', day: null, teams: [] }),
      quote: { quote: null, note: null },
    });
    expect(overview?.awayAbbr).toBe('BOS');
    expect(overview?.homeAbbr).toBe('DET');
    expect(overview?.history).toEqual(direct.history);
    expect(overview?.historyNote).toEqual(direct.historyNote);
    expect(overview?.insights).toEqual(direct.insights);
    expect(overview?.contributors?.membership).toBe('unavailable');
    expect(overview?.contributors?.unavailableNote).toBe(overview?.roster.note);
    expect(overview?.contributors?.awayCurrent).toEqual([]);
    expect(overview?.contributors?.homeCurrent).toEqual([]);
    expect(overview?.contributors?.awayHistorical).toEqual(direct.contributors?.awayHistorical);
    expect(overview?.contributors?.homeHistorical).toEqual(direct.contributors?.homeHistorical);
    expect(overview?.roster.status).toBe('hidden');
    expect(overview?.roster.teams).toBeNull();
    expect(overview?.history?.rows).toHaveLength(9);
    expect(overview?.history?.label).toContain('2025–26');
    expect(sql.calls.filter((text) => text.includes('analytics.team_game_stats'))).toHaveLength(1);
    expect(sql.calls.filter((text) => text.includes('pl.full_name'))).toHaveLength(1);
    expect(sql.calls.some((text) => text.includes('scoreboard'))).toBe(false);
    expect(JSON.parse(JSON.stringify(overview))).toEqual(overview);
  });

  it('does not query history for a missing game, an older game, a final game, or an unknown lifecycle', async () => {
    const missing = fixtureSql({ game: [] });
    expect(await loadResearchOverview({ gameId: 'missing', now: NOW, query: missing.run })).toBeNull();

    const older = fixtureSql({ game: [gameRow({ start_time: '2026-04-14T03:30:00.000Z' })] });
    expect(await loadResearchOverview({ gameId: '21681995', now: new Date('2026-04-13T12:00:00.000Z'), query: older.run })).toBeNull();

    const later = fixtureSql({ game: [gameRow({ start_time: '2026-04-14T04:00:00.000Z' })] });
    const opened = await loadResearchOverview({
      gameId: '21681995',
      now: new Date('2026-04-14T03:00:00.000Z'),
      query: later.run,
    });
    expect(opened?.history?.rows).toHaveLength(9);

    const finalGame = fixtureSql({ game: [gameRow({ status: 'Final', home_score: 110, away_score: 102 })] });
    expect(await loadResearchOverview({ gameId: '21681995', now: NOW, query: finalGame.run })).toBeNull();

    const unknown = fixtureSql({ game: [gameRow({ status: 'Delayed' })] });
    expect(await loadResearchOverview({ gameId: '21681995', now: NOW, query: unknown.run })).toBeNull();

    for (const sql of [missing, older, finalGame, unknown]) {
      expect(sql.calls.some((text) => text.includes('analytics.team_game_stats'))).toBe(false);
    }
    expect(later.calls.filter((text) => text.includes('analytics.team_game_stats'))).toHaveLength(1);
  });

  it('keeps a reliably classified in-progress game on labeled historical context', async () => {
    const sql = fixtureSql({
      game: [gameRow({ status: '2nd Qtr', home_score: 48, away_score: 50, start_time: '2026-10-20T23:00:00.000Z' })],
    });
    const overview = await loadResearchOverview({
      gameId: '21681995',
      now: new Date('2026-10-21T01:00:00.000Z'),
      query: sql.run,
    });
    expect(overview?.history?.label).toContain('2025–26 Regular Season');
    expect(overview?.history?.possessionNote).toContain('not official NBA pace');
  });

  it('fails closed on unknown, conflicting, or ambiguous team identity', async () => {
    const conflicting = fixtureSql({
      identity: [
        { team_id: '2', abbreviation: 'NYK', full_name: 'New York Knicks', conference: 'East' },
        { team_id: '9', abbreviation: 'DET', full_name: 'Detroit Pistons', conference: 'East' },
      ],
    });
    expect(await loadResearchOverview({ gameId: '21681995', now: NOW, query: conflicting.run })).toBeNull();

    const ambiguous = fixtureSql({
      identity: [
        ...identityRows(),
        { team_id: '2', abbreviation: 'BOS', full_name: 'Boston Celtics', conference: 'East' },
      ],
    });
    expect(await loadResearchOverview({ gameId: '21681995', now: NOW, query: ambiguous.run })).toBeNull();

    const sameTeam = fixtureSql({
      game: [gameRow({ home_team_id: '2', home_team_abbr: 'BOS', home_team_name: 'Boston Celtics' })],
    });
    expect(await loadResearchOverview({ gameId: '21681995', now: NOW, query: sameTeam.run })).toBeNull();

    const historicalFranchise = fixtureSql({
      game: [gameRow({ away_conference: null })],
    });
    expect(await loadResearchOverview({ gameId: '21681995', now: NOW, query: historicalFranchise.run })).toBeNull();
  });

  it('suppresses roster shares for missing, stale, incomplete, and after-tipoff observations', async () => {
    const missing = await loadResearchOverview({
      gameId: '21681995',
      now: NOW,
      query: fixtureSql({}).run,
    });
    expect(missing?.roster.status).toBe('hidden');
    expect(missing?.roster.teams).toBeNull();
    expect(missing?.history?.rows).toHaveLength(9);

    const stale = await loadResearchOverview({
      gameId: '21681995',
      now: NOW,
      query: fixtureSql({ stored: batch({ collected_at: '2026-09-01T15:00:00.000Z' }) }).run,
    });
    expect(stale?.roster.freshness).toBe('stale');
    expect(stale?.roster.teams).toBeNull();

    const incomplete = await loadResearchOverview({
      gameId: '21681995',
      now: NOW,
      query: fixtureSql({ latest: batch({ status: 'incomplete', gate_ok: false, collected_at: '2026-10-19T15:00:00.000Z' }) }).run,
    });
    expect(incomplete?.roster.freshness).toBe('incomplete');
    expect(incomplete?.roster.teams).toBeNull();

    const after = await loadResearchOverview({
      gameId: '21681995',
      now: NOW,
      query: fixtureSql({ latest: batch({ collected_at: '2026-10-21T01:00:00.000Z' }) }).run,
    });
    expect(after?.roster.status).toBe('hidden');
    expect(after?.roster.teams).toBeNull();
  });

  it('keeps same-team production as the continuity numerator when the provider team id differs', async () => {
    const sql = fixtureSql({
      stored: batch(),
      map: [
        { provider_team_id: '200', abbreviation: 'BOS', analytics_team_id: '2' },
        { provider_team_id: '900', abbreviation: 'DET', analytics_team_id: '9' },
      ],
      members: [
        { provider_player_id: '10', provider_team_id: '200', team_abbreviation: 'BOS', historical_player_id: '10', player_name: 'Jayson Tatum', player_rows: 1, has_prior_season_production: true },
        { provider_player_id: '20', provider_team_id: '900', team_abbreviation: 'DET', historical_player_id: '20', player_name: 'Cade Cunningham', player_rows: 1, has_prior_season_production: true },
      ],
      production: [
        { team_id: '2', player_id: '10', minutes: 100, fga: 40, fta: 10, usage_mass: 0, usage_possessions: 0 },
        { team_id: '2', player_id: '99', minutes: 100, fga: 20, fta: 4, usage_mass: 0, usage_possessions: 0 },
        { team_id: '9', player_id: '20', minutes: 80, fga: 30, fta: 8, usage_mass: 0, usage_possessions: 0 },
      ],
      other: [
        { team_id: '14', player_id: '10', minutes: 500, fga: 0, fta: 0, usage_mass: 0, usage_possessions: 0 },
      ],
    });
    const overview = await loadResearchOverview({ gameId: '21681995', now: NOW, query: sql.run });
    const boston = overview?.roster.teams?.find((team) => team.abbr === 'BOS');
    expect(boston?.minutesNumerator).toBe(100);
    expect(boston?.minutesDenominator).toBe(200);
    expect(boston?.minutesShare).toBe(0.5);
    expect(overview?.roster.status).toBe('shown');
  });

  it('omits the overview when history cannot be read, and keeps history when only the roster read fails', async () => {
    const down = fixtureSql({ game: 'throw' });
    expect(await loadResearchOverview({ gameId: '21681995', now: NOW, query: down.run })).toBeNull();

    const historyDown = fixtureSql({ game: 'throw-history' });
    expect(await loadResearchOverview({ gameId: '21681995', now: NOW, query: historyDown.run })).toBeNull();

    const rosterDown = fixtureSql({});
    const original = rosterDown.run;
    const run = async (text: string, params?: unknown[]) => {
      if (text.includes('roster_observation')) throw new Error('roster unavailable');
      return original(text, params);
    };
    const overview = await loadResearchOverview({ gameId: '21681995', now: NOW, query: run });
    expect(overview?.history?.rows).toHaveLength(9);
    expect(overview?.roster.teams).toBeNull();
    expect(overview?.roster.note).toMatch(/unavailable/i);
  });
});

describe('research overview presentation and boundaries', () => {
  it('renders the shared historical sections without a second market strip', async () => {
    const overview = await loadResearchOverview({
      gameId: '21681995',
      now: NOW,
      query: fixtureSql({
        players: [
          { team_id: '2', player_id: '10', full_name: 'Jayson Tatum', games: 70, minutes: 2400, points: 1900, fga: 1400, usage_mass: 0, usage_possessions: 0 },
        ],
      }).run,
    });
    expect(overview).not.toBeNull();
    const html = renderToStaticMarkup(createElement(ResearchMatchupOverview, { overview: overview! }));
    expect(html).toContain('Matchup Overview');
    expect(html).toContain('2025–26 Team Identity');
    expect(html).toContain('2025–26 Regular Season');
    expect(html).toContain('not official NBA pace');
    expect(html).toContain('Current rosters are not verified');
    expect(html).toContain('Jayson Tatum');
    expect(html).toContain('Ratings in the matchup section use that same 2025–26 research season.');
    expect(html).not.toContain('data-market-strip');
    expect(html).not.toContain('DraftKings');
    expect(html).toContain('data-matchup-story');
    expect(html).toContain('The clearest 2025–26 contrast is');
    expect(html).toContain('Key findings');
    expect(html).not.toContain('AI Matchup Summary');
    expect(html).toContain('grid-cols-1');
    expect(html).not.toContain('xl:grid-cols-[minmax(0,1.9fr)_minmax(16rem,1fr)]');
  });

  it('keeps the research route authenticated and the public route free of the research adapter', () => {
    const root = process.cwd();
    const page = readFileSync(join(root, 'app/betting/games/[gameId]/page.tsx'), 'utf8');
    const client = readFileSync(join(root, 'app/betting/games/[gameId]/GameDetailsPageClient.tsx'), 'utf8');
    const layout = readFileSync(join(root, 'components/betting/MatchupPageLayout.tsx'), 'utf8');
    const scoreboard = readFileSync(join(root, 'app/scoreboard/games/[gameId]/page.tsx'), 'utf8');
    const adapter = readFileSync(join(root, 'lib/pregame-matchup/from-analytics-game.ts'), 'utf8');
    const middleware = readFileSync(join(root, 'lib/supabase/middleware.ts'), 'utf8');

    expect(page).toContain('getUser');
    expect(page).toContain('loadResearchOverview');
    expect(page).not.toContain('loadPregameMatchup');
    expect(client).not.toContain('loadResearchOverview');
    expect(client).toContain('historicalOverview');
    expect(client).toContain('/api/betting/games/${gameId}/details');
    expect(layout).toContain('IntersectionObserver');
    expect(layout).toContain('scrollToSection');
    expect(layout).toContain('id="section-overview"');
    expect(layout).toContain('Teams & Players');
    expect(layout).toContain('Markets & Props');
    expect(layout).toContain('section-ai-projection');
    expect(layout).toContain('section-odds');
    expect(layout).toContain('LineMovementChart');
    expect(layout).toContain('section-injuries');
    expect(layout).toContain('playerProps');
    expect(layout).toContain('section-box');
    expect(layout.indexOf('id="section-box"')).toBeLessThan(layout.indexOf('<ResearchMatchupOverview'));
    expect(layout).toContain('!isFinalView && historicalOverview');
    expect(layout).toContain('betting-matchup-header');
    expect(layout).toContain('--matchup-scroll-offset');
    expect(layout).not.toContain('const stickyOffset = 160');
    expect(layout).toContain('isFinalView && hasStoredOdds');
    expect(layout).toContain('historicalFinalNavIds');
    expect(layout).not.toContain('loadPregameMatchup');
    expect(layout).not.toContain('data-market-strip');
    expect(scoreboard).toContain('loadPregameMatchup');
    expect(scoreboard).not.toContain('loadResearchOverview');
    expect(scoreboard).not.toContain('from-analytics-game');
    expect(adapter).toContain('buildPregameMatchup');
    expect(adapter).not.toContain('loadPregameMatchup');
    expect(adapter).not.toContain('scoreboard_games');
    expect(adapter).not.toMatch(/fetch\(/);
    expect(middleware).toContain("pathname.startsWith('/betting/')");
  });
});
