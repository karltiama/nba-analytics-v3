import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GameCard, type Game } from '@/components/betting/GameCard';
import { interpretScoreboardPayload, SCOREBOARD_CLIENT_REFRESH_MS, SCOREBOARD_REFRESH_LEAD_MS, scoreboardPollDelayMs } from '@/lib/scoreboard/client';
import type { ScoreboardGame } from '@/lib/scoreboard/contract';
import { auditLiveGame, scoreboardGame, scoreboardPreviewResponse, scoreboardResponse } from '@/lib/scoreboard/fixtures';
import { SCOREBOARD_POLICY } from '@/lib/scoreboard/planner';
import { mergeTodaysGames, scoreboardToSlateGame, todaysGamesUnavailableCopy } from '@/lib/scoreboard/slate-merge';
import { SCOREBOARD_CACHE_CONTROL } from '@/lib/scoreboard/serve';

type Line = ScoreboardGame['box_score']['players'][number];

function bettingGame(over: Partial<Game> = {}): Game {
  return {
    id: 'reg-1',
    gameDate: '2026-10-22',
    homeTeam: { id: '2', name: 'Boston Celtics', abbreviation: 'BOS', record: '64-18' },
    awayTeam: { id: '20', name: 'New York Knicks', abbreviation: 'NYK', record: '50-32' },
    startTime: '7:30 PM ET',
    homeOdds: { moneyline: -150, spread: -3.5, spreadOdds: -110 },
    awayOdds: { moneyline: 130, spread: 3.5, spreadOdds: -110 },
    overUnder: 224.5,
    overOdds: -110,
    underOdds: -110,
    homeImpliedProb: 60,
    awayImpliedProb: 40,
    isFavorite: 'home',
    isClose: false,
    hasOdds: true,
    status: 'Scheduled',
    matchupContext: 'Boston is rested; New York played last night.',
    ...over,
  };
}

function cardHtml(game: Game, presentation?: 'market' | 'scoreboard') {
  return renderToStaticMarkup(createElement(GameCard, { game, presentation }));
}

function boardHtml(raw: ScoreboardGame, generatedAt?: string) {
  return cardHtml(scoreboardToSlateGame(raw, generatedAt)!, 'scoreboard');
}

/** Visible text with tags collapsed to single spaces. */
function textOf(html: string) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
}

function line(over: Partial<Line> & Pick<Line, 'playerId' | 'teamId'>): Line {
  return { name: 'Player', min: '30', pts: null, reb: null, ast: null, fgm: null, fga: null, fg3m: null, fg3a: null, ftm: null, fta: null, oreb: null, dreb: null, ...over };
}

const MARKET_HEADINGS = ['Market spread', 'Market total', 'Market ML'];
const PRICE_COPY = ['Market spread', 'Market total', 'Market ML', 'Market implied probability', 'FAV', 'O/U', 'No odds yet', 'Projections and expected value'];

/** Pregame keeps the original market card: three market columns and the Matchup Context panel. */
function expectPregameShell(html: string) {
  expect(html).toContain('data-betting="visible"');
  for (const heading of MARKET_HEADINGS) expect(html).toContain(heading);
  expect(html).toContain('data-context-panel="pregame"');
  expect(textOf(html)).toContain('Matchup Context');
  expect(html).not.toContain('data-leaders-panel');
}

/** Live and final swap the market slots for basketball facts and never show prices. */
function expectInPlayShell(html: string) {
  expect(html).toContain('data-betting="hidden"');
  for (const copy of PRICE_COPY) expect(html).not.toContain(copy);
  expect(html).toContain('data-leaders-panel');
  expect(html).not.toContain('/betting/games/');
  expect(html).not.toContain('props-explorer');
}

/** Same footer row, but neither control links anywhere. */
function expectUnavailableFooter(html: string, labels: [string, string]) {
  expect(html.match(/aria-disabled="true"/g)).toHaveLength(2);
  for (const label of labels) expect(html).toContain(`>${label}</span>`);
  expect(html).toContain('title="Not available for this game yet"');
  expect(html).not.toMatch(/<a [^>]*href=/);
}

/** Inner market grid, from its container to the end of the Market ML column. */
function marketGrid(html: string) {
  const start = html.indexOf('<div class="mx-5 sm:mx-6 mb-5 grid grid-cols-3');
  const ml = html.indexOf('Market ML', start);
  return html.slice(start, html.indexOf('</div></div></div>', ml) + '</div></div></div>'.length);
}

function teamRow(html: string) {
  const start = html.indexOf('<div class="px-5 sm:px-6 pt-3 pb-2">');
  return html.slice(start, html.indexOf('<div class="mx-5 sm:mx-6 mb-5 grid', start));
}

describe('Today\'s Games scoreboard merge', () => {
  it('does not invent a slate from betting games when the scoreboard payload is missing', () => {
    expect(mergeTodaysGames(null)).toEqual([]);
    expect(mergeTodaysGames(undefined)).toEqual([]);
    expect(mergeTodaysGames(scoreboardResponse([]))).toEqual([]);
    expect(mergeTodaysGames({ date: '2026-10-10' } as never)).toEqual([]);
  });

  it('keeps one card when the same provider id appears twice and ignores a different date', () => {
    const early = scoreboardGame({ game_id: '5001', lifecycle: 'live', season_type: 'regular', period: 3, clock: '4:12', home: { abbreviation: 'BOS', name: 'Boston Celtics', score: 91 }, visitor: { abbreviation: 'NYK', name: 'New York Knicks', score: 88 } });
    const later = scoreboardGame({ game_id: '5001', lifecycle: 'live', season_type: 'regular', period: 3, clock: '3:40', home: { abbreviation: 'BOS', name: 'Boston Celtics', score: 94 }, visitor: { abbreviation: 'NYK', name: 'New York Knicks', score: 90 } });
    const tomorrow = scoreboardGame({ game_id: 'tomorrow', et_date: '2026-10-10', lifecycle: 'scheduled' });
    const merged = mergeTodaysGames(scoreboardResponse([early, later, tomorrow]));
    expect(merged).toHaveLength(1);
    expect(merged[0]?.homeScore).toBe(94);
    expect(merged[0]?.awayScore).toBe(90);
    expect(merged[0]?.scoreboard?.periodClock).toBe('Q3 3:40');
    expect(merged[0]?.scoreboard?.isFinal).toBe(false);
    expect(merged[0]?.hasOdds).toBe(false);
    expect(merged[0]?.researchAvailable).toBe(false);
  });

  it('filters by the Eastern Time date, including a late tip that is already the next day in UTC', () => {
    const lateWest = scoreboardGame({ game_id: 'late', lifecycle: 'scheduled', et_date: '2026-10-09', scheduled_tip: '2026-10-10T02:00:00.000Z' });
    const nextDay = scoreboardGame({ game_id: 'next', lifecycle: 'scheduled', et_date: '2026-10-10', scheduled_tip: '2026-10-10T16:00:00.000Z' });
    const merged = mergeTodaysGames(scoreboardResponse([lateWest, nextDay], { date: '2026-10-09' }));
    expect(merged.map((game) => game.id)).toEqual(['late']);
    expect(cardHtml(merged[0]!, 'scoreboard')).toContain('10:00 PM EDT · Scheduled');
  });
});

describe('Pre-game card keeps the original market layout', () => {
  it('shows a preseason and a regular-season game without markets in the same original shell', () => {
    const preseason = scoreboardGame({ game_id: 'pre-no-odds', lifecycle: 'scheduled' });
    const regular = scoreboardGame({ game_id: 'reg-no-odds', lifecycle: 'scheduled', season_type: 'regular' });
    const merged = mergeTodaysGames(scoreboardResponse([preseason, regular]));
    expect(merged.map((game) => game.id)).toEqual(['pre-no-odds', 'reg-no-odds']);
    for (const game of merged) {
      const html = cardHtml(game, 'scoreboard');
      expectPregameShell(html);
      expect(html).toContain('data-phase="pregame"');
      expect(html).toContain('7:00 PM EDT · Live score unavailable');
      expect(html).toContain('>VS<');
      expect(textOf(html)).toContain('MEM —');
      expect(textOf(html)).toContain('CHI —');
      expect(textOf(html)).toContain('O — / U —');
      expect(html).not.toContain('Market implied probability');
      expect(html).not.toContain('FAV');
      expect(html.match(/<span class="type-secondary">—<\/span>/g)).toHaveLength(2);
      expect(html).toContain('No verified matchup context for this game yet.');
      expect(html).toContain(`href="/scoreboard/games/${game.id}?date=2026-10-09"`);
      expect(html).toContain('data-scoreboard-matchup');
      expect(html).toContain('>View matchup</span>');
      expect(html.match(/aria-disabled="true"/g)).toHaveLength(1);
      expect(html).toContain('>View props</span>');
      expect(html).not.toContain('props-explorer');
      expect(html).not.toContain('/betting/games/');
    }
    expect(cardHtml(merged[0]!, 'scoreboard')).toContain('>NBA · Preseason<');
    expect(cardHtml(merged[1]!, 'scoreboard')).toContain('>NBA · Regular season<');
    const strip = (html: string) =>
      html
        .replace(/data-(game-id|season-type)="[^"]*"/g, '')
        .replace(/href="\/scoreboard\/games\/[^"]*"/g, 'href="/scoreboard/games/id"')
        .replace(/NBA · (Preseason|Regular season)/, '');
    expect(strip(cardHtml(merged[0]!, 'scoreboard'))).toBe(strip(cardHtml(merged[1]!, 'scoreboard')));
  });

  it('renders verified markets exactly like the original market card for either season type', () => {
    const market = cardHtml(bettingGame());
    for (const season_type of ['preseason', 'regular'] as const) {
      const base = scoreboardToSlateGame(
        scoreboardGame({
          game_id: 'reg-1',
          lifecycle: 'scheduled',
          season_type,
          home: { provider_team_id: '2', abbreviation: 'BOS', name: 'Boston Celtics' },
          visitor: { provider_team_id: '20', abbreviation: 'NYK', name: 'New York Knicks' },
        })
      )!;
      const enriched: Game = { ...bettingGame(), scoreboard: base.scoreboard, researchAvailable: true };
      const html = cardHtml(enriched, 'scoreboard');
      expectPregameShell(html);
      expect(marketGrid(html)).toBe(marketGrid(market));
      expect(teamRow(html)).toBe(teamRow(market));
      expect(textOf(html)).toContain('O/U 224.5');
      expect(textOf(html)).toContain('O -110 / U -110');
      expect(textOf(html)).toContain('50-32');
      expect(textOf(html)).toContain('64-18 FAV');
      expect(html).toContain('Market implied probability');
      expect(html).toMatch(/aria-label="Market implied probability: NYK \d+ percent, BOS \d+ percent"/);
      expect(html).toContain('Boston is rested; New York played last night.');
      expect(html).toContain('href="/betting/games/reg-1"');
      expect(html).toContain('props-explorer');
      expect(html).not.toContain('aria-disabled');
    }
  });

  it('draws the probability bar only from a real moneyline pair', () => {
    const base = scoreboardToSlateGame(scoreboardGame({ game_id: 'one-side', lifecycle: 'scheduled', season_type: 'regular' }))!;
    const oneSided: Game = {
      ...base,
      hasOdds: true,
      overUnder: 221.5,
      homeOdds: { moneyline: -140, spread: null, spreadOdds: null },
    };
    const html = cardHtml(oneSided, 'scoreboard');
    expectPregameShell(html);
    expect(textOf(html)).toContain('O/U 221.5');
    expect(textOf(html)).toContain('CHI -140');
    expect(html).not.toContain('Market implied probability');
    expect(html).not.toContain('%</div>');
  });

  it('keeps postponed, canceled, and delayed games in the pregame shell with their status and no score', () => {
    const teams = { home: { score: 40 }, visitor: { score: 38 } };
    for (const [lifecycle, provider_status, label] of [
      ['postponed', null, 'Postponed'],
      ['canceled', null, 'Canceled'],
      ['unknown', 'Delayed', 'Delayed'],
      ['unknown', null, 'Status unavailable'],
    ] as const) {
      const html = boardHtml(scoreboardGame({ game_id: `${lifecycle}-${label}`, lifecycle, provider_status, polling_state: 'complete', ...teams }));
      expectPregameShell(html);
      expect(html).toContain('data-phase="other"');
      expect(html).toContain(`>${label}</span>`);
      expect(html).not.toContain('data-scoreline');
      expect(html).not.toContain('LIVE');
      expect(html).not.toContain('wins by');
    }
  });
});

describe('Live card swaps market slots for live facts', () => {
  it('renders the audited live snapshot: one clock, score, PTS/REB/AST leaders, Game Pulse, freshness', () => {
    const html = boardHtml(auditLiveGame(), '2026-10-09T23:41:00.000Z');
    const text = textOf(html);
    expectInPlayShell(html);
    expect(html).toContain('data-phase="live"');
    expect(text).toContain('LIVE Q1 4:35');
    expect(html).not.toContain('Q1 Q1');
    expect(html).toMatch(/data-scoreline[^>]*aria-label="LAC 10, TOR 17"/);
    expect(text).toContain('Points RJ Barrett 9 PTS · TOR');
    expect(text).toContain('Rebounds Scottie Barnes 3 REB · TOR');
    expect(text).toContain('Assists James Harden 3 AST · LAC');
    expect(html).toContain('data-context-panel="live"');
    expect(text).toContain('Game Pulse');
    expect(html).toContain('data-game-pulse="developing"');
    expect(text).toContain('More game context will appear as stats develop.');
    expect(text).not.toMatch(/leads by|trails/);
    expect(html).toContain('data-freshness');
    expect(text).toContain('Updated 2m ago');
    expect(html).toContain('animate-pulse');
    expect(html).not.toContain('>VS<');
    expect(html).not.toContain('LAC – TOR');
    expect(teamRow(html)).toContain('data-scoreline');
    expect(textOf(teamRow(html))).toMatch(/Clippers — 10 – 17 Raptors —/);
    expectUnavailableFooter(html, ['Follow live', 'Box score']);
  });

  it('shows a status and empty tiles when the live box score is missing or covers one team', () => {
    const missing = boardHtml(scoreboardGame({ game_id: 'nobox', lifecycle: 'live', period: 2, clock: '6:00', home: { score: 40 }, visitor: { score: 36 } }));
    expectInPlayShell(missing);
    expect(missing).toContain('data-player-status');
    expect(missing).toContain('Player stats updating');
    expect(missing.match(/data-leader="none"/g)).toHaveLength(3);
    expect(textOf(missing)).toContain('More game context will appear as stats develop.');
    expect(textOf(missing)).not.toContain('leads by');

    const oneTeam = boardHtml(
      scoreboardGame({
        game_id: 'partial',
        lifecycle: 'live',
        period: 3,
        clock: '4:12',
        home: { provider_team_id: '20', abbreviation: 'NYK', name: 'New York Knicks', score: 91 },
        visitor: { provider_team_id: '2', abbreviation: 'BOS', name: 'Boston Celtics', score: 88 },
        box_score: { completeness: 'live_partial', acquired_at: null, players: [line({ playerId: '101', teamId: '2', name: 'Jayson Tatum', pts: 22, reb: 6, ast: 4 })] },
      })
    );
    expect(oneTeam).toContain('Player stats updating');
    expect(oneTeam).not.toContain('Jayson Tatum');
  });

  it('shows a tie count with every tied name in the tooltip', () => {
    const html = boardHtml(
      scoreboardGame({
        game_id: 'tied-leaders',
        lifecycle: 'live',
        period: 2,
        clock: '1:00',
        home: { score: 50 },
        visitor: { score: 48 },
        box_score: {
          completeness: 'live_partial',
          acquired_at: null,
          players: [
            line({ playerId: '1', teamId: '5', name: 'Zach LaVine', pts: 14, reb: 2, ast: 3 }),
            line({ playerId: '2', teamId: '15', name: 'Ja Morant', pts: 14, reb: 4, ast: 6 }),
          ],
        },
      })
    );
    const text = textOf(html);
    expect(text).toContain('Points 2 tied 14 PTS');
    expect(html).toContain('title="Ja Morant, Zach LaVine"');
    expect(text).toContain('Rebounds Ja Morant 4 REB · MEM');
  });

  it('keeps halftime and overtime on the live card with one clock label', () => {
    const teams = { home: { provider_team_id: '2', abbreviation: 'BOS', name: 'Boston Celtics', score: 60 }, visitor: { provider_team_id: '20', abbreviation: 'NYK', name: 'New York Knicks', score: 52 } };
    const half = boardHtml(scoreboardGame({ game_id: 'half', lifecycle: 'halftime', period: 2, clock: 'Q2 0:00', ...teams }));
    expectInPlayShell(half);
    expect(textOf(half)).toContain('LIVE Halftime');
    expect(half).not.toContain('0:00');
    expect(half).toContain('data-game-pulse="developing"');

    const ot = boardHtml(scoreboardGame({ game_id: 'ot', lifecycle: 'overtime', period: 6, clock: '2OT 0:48', overtime_periods: 2, ...teams }));
    expectInPlayShell(ot);
    expect(textOf(ot)).toContain('LIVE 2OT 0:48');
    expect(ot).not.toContain('2OT 2OT');
  });

  it('marks a stale live score as old and hides leaders and freshness', () => {
    const players = [line({ playerId: '1', teamId: '2', name: 'Jayson Tatum', pts: 31 }), line({ playerId: '2', teamId: '20', name: 'Jalen Brunson', pts: 27 })];
    const stale = boardHtml(
      scoreboardGame({
        game_id: 'stale',
        lifecycle: 'live',
        stale: true,
        stale_reason: 'no_recent_observation',
        period: 4,
        clock: '1:09',
        home: { provider_team_id: '2', abbreviation: 'BOS', name: 'Boston Celtics', score: 112 },
        visitor: { provider_team_id: '20', abbreviation: 'NYK', name: 'New York Knicks', score: 104 },
        box_score: { completeness: 'live_partial', acquired_at: null, players },
      }),
      '2026-10-10T01:10:00.000Z'
    );
    expectInPlayShell(stale);
    expect(stale).toContain('data-stale="true"');
    expect(stale).toContain('data-stale-warning');
    expect(stale).toContain('Score may be out of date');
    expect(stale).toContain('data-game-pulse="stale"');
    expect(stale).toContain('Game context resumes when fresh stats arrive.');
    expect(stale).not.toMatch(/led by|leads by/);
    expect(stale).not.toContain('Jayson Tatum');
    expect(stale).not.toContain('data-freshness');
    expect(stale).not.toContain('animate-pulse');
  });
});

describe('Final card', () => {
  const teams = {
    home: { provider_team_id: '2', abbreviation: 'BOS', name: 'Boston Celtics', score: 112 },
    visitor: { provider_team_id: '20', abbreviation: 'NYK', name: 'New York Knicks', score: 104 },
  };
  const players = [
    line({ playerId: '1', teamId: '2', name: 'Jayson Tatum', pts: 31, reb: 8, ast: 5 }),
    line({ playerId: '2', teamId: '20', name: 'Jalen Brunson', pts: 27, reb: 3, ast: 7 }),
  ];

  it('shows the winner and verified leaders without restating the score in the recap', () => {
    const html = boardHtml(scoreboardGame({ game_id: 'final', lifecycle: 'final', polling_state: 'complete', ...teams, box_score: { completeness: 'verified_final', acquired_at: null, players } }));
    const text = textOf(html);
    expectInPlayShell(html);
    expect(html).toContain('data-phase="final"');
    expect(html).toContain('>FINAL</span>');
    expect(html).toMatch(/<span class="text-cc-secondary">104<\/span>/);
    expect(html).toContain('<span>112</span>');
    expect(text).toContain('Points Jayson Tatum 31 PTS · BOS');
    expect(text).toContain('Rebounds Jayson Tatum 8 REB · BOS');
    expect(text).toContain('Assists Jalen Brunson 7 AST · NYK');
    expect(html).toContain('data-context-panel="final"');
    expect(text).toContain('Game Recap');
    expect(html).toContain('data-game-pulse="unavailable"');
    expect(text).toContain('Team stat recap is not available for this game.');
    expect(text).not.toContain('wins by');
    expect(html).not.toContain('data-freshness');
    expect(html).not.toContain('animate-pulse');
    expect(html).not.toContain('LIVE');
    expectUnavailableFooter(html, ['Game recap', 'Box score']);
  });

  it('shows a pending or verifying status instead of unverified leaders', () => {
    const noBox = boardHtml(scoreboardGame({ game_id: 'final-nobox', lifecycle: 'final', polling_state: 'complete', ...teams }));
    expect(noBox).toContain('Recap stats appear once the final box score is verified.');
    expect(noBox).toContain('Player stats pending');
    expect(noBox.match(/data-leader="none"/g)).toHaveLength(3);

    const unverified = boardHtml(scoreboardGame({ game_id: 'final-unv', lifecycle: 'final', polling_state: 'complete', ...teams, box_score: { completeness: 'final_unverified', acquired_at: null, players } }));
    expect(unverified).toContain('Box score being verified');
    expect(unverified).toContain('data-game-pulse="pending"');
    expect(unverified).not.toContain('Jayson Tatum');
  });

  it('marks overtime in the header only when the provider reports it', () => {
    const ot = boardHtml(scoreboardGame({ game_id: 'final-ot', lifecycle: 'final', polling_state: 'complete', period: 5, overtime_periods: 1, ...teams }));
    expect(textOf(ot)).toContain('FINAL OT');
    const twoOt = boardHtml(scoreboardGame({ game_id: 'final-2ot', lifecycle: 'final', polling_state: 'complete', period: 6, overtime_periods: 2, ...teams }));
    expect(textOf(twoOt)).toContain('FINAL 2OT');
    const reg = boardHtml(scoreboardGame({ game_id: 'final-reg', lifecycle: 'final', polling_state: 'complete', ...teams }));
    expect(textOf(reg)).not.toMatch(/FINAL \d?OT/);
  });

  it('does not fabricate a narrative when the final score is unusable', () => {
    const html = boardHtml(scoreboardGame({ game_id: 'final-bad', lifecycle: 'final', polling_state: 'complete', home: { score: null }, visitor: { score: 98 } }));
    expect(html).toContain('Recap stats appear once the final box score is verified.');
    expect(html).not.toMatch(/wins|leads|dominat|clutch|comeback|streak/i);
    expect(html).not.toContain('data-scoreline');
  });
});

describe('Lifecycle parity', () => {
  it('renders the preview slate with every lifecycle in the original shell', () => {
    const slate = mergeTodaysGames(scoreboardPreviewResponse());
    const cards = slate.map((game) => cardHtml(game, 'scoreboard'));
    const html = cards.join('\n');
    expect(html.match(/data-presentation="scoreboard"/g)?.length).toBe(slate.length);
    for (const card of cards) {
      if (card.includes('data-phase="live"') || card.includes('data-phase="final"')) expectInPlayShell(card);
      else expectPregameShell(card);
    }
    expect(html).toContain('Score may be out of date');
    expect(html).toContain('Updates paused');
    for (const clock of ['Q3 4:12', 'Q1 4:35', 'OT 1:48', 'Q4 2:05']) expect(html).toContain(clock);
    expect(html).not.toContain('Q1 Q1');
    expect(html).toContain('>Postponed</span>');
    expect(html).toContain('>Canceled</span>');
    expect(html).toContain('>Delayed</span>');
    expect(html).toContain('>Status unavailable</span>');
    expect(html).toContain('data-game-pulse="three_point_pct"');
    expect(html).toContain('Boston is shooting 48% from three (13/27), compared with 24% for Milwaukee (6/25).');
    expect(html).toContain('data-game-pulse="offensive_rebounds"');
    expect(html).toContain('New York has an 11–3 advantage in offensive rebounds.');
    expect(html).toContain('data-game-pulse="free_throw_attempts"');
    expect(html).toContain('Chicago attempted 28 free throws, compared with 15 for Memphis.');
    expect(html).toContain('More game context will appear as stats develop.');
    expect(html).not.toMatch(/leads by|led by|wins by|Game tied/);
    expect(textOf(html)).toContain('Points Victor Wembanyama 24 PTS · SAS');
    expect(textOf(html)).toContain('Assists Luka Doncic 9 AST · DAL');
    expect(html).toContain('Box score being verified');
    expect(html).toContain('Player stats pending');
    expect(html).toContain('Player stats updating');
    expect(html).not.toContain('<table');
  });

  it('uses the same structure for every season type in every lifecycle', () => {
    const shell = (html: string) =>
      html
        .replace(/data-game-id="[^"]*"/g, '')
        .replace(/data-season-type="[^"]*"/g, '')
        .replace(/href="[^"]*"/g, '')
        .replace(/>([^<]*)</g, '><');
    const label = (html: string) =>
      html
        .replace(/data-game-id="[^"]*"/g, '')
        .replace(/data-season-type="[^"]*"/g, '')
        .replace(/href="\/scoreboard\/games\/[^"]*"/g, 'href="/scoreboard/games/id"')
        .replace(/NBA · (Preseason|Regular season|Play-in|Playoffs)/g, '');
    const players = [
      line({ playerId: '1', teamId: '28', name: 'RJ Barrett', pts: 21, reb: 4, ast: 3 }),
      line({ playerId: '2', teamId: '13', name: 'James Harden', pts: 19, reb: 5, ast: 9 }),
    ];
    const teams = {
      home: { provider_team_id: '28', abbreviation: 'TOR', name: 'Toronto Raptors', score: 102 },
      visitor: { provider_team_id: '13', abbreviation: 'LAC', name: 'LA Clippers', score: 98 },
    };
    const cases: Array<Partial<ScoreboardGame> & { lifecycle: ScoreboardGame['lifecycle']; box_score?: Partial<ScoreboardGame['box_score']> }> = [
      { lifecycle: 'scheduled', home: { ...teams.home, score: 0 }, visitor: { ...teams.visitor, score: 0 } },
      { lifecycle: 'live', period: 2, clock: 'Q2 5:11', ...teams, box_score: { completeness: 'live_partial', acquired_at: null, players } },
      { lifecycle: 'halftime', period: 2, ...teams },
      { lifecycle: 'overtime', period: 5, overtime_periods: 1, clock: '1:48', ...teams },
      { lifecycle: 'final', polling_state: 'complete', ...teams, box_score: { completeness: 'verified_final', acquired_at: null, players } },
      { lifecycle: 'final', polling_state: 'complete', ...teams },
      { lifecycle: 'postponed' },
      { lifecycle: 'unknown', provider_status: 'Delayed' },
      { lifecycle: 'live', stale: true, stale_reason: 'no_recent_observation', period: 3, clock: '1:02', ...teams },
    ];
    for (const game of cases) {
      const rendered = (['preseason', 'regular', 'playin', 'playoffs'] as const).map((season_type) =>
        boardHtml(scoreboardGame({ ...game, game_id: `${season_type}-${game.lifecycle}`, season_type } as never), '2026-10-09T23:41:00.000Z')
      );
      const [pre, ...others] = rendered;
      for (const other of others) {
        expect(shell(other)).toBe(shell(pre!));
        expect(label(other)).toBe(label(pre!));
      }
    }
  });

  it('moves one card through scheduled, live, halftime, overtime, and final as payloads arrive', () => {
    const base = {
      game_id: '9001',
      season_type: 'regular' as const,
      scheduled_tip: '2026-10-09T23:00:00.000Z',
      home: { provider_team_id: '28', abbreviation: 'TOR', name: 'Toronto Raptors' },
      visitor: { provider_team_id: '13', abbreviation: 'LAC', name: 'LA Clippers' },
    };
    const steps: Array<{ raw: ScoreboardGame; phase: string; expects: string[]; poll: boolean }> = [
      { raw: scoreboardGame({ ...base, lifecycle: 'scheduled', polling_state: 'pending' }), phase: 'pregame', expects: ['7:00 PM EDT', '>VS<', 'Market spread', 'Matchup '], poll: true },
      { raw: scoreboardGame({ ...base, lifecycle: 'live', polling_state: 'active', period: 1, clock: 'Q1 4:35', home: { ...base.home, score: 17 }, visitor: { ...base.visitor, score: 10 } }), phase: 'live', expects: ['>LIVE<', 'Q1 4:35', '>Pulse<', 'data-game-pulse="developing"'], poll: true },
      { raw: scoreboardGame({ ...base, lifecycle: 'halftime', polling_state: 'active', period: 2, home: { ...base.home, score: 50 }, visitor: { ...base.visitor, score: 50 } }), phase: 'live', expects: ['>Halftime<', '>Pulse<'], poll: true },
      { raw: scoreboardGame({ ...base, lifecycle: 'live', polling_state: 'active', period: 3, clock: '11:40', home: { ...base.home, score: 52 }, visitor: { ...base.visitor, score: 55 } }), phase: 'live', expects: ['Q3 11:40'], poll: true },
      { raw: scoreboardGame({ ...base, lifecycle: 'overtime', polling_state: 'active', period: 5, overtime_periods: 1, clock: 'OT 3:00', home: { ...base.home, score: 101 }, visitor: { ...base.visitor, score: 101 } }), phase: 'live', expects: ['OT 3:00'], poll: true },
      { raw: scoreboardGame({ ...base, lifecycle: 'final', polling_state: 'active', period: 5, overtime_periods: 1, home: { ...base.home, score: 109 }, visitor: { ...base.visitor, score: 105 } }), phase: 'final', expects: ['>FINAL</span>', '>OT<', '>Recap<', 'data-game-pulse="pending"'], poll: true },
      { raw: scoreboardGame({ ...base, lifecycle: 'final', polling_state: 'complete', period: 5, overtime_periods: 1, home: { ...base.home, score: 109 }, visitor: { ...base.visitor, score: 105 } }), phase: 'final', expects: ['<span class="text-cc-secondary">105</span>'], poll: false },
    ];
    const soon = new Date('2026-10-09T22:50:00.000Z');
    const shellClasses = 'bg-white border border-[#DCE9EA] rounded-2xl shadow-sm overflow-hidden h-full';
    for (const step of steps) {
      const slate = mergeTodaysGames(scoreboardResponse([step.raw]));
      expect(slate).toHaveLength(1);
      const html = cardHtml(slate[0]!, 'scoreboard');
      expect(html).toContain(shellClasses);
      expect(html).toContain(`data-phase="${step.phase}"`);
      for (const text of step.expects) expect(html).toContain(text);
      expect(scoreboardPollDelayMs([step.raw], soon) != null).toBe(step.poll);
    }
  });
});

describe('Market card and wiring regressions', () => {
  it('keeps market cards unchanged outside Today\'s Games', () => {
    const market = cardHtml(bettingGame());
    const explicit = cardHtml(bettingGame(), 'market');
    expect(explicit).toBe(market);
    const cardClass = 'bg-white border border-[#DCE9EA] rounded-2xl shadow-sm overflow-hidden';
    expect(market).toContain(cardClass);
    expect(market).toContain('data-presentation="market"');
    expect(market).toContain('data-betting="visible"');
    expect(market).not.toContain('data-phase');
    expect(market).not.toContain('data-season-label');
    expect(market).not.toContain('aria-disabled');
    expect(market).toContain('href="/betting/games/reg-1"');
    for (const heading of MARKET_HEADINGS) expect(market).toContain(heading);
    expect(market).toContain('Market implied probability');
    expect(market).not.toContain('data-game-pulse');

    const noOdds = { ...bettingGame(), hasOdds: false, matchupContext: undefined, homeOdds: { moneyline: null, spread: null, spreadOdds: null }, awayOdds: { moneyline: null, spread: null, spreadOdds: null }, overUnder: null };
    const quietMarket = cardHtml(noOdds);
    expect(quietMarket).toContain('NYK —');
    expect(quietMarket).toContain('View matchup');
    expect(quietMarket).not.toContain('No odds yet');
    expect(quietMarket).not.toContain('Matchup ');
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
    const card = read('components/betting/GameCard.tsx');
    expect(dash.match(/Today's Games/g)?.length).toBe(1);
    expect(dash).toContain('mergeTodaysGames');
    expect(dash).toContain('<GameCard game={game} researchDate={selectedDate} presentation="scoreboard" />');
    expect(dash.match(/<GameCard /g)).toHaveLength(1);
    expect(dash).toContain('todaysGamesUnavailableCopy');
    expect(dash).toContain('No games scheduled for today');
    expect(dash).not.toContain('/api/betting/games');
    expect(dash).toContain('grid-cols-1 md:grid-cols-2 lg:grid-cols-3');
    expect(dash.match(/setInterval/g)).toBeNull();
    expect(dash.match(/setTimeout/g)).toHaveLength(3);
    expect(card).not.toMatch(/\bfetch\(|setInterval|setTimeout|useEffect/);
    expect(card).not.toContain('ScoreboardBody');
    expect(merge).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
    expect(read('lib/scoreboard/client.ts')).not.toMatch(/balldontlie\.io/);
    expect(read('lib/scoreboard/game-pulse.ts')).not.toMatch(/balldontlie\.io|\bfetch\(|Date\.now/);
    expect(read('app/dev/scoreboard/page.tsx')).toMatch(/NODE_ENV === 'production'/);
    expect(todaysGamesUnavailableCopy('disabled')).toBe('Scoreboard serving is turned off.');
    expect(todaysGamesUnavailableCopy('error')).toBe('The game schedule is temporarily unavailable.');
  });
});
