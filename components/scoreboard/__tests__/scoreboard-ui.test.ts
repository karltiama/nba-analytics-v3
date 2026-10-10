import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GameCard, type Game } from '@/components/betting/GameCard';
import { interpretScoreboardPayload, SCOREBOARD_CLIENT_REFRESH_MS, SCOREBOARD_REFRESH_LEAD_MS, scoreboardPollDelayMs } from '@/lib/scoreboard/client';
import { scoreboardGame, scoreboardPreviewResponse, scoreboardResponse } from '@/lib/scoreboard/fixtures';
import { SCOREBOARD_POLICY } from '@/lib/scoreboard/planner';
import { mergeTodaysGames, scoreboardToSlateGame, todaysGamesUnavailableCopy } from '@/lib/scoreboard/slate-merge';
import { SCOREBOARD_CACHE_CONTROL } from '@/lib/scoreboard/serve';

function bettingGame(over: Partial<Game> = {}): Game {
  return {
    id: 'reg-1',
    gameDate: '2026-10-22',
    homeTeam: { id: '2', name: 'Boston Celtics', abbreviation: 'BOS', record: '0-0' },
    awayTeam: { id: '20', name: 'New York Knicks', abbreviation: 'NYK', record: '0-0' },
    startTime: '7:30 PM EDT',
    homeOdds: { moneyline: -150, spread: -3.5, spreadOdds: -110 },
    awayOdds: { moneyline: 130, spread: 3.5, spreadOdds: -110 },
    overUnder: 220.5,
    overOdds: -110,
    underOdds: -110,
    homeImpliedProb: 60,
    awayImpliedProb: 40,
    isFavorite: 'home',
    isClose: false,
    hasOdds: true,
    status: 'Scheduled',
    ...over,
  };
}

function cardHtml(game: Game, presentation: 'market' | 'scoreboard' = 'market') {
  return renderToStaticMarkup(createElement(GameCard, { game, presentation }));
}

describe('Today\'s Games scoreboard merge', () => {
  it('does not invent a slate from betting games when the scoreboard payload is missing', () => {
    const slate = [bettingGame()];
    expect(mergeTodaysGames(null)).toEqual([]);
    expect(mergeTodaysGames(undefined)).toEqual([]);
    expect(mergeTodaysGames(scoreboardResponse([]))).toEqual([]);
    expect(mergeTodaysGames({ date: '2026-10-10' } as never)).toEqual([]);
    expect(slate[0]?.hasOdds).toBe(true);
  });

  it('shows a preseason game and a regular-season game that have no odds', () => {
    const preseason = scoreboardGame({ game_id: 'pre-no-odds', lifecycle: 'scheduled' });
    const regular = scoreboardGame({
      game_id: 'reg-no-odds',
      lifecycle: 'scheduled',
      season_type: 'regular',
      home: { abbreviation: 'BOS', name: 'Boston Celtics' },
      visitor: { abbreviation: 'NYK', name: 'New York Knicks' },
    });
    const merged = mergeTodaysGames(scoreboardResponse([preseason, regular]));
    expect(merged.map((game) => game.id)).toEqual(['pre-no-odds', 'reg-no-odds']);
    expect(merged.every((game) => game.hasOdds === false)).toBe(true);
    const html = merged.map((game) => cardHtml(game, 'scoreboard')).join('\n');
    expect(html).not.toContain('Market spread');
    expect(html).not.toContain('View matchup');
    expect(html).not.toContain('View props');
    expect(html).not.toContain('No odds yet');
    expect(html).not.toContain('Projections and expected value');
    expect(html).toContain('Preseason');
    expect(html).toContain('Regular season');
  });

  it('keeps one card when the same provider id appears twice and ignores a different date', () => {
    const early = scoreboardGame({
      game_id: '5001',
      lifecycle: 'live',
      season_type: 'regular',
      period: 3,
      clock: '4:12',
      home: { abbreviation: 'BOS', name: 'Boston Celtics', score: 91 },
      visitor: { abbreviation: 'NYK', name: 'New York Knicks', score: 88 },
    });
    const later = scoreboardGame({
      game_id: '5001',
      lifecycle: 'live',
      season_type: 'regular',
      period: 3,
      clock: '3:40',
      home: { abbreviation: 'BOS', name: 'Boston Celtics', score: 94 },
      visitor: { abbreviation: 'NYK', name: 'New York Knicks', score: 90 },
    });
    const tomorrow = scoreboardGame({
      game_id: 'tomorrow',
      et_date: '2026-10-10',
      lifecycle: 'scheduled',
    });
    const merged = mergeTodaysGames(scoreboardResponse([early, later, tomorrow]));
    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe('5001');
    expect(merged[0]?.homeScore).toBe(94);
    expect(merged[0]?.awayScore).toBe(90);
    expect(merged[0]?.scoreboard?.periodClock).toContain('3:40');
    expect(merged[0]?.scoreboard?.isFinal).toBe(false);
    expect(merged[0]?.hasOdds).toBe(false);
  });

  it('does not treat live scores as Final', () => {
    const live = scoreboardToSlateGame(
      scoreboardGame({
        game_id: 'live-scores',
        lifecycle: 'live',
        period: 4,
        clock: '0:01',
        home: { abbreviation: 'NYK', name: 'New York Knicks', score: 118 },
        visitor: { abbreviation: 'BOS', name: 'Boston Celtics', score: 120 },
      })
    );
    expect(live?.scoreboard?.isFinal).toBe(false);
    expect(live?.status).toBe('Live');
    const html = cardHtml(live!, 'scoreboard');
    expect(html).toContain('data-final="false"');
    expect(html).toContain('>Live<');
    expect(html).toContain('120');
    expect(html).toContain('118');
    expect(html).not.toContain('>FINAL<');

    const scheduled = scoreboardToSlateGame(
      scoreboardGame({
        game_id: 'sched-scores',
        lifecycle: 'scheduled',
        home: { score: 102 },
        visitor: { score: 99 },
      })
    );
    expect(scheduled?.scoreboard?.isFinal).toBe(false);
    expect(scheduled?.homeScore).toBeUndefined();
    expect(cardHtml(scheduled!, 'scoreboard')).not.toContain('>102<');
    expect(cardHtml(scheduled!, 'scoreboard')).not.toContain('0 – 0');
  });

  it('renders lifecycle, season labels, freshness, and stale copy on the existing card', () => {
    const slate = mergeTodaysGames(scoreboardPreviewResponse());
    const html = slate.map((game) => cardHtml(game, 'scoreboard')).join('\n');
    for (const label of ['Preseason', 'Regular season', 'Play-in', 'Playoffs', 'Halftime', 'Overtime', 'FINAL', 'Postponed', 'Canceled']) {
      expect(html).toContain(`>${label}<`);
    }
    expect(html).toContain('Score may be out of date');
    expect(html).toContain('Updates paused');
    expect(html).toContain('Updated 7:41 PM EDT');
    expect(html).toContain('Q3 4:12');
    expect(html).toContain('OT 1:48');
  });

  it('shows a partial box score inside the card', () => {
    const game = scoreboardToSlateGame(
      scoreboardGame({
        game_id: 'partial',
        lifecycle: 'live',
        period: 3,
        clock: '4:12',
        home: { provider_team_id: '20', abbreviation: 'NYK', score: 91 },
        visitor: { provider_team_id: '2', abbreviation: 'BOS', score: 88 },
        box_score: {
          completeness: 'live_partial',
          acquired_at: '2026-10-09T23:41:00.000Z',
          players: [
            {
              playerId: '101',
              teamId: '2',
              name: 'Jayson Tatum',
              min: '24',
              pts: 22,
              reb: 6,
              ast: 4,
              fgm: 8,
              fga: 15,
              fg3m: 3,
              fg3a: 7,
              ftm: 3,
              fta: 4,
              oreb: 1,
              dreb: 5,
            },
          ],
        },
      })
    );
    const html = cardHtml(game!, 'scoreboard');
    expect(html).toContain('data-box-completeness="live_partial"');
    expect(html).toContain('Partial box score');
    expect(html).toContain('Jayson Tatum');
    expect(html).toContain('>22<');
  });

  it('hides betting actions on Today\'s Games and keeps them on a market card', () => {
    const preseason = scoreboardToSlateGame(scoreboardGame({ game_id: 'pre', lifecycle: 'scheduled' }));
    const regularBoard = scoreboardToSlateGame(
      scoreboardGame({ game_id: 'reg', lifecycle: 'scheduled', season_type: 'regular' })
    );
    const preHtml = cardHtml(preseason!, 'scoreboard');
    const regularHtml = cardHtml(regularBoard!, 'scoreboard');
    for (const html of [preHtml, regularHtml]) {
      expect(html).toContain('data-betting="hidden"');
      expect(html).not.toContain('/betting/games/');
      expect(html).not.toContain('View matchup');
      expect(html).not.toContain('View props');
      expect(html).not.toContain('Market spread');
      expect(html).not.toContain('No odds yet');
      expect(html).not.toContain('data-preseason-betting');
    }
    const scheduled = scoreboardToSlateGame(
      scoreboardGame({ game_id: 'sched-scores', lifecycle: 'scheduled', home: { score: 0 }, visitor: { score: 0 } })
    );
    const scheduledHtml = cardHtml(scheduled!, 'scoreboard');
    expect(scheduledHtml).toContain('>Scheduled<');
    expect(scheduledHtml).not.toContain('0 – 0');

    const market = cardHtml(bettingGame(), 'market');
    expect(market).toContain('data-betting="visible"');
    expect(market).toContain('View matchup');
    expect(market).toContain('/betting/games/reg-1');
    expect(market).toContain('View props');
    expect(market).toContain('Market spread');
    expect(readFileSync(path.join(process.cwd(), 'components/landing/FeaturedGames.tsx'), 'utf8')).not.toContain('presentation="scoreboard"');
  });

  it('refreshes through tip, live play, and an unconfirmed delay, then stops when every game is terminal', () => {
    expect(SCOREBOARD_CLIENT_REFRESH_MS).toBe(SCOREBOARD_POLICY.LIVE_INTERVAL_MS);
    expect(SCOREBOARD_CLIENT_REFRESH_MS).toBe(60_000);
    expect(SCOREBOARD_REFRESH_LEAD_MS).toBe(SCOREBOARD_POLICY.PRE_TIP_WINDOW_MS);
    const tip = '2026-10-10T22:30:00.000Z';
    const hoursBefore = new Date('2026-10-10T16:30:00.000Z');
    const soon = new Date('2026-10-10T22:20:00.000Z');
    const scheduled = { lifecycle: 'scheduled', polling_state: 'pending', scheduled_tip: tip };

    expect(scoreboardPollDelayMs([scheduled], hoursBefore)).toBe(Date.parse('2026-10-10T22:15:00.000Z') - hoursBefore.getTime());
    expect(scoreboardPollDelayMs([scheduled], soon)).toBe(60_000);
    expect(scoreboardPollDelayMs([{ ...scheduled, lifecycle: 'live', polling_state: 'active' }], soon)).toBe(60_000);
    expect(scoreboardPollDelayMs([{ lifecycle: 'halftime', polling_state: 'active' }], soon)).toBe(60_000);
    expect(scoreboardPollDelayMs([{ lifecycle: 'overtime', polling_state: 'active' }], soon)).toBe(60_000);
    expect(scoreboardPollDelayMs([{ lifecycle: 'scheduled', polling_state: 'active', scheduled_tip: tip, stale: true }], new Date('2026-10-10T22:40:00.000Z'))).toBe(60_000);
    expect(scoreboardPollDelayMs([{ lifecycle: 'postponed', polling_state: 'active', scheduled_tip: tip }], soon)).toBe(60_000);
    expect(scoreboardPollDelayMs([{ lifecycle: 'final', polling_state: 'active' }], soon)).toBe(60_000);
    expect(scoreboardPollDelayMs([{ lifecycle: 'final', polling_state: 'complete' }], soon)).toBeNull();
    expect(scoreboardPollDelayMs([{ lifecycle: 'postponed', polling_state: 'complete' }], soon)).toBeNull();
    expect(scoreboardPollDelayMs([], soon)).toBeNull();
    expect(scoreboardPollDelayMs(null, soon)).toBeNull();
    expect(SCOREBOARD_CACHE_CONTROL).toContain('s-maxage=15');
    expect(interpretScoreboardPayload(503, { error: 'scoreboard_unavailable' }).status).toBe('disabled');
  });

  it('uses one Today\'s Games section and does not write scoreboard rows into model tables', () => {
    const root = process.cwd();
    const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
    const dash = read('app/dashboard/page.tsx');
    const merge = read('lib/scoreboard/slate-merge.ts');
    expect(dash.match(/Today's Games/g)?.length).toBe(1);
    expect(dash).toContain('mergeTodaysGames');
    expect(dash).toContain('presentation="scoreboard"');
    expect(dash).toContain('todaysGamesUnavailableCopy');
    expect(dash).toContain('No games scheduled for today');
    expect(dash).not.toContain('/api/betting/games');
    expect(dash).not.toContain('LiveScoreboard');
    expect(dash).not.toContain('ScoreboardView');
    expect(dash).toContain('grid-cols-1 md:grid-cols-2 lg:grid-cols-3');
    expect(dash.match(/setInterval/g)).toBeNull();
    expect(dash.match(/setTimeout/g)).toHaveLength(3);
    expect(merge).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
    expect(read('lib/scoreboard/client.ts')).not.toMatch(/balldontlie\.io/);
    expect(read('app/dev/scoreboard/page.tsx')).toMatch(/NODE_ENV === 'production'/);
    expect(todaysGamesUnavailableCopy('disabled')).toBe('Scoreboard serving is turned off.');
    expect(todaysGamesUnavailableCopy('error')).toBe('The game schedule is temporarily unavailable.');
    expect(todaysGamesUnavailableCopy('error')).not.toContain('No games');
  });
});
