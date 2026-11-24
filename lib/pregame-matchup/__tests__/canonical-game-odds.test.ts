import { describe, expect, it } from 'vitest';

import { CANONICAL_CURRENT_ODDS_SQL, canonicalCurrentOddsQuote, type StoredOddsSourceRow } from '@/lib/dashboard/stored-odds';
import { loadPregameMatchup } from '@/lib/pregame-matchup/load';
import { resolveMatchupQuote } from '@/lib/pregame-matchup/quote';
import type { StoredScoreboardGame } from '@/lib/scoreboard/contract';
import { createMemoryScoreboardStore } from '@/lib/scoreboard/store';

const NOW = new Date('2026-11-24T19:20:00.000Z');
const STORED_AT = '2026-11-24T19:09:34.451Z';
const SNAPSHOT_AT = '2026-11-24T19:09:00.546Z';
const SERVING = { SCOREBOARD_MARKETS_SERVING_ENABLED: '1' };

function row(gameId: string, prices: Partial<StoredOddsSourceRow>): StoredOddsSourceRow {
  return {
    game_id: gameId,
    vendor: 'draftkings',
    snapshot_at: SNAPSHOT_AT,
    updated_at: STORED_AT,
    home_moneyline: null,
    away_moneyline: null,
    home_spread: null,
    home_spread_odds: null,
    away_spread: null,
    away_spread_odds: null,
    total: null,
    over_odds: null,
    under_odds: null,
    ...prices,
  };
}

const QUOTES = {
  '21718181': row('21718181', {
    home_moneyline: 110,
    away_moneyline: -130,
    home_spread: '2.5',
    home_spread_odds: -115,
    away_spread: '-2.5',
    away_spread_odds: -105,
    total: '213.5',
    over_odds: -112,
    under_odds: -108,
  }),
  '21718182': row('21718182', {
    home_moneyline: 351,
    away_moneyline: -453,
    home_spread: '11.5',
    home_spread_odds: -117,
    away_spread: '-11.5',
    away_spread_odds: -104,
    total: '218.5',
    over_odds: -112,
    under_odds: -108,
  }),
  '21718183': row('21718183', {
    home_moneyline: -310,
    away_moneyline: 251,
    home_spread: '-8.5',
    home_spread_odds: -108,
    away_spread: '8.5',
    away_spread_odds: -112,
    total: '234.5',
    over_odds: -110,
    under_odds: -110,
  }),
} satisfies Record<string, StoredOddsSourceRow>;

function scheduled(gameId: string, away: string, home: string, tip: string): StoredScoreboardGame {
  return {
    gameId,
    season: 2026,
    seasonType: 'regular',
    seasonTypeSource: 'request_season_type',
    etDate: '2026-11-24',
    scheduledTip: tip,
    homeTeamId: '1',
    homeAbbr: home,
    homeName: home,
    homeScore: null,
    visitorTeamId: '2',
    visitorAbbr: away,
    visitorName: away,
    visitorScore: null,
    providerStatus: null,
    providerStatusState: null,
    period: null,
    clock: null,
    overtimePeriods: 0,
    lifecycle: 'scheduled',
    gamesRequestId: 'req',
    firstObservedAt: STORED_AT,
    lastObservedAt: STORED_AT,
    lastChangedAt: STORED_AT,
    terminalConfirmations: 0,
    finalObservedAt: null,
    pollingState: 'pending',
    boxCompleteness: 'none',
    boxRequestId: null,
    boxObservedAt: null,
    finalBoxAttempts: 0,
  };
}

function show(game: StoredScoreboardGame, source: StoredOddsSourceRow, now = NOW) {
  const quote = canonicalCurrentOddsQuote(source, now);
  expect(quote).not.toBeNull();
  return resolveMatchupQuote({
    game,
    quotes: quote ? [quote] : [],
    now,
    env: SERVING,
    awayAbbr: game.visitorAbbr!,
    homeAbbr: game.homeAbbr!,
  });
}

describe('game page reads the canonical current odds', () => {
  it('shows the F69 DraftKings quotes while they are inside the 35-minute window', () => {
    const orl = show(scheduled('21718181', 'DET', 'ORL', '2026-11-25T00:00:00.000Z'), QUOTES['21718181']);
    expect(orl.quote).toMatchObject({
      vendorLabel: 'DraftKings',
      spreadAway: 'DET -2.5',
      spreadHome: 'ORL +2.5',
      total: 'O/U 213.5',
      moneylineAway: 'DET -130',
      moneylineHome: 'ORL +110',
    });

    const was = show(scheduled('21718182', 'BOS', 'WAS', '2026-11-25T01:00:00.000Z'), QUOTES['21718182']);
    expect(was.quote).toMatchObject({
      spreadAway: 'BOS -11.5',
      spreadHome: 'WAS +11.5',
      total: 'O/U 218.5',
      moneylineAway: 'BOS -453',
      moneylineHome: 'WAS +351',
    });

    const den = show(scheduled('21718183', 'DAL', 'DEN', '2026-11-25T03:00:00.000Z'), QUOTES['21718183']);
    expect(den.quote).toMatchObject({
      spreadAway: 'DAL +8.5',
      spreadHome: 'DEN -8.5',
      total: 'O/U 234.5',
      moneylineAway: 'DAL +251',
      moneylineHome: 'DEN -310',
    });
  });

  it('hides a quote older than 35 minutes, a missing quote, a disabled gate, and a live or final game', () => {
    const game = scheduled('21718181', 'DET', 'ORL', '2026-11-25T00:00:00.000Z');
    const stale = show(game, QUOTES['21718181'], new Date('2026-11-24T19:45:34.451Z'));
    expect(stale.quote).toBeNull();
    expect(stale.note).toMatch(/too old/);

    const missing = resolveMatchupQuote({
      game,
      quotes: [],
      now: NOW,
      env: SERVING,
      awayAbbr: 'DET',
      homeAbbr: 'ORL',
    });
    expect(missing.note).toMatch(/No verified pregame price/);

    const disabled = resolveMatchupQuote({
      game,
      quotes: [canonicalCurrentOddsQuote(QUOTES['21718181'], NOW)!],
      now: NOW,
      env: {},
      awayAbbr: 'DET',
      homeAbbr: 'ORL',
    });
    expect(disabled.note).toMatch(/not being shown/);

    const otherGame = canonicalCurrentOddsQuote(QUOTES['21718182'], NOW)!;
    const mismatched = resolveMatchupQuote({
      game,
      quotes: [otherGame],
      now: NOW,
      env: SERVING,
      awayAbbr: 'DET',
      homeAbbr: 'ORL',
    });
    expect(mismatched.quote).toBeNull();

    const finalGame = show({ ...game, lifecycle: 'final', pollingState: 'complete' }, QUOTES['21718181']);
    expect(finalGame.quote).toBeNull();
    expect(finalGame.note).toMatch(/tipped|no longer scheduled/);

    const live = show({ ...game, lifecycle: 'live', pollingState: 'active' }, QUOTES['21718181']);
    expect(live.quote).toBeNull();
  });

  it('fills the game page from analytics.game_odds_current when the scoreboard odds table is empty', async () => {
    const store = createMemoryScoreboardStore();
    const game = scheduled('21718181', 'DET', 'ORL', '2026-11-25T00:00:00.000Z');
    store.games.set(game.gameId, game);
    const calls: string[] = [];
    const model = await loadPregameMatchup({
      gameId: game.gameId,
      now: NOW,
      env: SERVING,
      store,
      query: async (text) => {
        calls.push(text);
        if (text === CANONICAL_CURRENT_ODDS_SQL) return [QUOTES['21718181']];
        if (text.includes('analytics.games')) return [];
        if (text.includes('team_game_stats')) return [];
        if (text.includes('player_game_logs')) return [];
        if (text.includes('analytics.teams')) return [];
        if (text.includes('roster')) return [];
        return [];
      },
    });
    expect(calls).toContain(CANONICAL_CURRENT_ODDS_SQL);
    expect(model?.quote?.spreadAway).toBe('DET -2.5');
    expect(model?.quote?.moneylineAway).toBe('DET -130');
    expect(model?.quote?.total).toBe('O/U 213.5');
  });
});
