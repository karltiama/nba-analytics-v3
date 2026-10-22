import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GameCard } from '@/components/betting/GameCard';
import { PregameMatchupView } from '@/components/scoreboard/PregameMatchupView';
import { shouldShowLayoutHeader } from '@/components/betting/betting-shell-paths';
import type { PlayerSumRow, TeamSumRow } from '@/lib/pregame-matchup/aggregate';
import { historicalContributors, regularSeasonSample, teamProfile } from '@/lib/pregame-matchup/aggregate';
import { buildPregameMatchup, POSSESSION_NOTE, SAMPLE_LABEL } from '@/lib/pregame-matchup/compose';
import { dashboardReturnHref, isScoreboardGameId, parseSlateDate, scoreboardMatchupHref } from '@/lib/pregame-matchup/href';
import { loadPregameMatchup } from '@/lib/pregame-matchup/load';
import { historicalPlayerQuery, historicalTeamQuery } from '@/lib/pregame-matchup/queries';
import { resolveMatchupQuote } from '@/lib/pregame-matchup/quote';
import { presentRoster } from '@/lib/pregame-matchup/roster';
import { selectMatchupInsights } from '@/lib/pregame-matchup/signals';
import { historicalWindow } from '@/lib/pregame-matchup/window';
import type { StoredOddsQuote, StoredScoreboardGame } from '@/lib/scoreboard/contract';
import { scoreboardGame, scoreboardResponse } from '@/lib/scoreboard/fixtures';
import { createMemoryScoreboardStore } from '@/lib/scoreboard/store';
import { mergeTodaysGames } from '@/lib/scoreboard/slate-merge';

const ABSENT_ROSTER = presentRoster({ gameDate: '2026-10-11', day: null, teams: [] });
const NOW = new Date('2026-10-11T18:00:00.000Z');
const TIP = '2026-10-11T23:00:00.000Z';

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

function league(mutate?: (row: TeamSumRow, index: number) => TeamSumRow): TeamSumRow[] {
  return Array.from({ length: 30 }, (_, index) => {
    const varied = sum(String(index + 1), {
      fg3a: 82 * (30 + index * 0.2),
    });
    return mutate ? mutate(varied, index) : varied;
  });
}

function profile(teamId: string, over: Partial<TeamSumRow> = {}) {
  const built = teamProfile(sum(teamId, over));
  if (!built) throw new Error(`profile ${teamId}`);
  return built;
}

function game(over: Partial<StoredScoreboardGame> = {}): StoredScoreboardGame {
  return {
    gameId: '21826166',
    season: 2026,
    seasonType: 'preseason',
    seasonTypeSource: 'request_season_type',
    etDate: '2026-10-11',
    scheduledTip: TIP,
    homeTeamId: '6',
    homeAbbr: 'CLE',
    homeName: 'Cleveland Cavaliers',
    homeScore: null,
    visitorTeamId: '22',
    visitorAbbr: 'ORL',
    visitorName: 'Orlando Magic',
    visitorScore: null,
    providerStatus: null,
    providerStatusState: null,
    period: null,
    clock: null,
    overtimePeriods: 0,
    lifecycle: 'scheduled',
    gamesRequestId: 'req',
    firstObservedAt: '2026-10-11T17:00:00.000Z',
    lastObservedAt: '2026-10-11T17:59:00.000Z',
    lastChangedAt: '2026-10-11T17:00:00.000Z',
    terminalConfirmations: 0,
    finalObservedAt: null,
    pollingState: 'pending',
    boxCompleteness: 'none',
    boxRequestId: null,
    boxObservedAt: null,
    finalBoxAttempts: 0,
    ...over,
  };
}

function quote(over: Partial<StoredOddsQuote> = {}): StoredOddsQuote {
  const observed = '2026-10-11T17:58:00.000Z';
  return {
    gameId: '21826166',
    vendor: 'draftkings',
    quoteKind: 'current',
    moneylineHome: -198,
    moneylineAway: 164,
    spreadHome: -5.5,
    spreadHomeOdds: -110,
    spreadAway: 5.5,
    spreadAwayOdds: -110,
    total: 228.5,
    totalOverOdds: -110,
    totalUnderOdds: -110,
    providerUpdatedAt: observed,
    vendorSyncedAt: observed,
    openedAt: null,
    firstObservedAt: observed,
    observedAt: observed,
    requestId: 'odds',
    withdrawnAt: null,
    withdrawnRequestId: null,
    ...over,
  };
}

function player(over: Partial<PlayerSumRow> = {}): PlayerSumRow {
  return {
    teamId: '22',
    playerId: '101',
    name: 'Example Guard',
    games: 70,
    minutes: 70 * 32,
    points: 70 * 20,
    fga: 70 * 16,
    usageMass: 0.25 * 400,
    usagePossessions: 400,
    ...over,
  };
}

describe('pregame matchup history', () => {
  it('uses the canonical regular-season fence and not season averages', () => {
    const window = historicalWindow();
    expect(window).toEqual({
      season: '2025',
      startInclusive: '2025-10-21',
      endExclusive: '2026-04-14',
      excludeDate: '2025-12-16',
    });
    const team = historicalTeamQuery(window);
    const players = historicalPlayerQuery(window, ['22', '6']);
    expect(team.params).toEqual(['2025', '2025-10-21', '2026-04-14', '2025-12-16']);
    expect(team.text).toContain('analytics.team_game_stats');
    expect(team.text).not.toContain('team_season_averages');
    expect(team.text).not.toContain('offensive_rating');
    expect(players.text).toContain('minutes::numeric > 0');
    expect(players.text).toContain('usage_percentage * a.possessions');
    expect(players.params[1]).toEqual(['22', '6']);
  });

  it('weights ratings by estimated possessions and rejects a postseason-sized sample', () => {
    const weighted = teamProfile(
      sum('6', {
        points: 260,
        pointsAllowed: 200,
        possessions: 150,
      })
    );
    expect(weighted?.offensiveRating).toBeCloseTo((260 / 150) * 100, 6);
    expect(weighted?.defensiveRating).toBeCloseTo((200 / 150) * 100, 6);
    expect(weighted?.netRating).toBeCloseTo(weighted!.offensiveRating - weighted!.defensiveRating, 6);
    expect(teamProfile(sum('6', { games: 100, rows: 100 }))).toBeNull();
    expect(teamProfile(sum('6', { badPossessions: 1 }))).toBeNull();
    const rows = league();
    rows[5] = sum('6', { games: 100, rows: 100 });
    expect(regularSeasonSample(rows)).toBeNull();
    expect(regularSeasonSample(league())?.size).toBe(30);
  });

  it('drops did-not-play rows and possession-weights usage', () => {
    const list = historicalContributors(
      [
        player({ playerId: 'dnp', name: 'Sat Out', games: 0, minutes: 0, usageMass: 0, usagePossessions: 0 }),
        player({
          playerId: 'star',
          name: 'Star Wing',
          minutes: 2400,
          usageMass: 0.2 * 100 + 0.4 * 300,
          usagePossessions: 400,
        }),
        player({ playerId: 'nousg', name: 'No Usage', minutes: 1000, usageMass: 0, usagePossessions: 0 }),
      ],
      '22'
    );
    expect(list.map((item) => item.playerId)).toEqual(['star', 'nousg']);
    expect(list[0]?.usage).toBeCloseTo(0.35, 6);
    expect(list[1]?.usage).toBeNull();
    expect(list[0]?.minutesPerGame).toBeCloseTo(2400 / 70, 6);
  });
});

describe('pregame context signals', () => {
  it('suppresses a gap that is not distinguishable and emits evidence when it is', () => {
    const quietLeague = Array.from({ length: 30 }, (_, index) =>
      profile(String(index + 1), { fg3a: 82 * (30 + index * 0.4) })
    );
    const quiet = selectMatchupInsights({
      away: { abbr: 'ORL', profile: profile('22', { fg3a: 82 * 36 }) },
      home: { abbr: 'CLE', profile: profile('6', { fg3a: 82 * 36.2 }) },
      league: quietLeague,
    });
    expect(quiet).toEqual([]);

    const loudLeague = quietLeague.map((team, index) =>
      index === 0
        ? profile('22', { points: 82 * 125, fg3a: 82 * 48 })
        : index === 1
          ? profile('6', { pointsAllowed: 82 * 100, fg3a: 82 * 24 })
          : team
    );
    const loud = selectMatchupInsights({
      away: { abbr: 'ORL', profile: loudLeague[0]! },
      home: { abbr: 'CLE', profile: loudLeague[1]! },
      league: loudLeague,
    });
    expect(loud.length).toBeGreaterThan(0);
    expect(loud.length).toBeLessThanOrEqual(3);
    expect(loud[0]?.evidence).toMatch(/\d/);
    expect(loud.map((item) => item.headline).join(' ')).not.toMatch(/will win|predicted|expected value/i);
    expect(loud.every((item) => item.limitation.includes('not verified'))).toBe(true);
    const again = selectMatchupInsights({
      away: { abbr: 'ORL', profile: loudLeague[0]! },
      home: { abbr: 'CLE', profile: loudLeague[1]! },
      league: loudLeague,
    });
    expect(again.map((item) => item.id)).toEqual(loud.map((item) => item.id));
  });
});

describe('pregame quote matches GameCard selection', () => {
  const env = { SCOREBOARD_MARKETS_SERVING_ENABLED: '1' };

  it('shows the single current book and hides a stale, withdrawn, or post-tip price', () => {
    const fresh = resolveMatchupQuote({
      game: game(),
      quotes: [quote(), quote({ vendor: 'fanduel', spreadHome: -4 })],
      now: NOW,
      env,
      awayAbbr: 'ORL',
      homeAbbr: 'CLE',
    });
    expect(fresh.quote?.vendorLabel).toBe('DraftKings');
    expect(fresh.quote?.spreadHome).toContain('CLE -5.5');
    expect(fresh.quote?.implied).toMatch(/No-vig implied probability/);
    expect(fresh.quote?.caption).toMatch(/DraftKings/);

    const stale = resolveMatchupQuote({
      game: game(),
      quotes: [
        quote({
          observedAt: '2026-10-11T16:00:00.000Z',
          providerUpdatedAt: '2026-10-11T16:00:00.000Z',
          vendorSyncedAt: '2026-10-11T16:00:00.000Z',
        }),
      ],
      now: NOW,
      env,
      awayAbbr: 'ORL',
      homeAbbr: 'CLE',
    });
    expect(stale.quote).toBeNull();
    expect(stale.note).toMatch(/too old/);

    const tipped = resolveMatchupQuote({
      game: game({ scheduledTip: '2026-10-11T17:00:00.000Z' }),
      quotes: [quote()],
      now: NOW,
      env,
      awayAbbr: 'ORL',
      homeAbbr: 'CLE',
    });
    expect(tipped.quote).toBeNull();
    expect(tipped.note).toMatch(/tipped/);

    const finalGame = resolveMatchupQuote({
      game: game({ lifecycle: 'final', pollingState: 'complete' }),
      quotes: [quote()],
      now: NOW,
      env,
      awayAbbr: 'ORL',
      homeAbbr: 'CLE',
    });
    expect(finalGame.quote).toBeNull();

    const withdrawn = resolveMatchupQuote({
      game: game(),
      quotes: [quote({ withdrawnAt: NOW.toISOString() })],
      now: NOW,
      env,
      awayAbbr: 'ORL',
      homeAbbr: 'CLE',
    });
    expect(withdrawn.quote).toBeNull();
  });

  it('does not show prices when market serving is off', () => {
    const hidden = resolveMatchupQuote({
      game: game(),
      quotes: [quote()],
      now: NOW,
      env: {},
      awayAbbr: 'ORL',
      homeAbbr: 'CLE',
    });
    expect(hidden.quote).toBeNull();
    expect(hidden.note).toMatch(/not being shown/);
  });
});

describe('pregame page model', () => {
  it('builds historical context for a scoreboard game without an analytics game row', async () => {
    const store = createMemoryScoreboardStore();
    store.games.set('21826166', game());
    let oddsReads = 0;
    const guarded = {
      ...store,
      loadCurrentOdds: async (ids: string[]) => {
        oddsReads += 1;
        return store.loadCurrentOdds(ids);
      },
    };
    const calls: string[] = [];
    const rows = league((row, index) => (index === 21 ? sum('22') : index === 5 ? sum('6') : row));
    const model = await loadPregameMatchup({
      gameId: '21826166',
      slateDate: '2026-10-11',
      now: NOW,
      env: {},
      store: guarded,
      query: async (text, params) => {
        calls.push(text);
        expect(text).not.toMatch(/analytics\.games/);
        if (text.includes('team_game_stats')) {
          expect(params).toEqual(['2025', '2025-10-21', '2026-04-14', '2025-12-16']);
          return rows.map((row) => ({
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
          }));
        }
        if (text.includes('player_game_logs')) {
          expect(params?.[1]).toEqual(['22', '6']);
          return [
            {
              team_id: '22',
              player_id: '101',
              full_name: 'Example Guard',
              games: 70,
              minutes: 2240,
              points: 1400,
              fga: 1120,
              usage_mass: 100,
              usage_possessions: 400,
            },
          ];
        }
        if (text.includes('roster_observation')) return [];
        if (text.includes('analytics.teams')) {
          return [
            { team_id: '22', abbreviation: 'ORL', full_name: 'Orlando Magic' },
            { team_id: '6', abbreviation: 'CLE', full_name: 'Cleveland Cavaliers' },
          ];
        }
        throw new Error(text);
      },
    });
    expect(oddsReads).toBe(0);
    expect(model?.gameId).toBe('21826166');
    expect(model?.awayAbbr).toBe('ORL');
    expect(model?.homeAbbr).toBe('CLE');
    expect(model?.history?.label).toBe(SAMPLE_LABEL);
    expect(model?.history?.possessionNote).toBe(POSSESSION_NOTE);
    expect(model?.history?.rows.find((row) => row.label === 'Estimated possessions / game')?.away).toBe('100.0');
    expect(model?.contributors?.historicalLabel).toBe('2025–26 historical production — not a confirmed current roster');
    expect(model?.contributors?.membership).toBe('unavailable');
    expect(model?.contributors?.awayCurrent).toEqual([]);
    expect(model?.contributors?.awayHistorical[0]?.name).toBe('Example Guard');
    expect(model?.contributors?.historicalLabel).not.toMatch(/starter|current roster confirmed|departure/i);
    expect(model?.returnHref).toBe('/dashboard?date=2026-10-11');
    expect(model?.quote).toBeNull();
    expect(model?.roster.status).toBe('hidden');
    expect(model?.roster.note).toMatch(/No eligible BallDontLie/);
    expect(calls.some((text) => text.includes('nba_roster_snapshots'))).toBe(false);
  });

  it('hides history when the sample is contaminated or the team abbreviation does not match', () => {
    const base = {
      gameId: '21826166',
      awayTeamId: '22',
      homeTeamId: '6',
      awayAbbr: 'ORL',
      awayName: 'Orlando Magic',
      homeAbbr: 'CLE',
      homeName: 'Cleveland Cavaliers',
      tipLabel: '7:00 PM EDT',
      seasonLabel: 'Preseason',
      statusLabel: 'Scheduled',
      updatedLabel: 'Scoreboard Updated 1:59 PM EDT',
      returnHref: '/dashboard?date=2026-10-11',
      playerRows: [],
      roster: ABSENT_ROSTER,
      quote: { quote: null, note: 'No verified pregame price is available.' },
    };
    const dirty = buildPregameMatchup({
      ...base,
      identityConfirmed: true,
      teamRows: league((row, index) => (index === 5 ? sum('6', { games: 100, rows: 100 }) : row)),
    });
    expect(dirty.history).toBeNull();
    expect(dirty.insights).toEqual([]);
    expect(dirty.historyNote).toMatch(/incomplete/);

    const mismatch = buildPregameMatchup({
      ...base,
      identityConfirmed: false,
      teamRows: league(),
    });
    expect(mismatch.history).toBeNull();
    expect(mismatch.contributors).toBeNull();
    expect(mismatch.historyNote).toMatch(/identity/);
  });
});

describe('pregame navigation', () => {
  it('enables View Matchup and View Props for a scoreboard pregame card', () => {
    const slate = mergeTodaysGames(scoreboardResponse([scoreboardGame({ game_id: '21826166', lifecycle: 'scheduled' })]))[0]!;
    const html = renderToStaticMarkup(
      createElement(GameCard, { game: slate, presentation: 'scoreboard', researchDate: '2026-10-11' })
    );
    expect(html).toContain('href="/scoreboard/games/21826166?date=2026-10-11"');
    expect(html).toContain('data-scoreboard-matchup');
    expect(html).not.toContain('aria-disabled');
    expect(html).toContain('data-view-props');
    expect(html).toContain('href="/betting/props-explorer?date=2026-10-09&amp;game_id=21826166"');
    expect(html).toContain('>View props</span>');
    expect(html).not.toContain('/betting/games/');
  });

  it('keeps live, final, and research matchup links on their existing paths', () => {
    const live = mergeTodaysGames(
      scoreboardResponse([scoreboardGame({ game_id: '9001', lifecycle: 'live', period: 1, clock: '4:00', home: { score: 10 }, visitor: { score: 8 } })])
    )[0]!;
    const liveHtml = renderToStaticMarkup(createElement(GameCard, { game: live, presentation: 'scoreboard' }));
    expect(liveHtml.match(/aria-disabled="true"/g)).toHaveLength(1);
    expect(liveHtml).toContain('>Follow live</span>');
    expect(liveHtml).toContain('href="/betting/props-explorer?date=2026-10-09&amp;game_id=9001"');
    expect(liveHtml).not.toContain('/scoreboard/games/');
    expect(liveHtml).not.toContain('/betting/games/');

    const finalGame = mergeTodaysGames(
      scoreboardResponse([
        scoreboardGame({
          game_id: '9002',
          lifecycle: 'final',
          polling_state: 'complete',
          home: { score: 100 },
          visitor: { score: 90 },
        }),
      ])
    )[0]!;
    const finalHtml = renderToStaticMarkup(createElement(GameCard, { game: finalGame, presentation: 'scoreboard' }));
    expect(finalHtml.match(/aria-disabled="true"/g)).toHaveLength(1);
    expect(finalHtml).toContain('>Game recap</span>');
    expect(finalHtml).toContain('href="/betting/props-explorer?date=2026-10-09&amp;game_id=9002"');
    expect(finalHtml).not.toContain('/scoreboard/games/');
    expect(finalHtml).not.toContain('/betting/games/');

    const researchHtml = renderToStaticMarkup(
      createElement(GameCard, {
        game: {
          ...mergeTodaysGames(scoreboardResponse([scoreboardGame({ game_id: '21681995', lifecycle: 'scheduled' })]))[0]!,
          researchAvailable: true,
        },
        presentation: 'scoreboard',
      })
    );
    expect(researchHtml).toContain('href="/betting/games/21681995"');
    expect(researchHtml).toContain('props-explorer');
  });

  it('rejects a bad return date and keeps the research redirect', () => {
    expect(parseSlateDate('2026-13-40')).toBeNull();
    expect(parseSlateDate('yesterday')).toBeNull();
    expect(dashboardReturnHref('yesterday')).toBe('/dashboard');
    expect(scoreboardMatchupHref('21826166', '2026-10-11')).toBe('/scoreboard/games/21826166?date=2026-10-11');
    expect(isScoreboardGameId('21826166')).toBe(true);
    expect(isScoreboardGameId('not-a-game')).toBe(false);
    const legacy = readFileSync(join(process.cwd(), 'app/games/[gameId]/page.tsx'), 'utf8');
    const researchPage = readFileSync(join(process.cwd(), 'app/betting/games/[gameId]/page.tsx'), 'utf8');
    expect(legacy).toContain('gameDetailHref');
    expect(researchPage).not.toContain('/scoreboard/games/');
    expect(shouldShowLayoutHeader('/scoreboard/games/21826166')).toBe(true);
  });
});

describe('pregame matchup layout', () => {
  it('renders the historical page without calling anyone a current player, on a narrow and wide grid', () => {
    const model = buildPregameMatchup({
      gameId: '21826166',
      awayTeamId: '22',
      homeTeamId: '6',
      awayAbbr: 'ORL',
      awayName: 'Orlando Magic',
      homeAbbr: 'CLE',
      homeName: 'Cleveland Cavaliers',
      tipLabel: '7:00 PM EDT',
      seasonLabel: 'Preseason',
      statusLabel: 'Scheduled',
      updatedLabel: 'Scoreboard Updated 1:59 PM EDT',
      returnHref: '/dashboard?date=2026-10-11',
      roster: ABSENT_ROSTER,
      identityConfirmed: true,
      teamRows: league((row, index) => (index === 21 ? sum('22') : index === 5 ? sum('6') : row)),
      playerRows: [player()],
      quote: {
        quote: {
          vendorLabel: 'DraftKings',
          caption: 'DraftKings · BDL synced 2m ago',
          awayAbbr: 'ORL',
          homeAbbr: 'CLE',
          spreadAway: 'ORL +5.5',
          spreadHome: 'CLE -5.5',
          total: 'O/U 228.5',
          totalPrices: 'O -110 / U -110',
          moneylineAway: 'ORL +164',
          moneylineHome: 'CLE -198',
          implied: 'No-vig implied probability: ORL 38%, CLE 62%',
        },
        note: null,
      },
    });
    const html = renderToStaticMarkup(createElement(PregameMatchupView, { model }));
    expect(html).toContain('2025–26 Team Identity');
    expect(html).toContain('2025–26 Regular Season · 82 games');
    expect(html).toContain('not official NBA pace');
    expect(html).toContain('2025–26 historical production — not a confirmed current roster');
    expect(html).not.toMatch(/tonight's starters|confirmed departure|vacated/i);
    expect(html).toContain('DraftKings · BDL synced 2m ago · Scoreboard Updated 1:59 PM EDT');
    expect(html.match(/Scoreboard Updated 1:59 PM EDT/g)).toHaveLength(1);
    expect(html).toContain('CLE -5.5');
    expect(html).toContain('No-vig implied probability');
    expect(html).toContain('href="/dashboard?date=2026-10-11"');
    expect(html).toContain('grid-cols-1');
    expect(html).toContain('sm:grid-cols-2');
    expect(html).toContain('sm:grid-cols-3');
    expect(html).toContain('max-w-[1800px]');
    expect(html).toContain('max-w-3xl');
    expect(html.match(/CLE -5\.5/g)).toHaveLength(1);
    expect(html).toContain('Example Guard');
  });
});
