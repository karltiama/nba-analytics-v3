import { describe, expect, it } from 'vitest';
import type { StoredScoreboardGame } from '@/lib/scoreboard/contract';
import {
  BASELINE_LOGS_SQL,
  INJURY_FEED_SQL,
  INJURY_ROWS_SQL,
  loadCardContext,
  MATCH_GAMES_SQL,
  PRIOR_GAMES_SQL,
} from '@/lib/scoreboard/card-context/load';

const ENV = { INJURY_SERVING_ENABLED: '1' };
const NOW = new Date('2026-11-02T22:00:00.000Z');

function game(over: Partial<StoredScoreboardGame> = {}): StoredScoreboardGame {
  return {
    gameId: '5001',
    season: 2026,
    seasonType: 'regular',
    seasonTypeSource: 'request_season_type',
    etDate: '2026-11-02',
    scheduledTip: '2026-11-03T00:00:00.000Z',
    homeTeamId: 'okc',
    homeAbbr: 'OKC',
    homeName: 'Oklahoma City Thunder',
    homeScore: null,
    visitorTeamId: 'cle',
    visitorAbbr: 'CLE',
    visitorName: 'Cleveland Cavaliers',
    visitorScore: null,
    providerStatus: null,
    providerStatusState: null,
    period: null,
    clock: null,
    overtimePeriods: 0,
    lifecycle: 'scheduled',
    gamesRequestId: 'req',
    firstObservedAt: NOW.toISOString(),
    lastObservedAt: NOW.toISOString(),
    lastChangedAt: NOW.toISOString(),
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

describe('card context loader', () => {
  it('keeps every analytics read parameterized', () => {
    for (const sql of [MATCH_GAMES_SQL, PRIOR_GAMES_SQL, INJURY_ROWS_SQL, INJURY_FEED_SQL, BASELINE_LOGS_SQL]) {
      expect(sql).not.toMatch(/\$\{/);
    }
    for (const sql of [MATCH_GAMES_SQL, PRIOR_GAMES_SQL, INJURY_ROWS_SQL, BASELINE_LOGS_SQL]) {
      expect(sql).toMatch(/\$\d+/);
    }
    expect(MATCH_GAMES_SQL).toContain('g.home_team_id = s.home_team_id');
    expect(MATCH_GAMES_SQL).toContain('g.away_team_id = s.away_team_id');
    expect(MATCH_GAMES_SQL).not.toContain('g.game_id =');
  });

  it('builds rest and a key injury from one match, and refuses zero or two matches', async () => {
    const calls: string[] = [];
    const query = async (sql: string) => {
      calls.push(sql);
      if (sql === MATCH_GAMES_SQL) {
        return [
          { scoreboard_game_id: '5001', analytics_game_id: 'ag-1', season: '2026', home_team_id: 'okc', away_team_id: 'cle' },
          { scoreboard_game_id: '5002', analytics_game_id: 'ag-2', season: '2026', home_team_id: 'bos', away_team_id: 'nyk' },
          { scoreboard_game_id: '5002', analytics_game_id: 'ag-3', season: '2026', home_team_id: 'bos', away_team_id: 'nyk' },
        ];
      }
      if (sql === PRIOR_GAMES_SQL) {
        return [
          { season: '2026', home_team_id: 'okc', away_team_id: 'x', status: 'Final', season_phase: 'REGULAR', et_date: '2026-11-01' },
          { season: '2026', home_team_id: 'cle', away_team_id: 'y', status: 'Final', season_phase: 'PRESEASON', et_date: '2026-11-01' },
        ];
      }
      if (sql === INJURY_ROWS_SQL) {
        return [
          { player_id: 'a', team_id: 'cle', status: 'Out', snapshot_at: '2026-11-02T21:00:00.000Z', last_name: 'Allen', full_name: 'Jarrett Allen' },
        ];
      }
      if (sql === INJURY_FEED_SQL) return [{ snapshot_at: '2026-11-02T21:00:00.000Z' }];
      if (sql === BASELINE_LOGS_SQL) {
        return [
          { player_id: 'a', team_id: 'cle', season: '2025', season_phase: 'REGULAR', minutes: '32' },
          { player_id: 'a', team_id: 'cle', season: '2025', season_phase: 'REGULAR', minutes: '28' },
          { player_id: 'a', team_id: 'cle', season: '2025', season_phase: 'REGULAR', minutes: '30' },
        ];
      }
      throw new Error(`unexpected sql: ${sql}`);
    };

    const result = await loadCardContext({
      games: [game(), game({ gameId: '5002', homeTeamId: 'bos', homeAbbr: 'BOS', visitorTeamId: 'nyk', visitorAbbr: 'NYK' }), game({ gameId: '5003', homeTeamId: 'lal', homeAbbr: 'LAL', visitorTeamId: 'gsw', visitorAbbr: 'GSW' })],
      query,
      now: NOW,
      env: ENV,
    });

    expect(result['5001'].schedule).toEqual({
      status: 'ready',
      text: 'CLE: season opener · OKC on 2nd night of a back-to-back',
    });
    expect(result['5001'].injuries.status).toBe('listed');
    expect(result['5001'].injuries.text).toContain('CLE: Allen (Out)');
    expect(result['5002'].schedule.status).toBe('unavailable');
    expect(result['5003'].schedule.text).toBe('Schedule context unavailable.');
    expect(calls).toContain(MATCH_GAMES_SQL);
  });

  it('does not call an empty injury table a clean report, and a failed read stays unavailable', async () => {
    const failed = await loadCardContext({
      games: [game()],
      query: async () => {
        throw new Error('db down');
      },
      now: NOW,
      env: ENV,
    });
    expect(failed['5001'].schedule.text).toBe('Schedule context unavailable.');
    expect(failed['5001'].injuries).toEqual({
      status: 'unavailable',
      text: 'Injury report unavailable',
      as_of: null,
    });

    const emptyFeed = await loadCardContext({
      games: [game()],
      query: async (sql: string) => {
        if (sql === MATCH_GAMES_SQL) return [];
        if (sql === INJURY_ROWS_SQL) return [];
        if (sql === INJURY_FEED_SQL) return [{ snapshot_at: null }];
        if (sql === BASELINE_LOGS_SQL) return [];
        return [];
      },
      now: NOW,
      env: ENV,
    });
    expect(emptyFeed['5001'].injuries.status).toBe('unavailable');
  });
});
