/**
 * Local scoreboard.v1 fixtures for previews and tests.
 * Not a data source for the production dashboard.
 */

import {
  SCOREBOARD_PROVIDER,
  SCOREBOARD_SCHEMA_VERSION,
  type ScoreboardGame,
  type ScoreboardMarket,
  type ScoreboardResponse,
} from './contract';

export const SCOREBOARD_FIXTURE_OBSERVED_AT = '2026-10-09T23:41:00.000Z';
const TIP = '2026-10-09T23:00:00.000Z';

type Player = ScoreboardGame['box_score']['players'][number];

type GameInput = Partial<Omit<ScoreboardGame, 'home' | 'visitor' | 'box_score'>> & {
  game_id: string;
  lifecycle: ScoreboardGame['lifecycle'];
  home?: Partial<ScoreboardGame['home']>;
  visitor?: Partial<ScoreboardGame['visitor']>;
  box_score?: Partial<ScoreboardGame['box_score']>;
};

export function scoreboardGame(input: GameInput): ScoreboardGame {
  const { home, visitor, box_score: box, ...rest } = input;
  return {
    provider: SCOREBOARD_PROVIDER,
    season: 2026,
    season_type: 'preseason',
    season_type_source: 'request_season_type',
    model_eligible: false,
    et_date: '2026-10-09',
    scheduled_tip: TIP,
    provider_status: null,
    period: null,
    clock: null,
    overtime_periods: 0,
    acquired_at: SCOREBOARD_FIXTURE_OBSERVED_AT,
    last_changed_at: SCOREBOARD_FIXTURE_OBSERVED_AT,
    stale: false,
    stale_reason: null,
    polling_state: 'active',
    ...rest,
    home: {
      provider_team_id: '5',
      abbreviation: 'CHI',
      name: 'Chicago Bulls',
      score: null,
      ...home,
    },
    visitor: {
      provider_team_id: '15',
      abbreviation: 'MEM',
      name: 'Memphis Grizzlies',
      score: null,
      ...visitor,
    },
    box_score: {
      completeness: 'none',
      acquired_at: null,
      players: [],
      ...box,
    },
  };
}

export function scoreboardResponse(games: ScoreboardGame[], over: Partial<Pick<ScoreboardResponse, 'date' | 'generated_at' | 'stale'>> = {}): ScoreboardResponse {
  return {
    schema_version: SCOREBOARD_SCHEMA_VERSION,
    date: over.date ?? '2026-10-09',
    generated_at: over.generated_at ?? SCOREBOARD_FIXTURE_OBSERVED_AT,
    source: { provider: SCOREBOARD_PROVIDER, coverage: 'display_only' },
    stale: over.stale ?? games.some((game) => game.stale),
    games,
  };
}

function line(partial: Partial<Player> & Pick<Player, 'playerId' | 'teamId'>): Player {
  return {
    name: null,
    min: null,
    pts: null,
    reb: null,
    ast: null,
    fgm: null,
    fga: null,
    fg3m: null,
    fg3a: null,
    ftm: null,
    fta: null,
    oreb: null,
    dreb: null,
    ...partial,
  };
}

/** name, min, fgm, fga, fg3m, fg3a, ftm, fta, oreb, dreb, ast */
type BoxRow = [string, string, number, number, number, number, number, number, number, number, number];

/** Consistent player lines: pts = 2*FGM + 3PM + FTM and reb = oreb + dreb. */
function boxLines(teamId: string, rows: BoxRow[]): Player[] {
  return rows.map(([name, min, fgm, fga, fg3m, fg3a, ftm, fta, oreb, dreb, ast], i) =>
    line({ playerId: `${teamId}${String(i + 1).padStart(2, '0')}`, teamId, name, min, pts: 2 * fgm + fg3m + ftm, reb: oreb + dreb, ast, fgm, fga, fg3m, fg3a, ftm, fta, oreb, dreb })
  );
}

/**
 * Shape of the audited preseason snapshot (game 21717908, LAC at TOR, Q1 4:35, 10–17).
 * The provider clock already carries the quarter. Fixture only; not live data.
 */
export function auditLiveGame(over: Partial<GameInput> = {}): ScoreboardGame {
  return scoreboardGame({
    game_id: '21717908',
    lifecycle: 'live',
    provider_status: '1st Qtr',
    period: 1,
    clock: 'Q1 4:35',
    acquired_at: '2026-10-09T23:39:00.000Z',
    home: { provider_team_id: '28', abbreviation: 'TOR', name: 'Toronto Raptors', score: 17 },
    visitor: { provider_team_id: '13', abbreviation: 'LAC', name: 'LA Clippers', score: 10 },
    box_score: {
      completeness: 'live_partial',
      acquired_at: '2026-10-09T23:39:00.000Z',
      players: [
        line({ playerId: '501', teamId: '28', name: 'RJ Barrett', min: '7', pts: 9, reb: 1, ast: 0 }),
        line({ playerId: '502', teamId: '28', name: 'Scottie Barnes', min: '7', pts: 4, reb: 3, ast: 2 }),
        line({ playerId: '503', teamId: '13', name: 'James Harden', min: '7', pts: 5, reb: 0, ast: 3 }),
        line({ playerId: '504', teamId: '13', name: 'Ivica Zubac', min: '7', pts: null, reb: 2, ast: 0 }),
      ],
    },
    ...over,
  });
}

/**
 * Prices from the audited DraftKings /v2/odds row for game 21826163 (SAS at PHX, captured
 * 2026-10-11T00:26Z). Timestamps are moved onto the fixture clock so the caption reads "3m ago".
 */
export function auditPregameMarket(over: Partial<ScoreboardMarket> = {}): ScoreboardMarket {
  return {
    kind: 'current_pregame',
    vendor: 'draftkings',
    vendor_label: 'DraftKings',
    freshness: 'fresh',
    provider_updated_at: '2026-10-09T23:38:00.000Z',
    observed_at: '2026-10-09T23:38:30.000Z',
    moneyline: { home: 200, away: -245 },
    spread: { home: 7.5, away: -7.5, home_odds: -115, away_odds: -105 },
    total: { line: 223.5, over_odds: -115, under_odds: -105 },
    ...over,
  };
}

export function auditPregameGame(over: Partial<GameInput> = {}): ScoreboardGame {
  return scoreboardGame({
    game_id: '21826163',
    lifecycle: 'scheduled',
    polling_state: 'pending',
    scheduled_tip: '2026-10-10T02:00:00.000Z',
    home: { provider_team_id: '24', abbreviation: 'PHX', name: 'Phoenix Suns' },
    visitor: { provider_team_id: '27', abbreviation: 'SAS', name: 'San Antonio Spurs' },
    market: auditPregameMarket(),
    ...over,
  });
}

/** Mixed preseason slate plus season-label samples. Fixture only. */
export function scoreboardPreviewResponse(): ScoreboardResponse {
  const partialPlayers: Player[] = [
    line({
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
    }),
    line({
      playerId: '102',
      teamId: '20',
      name: 'Jalen Brunson',
      min: '22',
      pts: 18,
      reb: 3,
      ast: 5,
      fgm: 7,
      fga: 14,
      fg3m: 2,
      fg3a: 6,
      ftm: 2,
      fta: 2,
      oreb: 0,
      dreb: 3,
    }),
    line({
      playerId: '103',
      teamId: '2',
      name: 'Jaylen Brown',
      min: '20',
      pts: null,
      reb: 4,
      ast: 2,
      fgm: null,
      fga: null,
      fg3m: null,
      fg3a: null,
      ftm: null,
      fta: null,
      oreb: 2,
      dreb: 2,
    }),
  ];

  const games: ScoreboardGame[] = [
    scoreboardGame({
      game_id: 'sched-1',
      lifecycle: 'scheduled',
      polling_state: 'pending',
      home: { score: 0 },
      visitor: { score: 0 },
    }),
    auditPregameGame(),
    auditLiveGame(),
    scoreboardGame({
      game_id: 'live-shooting',
      lifecycle: 'live',
      period: 3,
      clock: 'Q3 6:10',
      home: { provider_team_id: '2', abbreviation: 'BOS', name: 'Boston Celtics', score: 83 },
      visitor: { provider_team_id: '17', abbreviation: 'MIL', name: 'Milwaukee Bucks', score: 65 },
      box_score: {
        completeness: 'live_partial',
        acquired_at: SCOREBOARD_FIXTURE_OBSERVED_AT,
        players: [
          ...boxLines('2', [
            ['Jayson Tatum', '28', 8, 16, 4, 8, 4, 4, 1, 6, 3],
            ['Jaylen Brown', '26', 7, 14, 3, 6, 3, 4, 1, 4, 2],
            ['Derrick White', '27', 5, 10, 3, 6, 1, 2, 1, 3, 5],
            ['Jrue Holiday', '25', 4, 9, 2, 4, 2, 2, 1, 3, 4],
            ['Kristaps Porzingis', '22', 4, 8, 1, 2, 0, 0, 2, 5, 1],
            ['Sam Hauser', '14', 2, 5, 0, 1, 0, 0, 1, 1, 0],
          ]),
          ...boxLines('17', [
            ['Giannis Antetokounmpo', '27', 10, 18, 0, 1, 3, 6, 3, 7, 5],
            ['Damian Lillard', '27', 6, 15, 3, 10, 2, 2, 0, 2, 4],
            ['Kyle Kuzma', '24', 4, 10, 1, 5, 0, 0, 1, 3, 1],
            ['Bobby Portis', '18', 4, 9, 1, 4, 0, 0, 1, 4, 0],
            ['Gary Trent Jr.', '20', 2, 7, 1, 4, 0, 0, 0, 1, 1],
            ['AJ Green', '12', 1, 4, 0, 1, 0, 2, 1, 1, 0],
          ]),
        ],
      },
    }),
    scoreboardGame({
      game_id: 'live-glass',
      lifecycle: 'live',
      period: 2,
      clock: 'Q2 3:12',
      home: { provider_team_id: '20', abbreviation: 'NYK', name: 'New York Knicks', score: 52 },
      visitor: { provider_team_id: '18', abbreviation: 'MIN', name: 'Minnesota Timberwolves', score: 50 },
      box_score: {
        completeness: 'live_partial',
        acquired_at: SCOREBOARD_FIXTURE_OBSERVED_AT,
        players: [
          ...boxLines('20', [
            ['Jalen Brunson', '20', 6, 14, 1, 4, 3, 4, 0, 2, 5],
            ['Karl-Anthony Towns', '19', 5, 10, 1, 3, 2, 2, 4, 5, 1],
            ['OG Anunoby', '18', 3, 8, 1, 4, 0, 0, 2, 3, 1],
            ['Josh Hart', '18', 3, 6, 0, 1, 1, 2, 3, 4, 3],
            ['Mikal Bridges', '19', 3, 8, 1, 3, 0, 0, 1, 1, 2],
            ['Mitchell Robinson', '10', 1, 2, 0, 0, 0, 0, 1, 3, 0],
          ]),
          ...boxLines('18', [
            ['Anthony Edwards', '20', 7, 15, 2, 6, 2, 2, 0, 2, 2],
            ['Julius Randle', '18', 4, 9, 1, 2, 2, 3, 1, 4, 2],
            ['Rudy Gobert', '17', 3, 4, 0, 0, 0, 1, 1, 5, 0],
            ['Jaden McDaniels', '18', 2, 6, 1, 3, 0, 0, 0, 3, 1],
            ['Mike Conley', '15', 2, 5, 1, 3, 1, 2, 0, 1, 4],
            ['Naz Reid', '11', 2, 5, 0, 2, 0, 0, 1, 2, 0],
          ]),
        ],
      },
    }),
    scoreboardGame({
      game_id: 'final-recap',
      lifecycle: 'final',
      period: 4,
      polling_state: 'complete',
      home: { score: 105 },
      visitor: { score: 100 },
      box_score: {
        completeness: 'verified_final',
        acquired_at: SCOREBOARD_FIXTURE_OBSERVED_AT,
        players: [
          ...boxLines('5', [
            ['Zach LaVine', '38', 9, 19, 3, 8, 8, 9, 0, 4, 4],
            ['Nikola Vucevic', '36', 8, 16, 1, 3, 4, 5, 3, 9, 3],
            ['Josh Giddey', '34', 5, 12, 1, 4, 3, 4, 1, 6, 8],
            ['Patrick Williams', '32', 4, 10, 2, 5, 3, 4, 1, 4, 1],
            ['Coby White', '30', 4, 11, 2, 6, 2, 2, 0, 3, 4],
            ['Matas Buzelis', '28', 3, 7, 1, 3, 1, 2, 1, 3, 1],
            ['Jalen Smith', '24', 2, 5, 1, 3, 0, 0, 1, 2, 1],
            ['Julian Phillips', '18', 1, 3, 0, 1, 1, 2, 1, 2, 0],
          ]),
          ...boxLines('15', [
            ['Ja Morant', '36', 9, 20, 2, 6, 5, 6, 1, 4, 7],
            ['Desmond Bane', '36', 8, 17, 4, 9, 2, 2, 0, 4, 3],
            ['Jaren Jackson Jr.', '34', 7, 14, 2, 5, 3, 4, 2, 6, 1],
            ['Jaylen Wells', '32', 4, 9, 2, 5, 0, 0, 1, 3, 1],
            ['Zach Edey', '28', 4, 6, 0, 0, 1, 2, 3, 6, 0],
            ['Santi Aldama', '28', 3, 8, 1, 4, 0, 0, 1, 4, 2],
            ['Scotty Pippen Jr.', '26', 2, 6, 1, 3, 1, 1, 0, 2, 3],
            ['John Konchar', '20', 1, 3, 0, 1, 0, 0, 1, 2, 1],
          ]),
        ],
      },
    }),
    scoreboardGame({
      game_id: 'live-one-team',
      lifecycle: 'live',
      period: 2,
      clock: '6:20',
      acquired_at: '2026-10-09T23:39:00.000Z',
      home: { provider_team_id: '11', abbreviation: 'HOU', name: 'Houston Rockets', score: 40 },
      visitor: { provider_team_id: '19', abbreviation: 'NOP', name: 'New Orleans Pelicans', score: 36 },
      box_score: {
        completeness: 'live_partial',
        acquired_at: '2026-10-09T23:39:00.000Z',
        players: [line({ playerId: '401', teamId: '11', name: 'Alperen Sengun', min: '16', pts: 12 })],
      },
    }),
    scoreboardGame({
      game_id: 'live-tied',
      lifecycle: 'live',
      season_type: 'regular',
      period: 4,
      clock: 'Q4 2:05',
      home: { provider_team_id: '9', abbreviation: 'DET', name: 'Detroit Pistons', score: 97 },
      visitor: { provider_team_id: '21', abbreviation: 'OKC', name: 'Oklahoma City Thunder', score: 97 },
    }),
    scoreboardGame({
      game_id: 'delayed-1',
      lifecycle: 'unknown',
      provider_status: 'Delayed',
      home: { provider_team_id: '23', abbreviation: 'PHI', name: 'Philadelphia 76ers' },
      visitor: { provider_team_id: '3', abbreviation: 'BKN', name: 'Brooklyn Nets' },
    }),
    scoreboardGame({
      game_id: 'live-partial',
      lifecycle: 'live',
      period: 3,
      clock: '4:12',
      provider_status: '3rd Qtr',
      home: { provider_team_id: '20', abbreviation: 'NYK', name: 'New York Knicks', score: 91 },
      visitor: { provider_team_id: '2', abbreviation: 'BOS', name: 'Boston Celtics', score: 88 },
      box_score: {
        completeness: 'live_partial',
        acquired_at: SCOREBOARD_FIXTURE_OBSERVED_AT,
        players: partialPlayers,
      },
    }),
    scoreboardGame({
      game_id: 'live-stale',
      lifecycle: 'live',
      period: 4,
      clock: '1:09',
      stale: true,
      stale_reason: 'no_recent_observation',
      home: { provider_team_id: '10', abbreviation: 'GSW', name: 'Golden State Warriors', score: 99 },
      visitor: { provider_team_id: '14', abbreviation: 'LAL', name: 'Los Angeles Lakers', score: 102 },
    }),
    scoreboardGame({
      game_id: 'half-1',
      lifecycle: 'halftime',
      period: 2,
      clock: '0:00',
      home: { provider_team_id: '8', abbreviation: 'DEN', name: 'Denver Nuggets', score: 51 },
      visitor: { provider_team_id: '16', abbreviation: 'MIA', name: 'Miami Heat', score: 54 },
    }),
    scoreboardGame({
      game_id: 'ot-1',
      lifecycle: 'overtime',
      period: 5,
      clock: '1:48',
      overtime_periods: 1,
      home: { provider_team_id: '24', abbreviation: 'PHX', name: 'Phoenix Suns', score: 110 },
      visitor: { provider_team_id: '17', abbreviation: 'MIL', name: 'Milwaukee Bucks', score: 108 },
    }),
    scoreboardGame({
      game_id: 'final-1',
      lifecycle: 'final',
      period: 4,
      clock: '0:00',
      polling_state: 'complete',
      home: { provider_team_id: '27', abbreviation: 'SAS', name: 'San Antonio Spurs', score: 104 },
      visitor: { provider_team_id: '7', abbreviation: 'DAL', name: 'Dallas Mavericks', score: 98 },
      box_score: {
        completeness: 'verified_final',
        acquired_at: SCOREBOARD_FIXTURE_OBSERVED_AT,
        players: [
          line({
            playerId: '201',
            teamId: '27',
            name: 'Victor Wembanyama',
            min: '28',
            pts: 24,
            reb: 11,
            ast: 3,
            fgm: 9,
            fga: 16,
            fg3m: 2,
            fg3a: 5,
            ftm: 4,
            fta: 5,
            oreb: 3,
            dreb: 8,
          }),
          line({ playerId: '202', teamId: '7', name: 'Luka Doncic', min: '33', pts: 22, reb: 7, ast: 9 }),
        ],
      },
    }),
    scoreboardGame({
      game_id: 'final-ot',
      lifecycle: 'final',
      period: 5,
      overtime_periods: 1,
      polling_state: 'complete',
      home: { provider_team_id: '22', abbreviation: 'ORL', name: 'Orlando Magic', score: 112 },
      visitor: { provider_team_id: '1', abbreviation: 'ATL', name: 'Atlanta Hawks', score: 109 },
    }),
    scoreboardGame({
      game_id: 'final-unverified',
      lifecycle: 'final',
      polling_state: 'complete',
      home: { provider_team_id: '4', abbreviation: 'CHA', name: 'Charlotte Hornets', score: 101 },
      visitor: { provider_team_id: '6', abbreviation: 'CLE', name: 'Cleveland Cavaliers', score: 97 },
      box_score: {
        completeness: 'final_unverified',
        acquired_at: SCOREBOARD_FIXTURE_OBSERVED_AT,
        players: [
          line({ playerId: '301', teamId: '6', name: 'Donovan Mitchell', min: '30', pts: 21, reb: 4, ast: 4 }),
        ],
      },
    }),
    scoreboardGame({
      game_id: 'post-1',
      lifecycle: 'postponed',
      polling_state: 'complete',
      home: { provider_team_id: '30', abbreviation: 'WAS', name: 'Washington Wizards', score: 40 },
      visitor: { provider_team_id: '1', abbreviation: 'ATL', name: 'Atlanta Hawks', score: 38 },
    }),
    scoreboardGame({
      game_id: 'cancel-1',
      lifecycle: 'canceled',
      polling_state: 'complete',
      home: { provider_team_id: '4', abbreviation: 'CHA', name: 'Charlotte Hornets' },
      visitor: { provider_team_id: '22', abbreviation: 'ORL', name: 'Orlando Magic' },
    }),
    scoreboardGame({
      game_id: 'unknown-scores',
      lifecycle: 'unknown',
      home: { provider_team_id: '29', abbreviation: 'UTA', name: 'Utah Jazz', score: 68 },
      visitor: { provider_team_id: '18', abbreviation: 'MIN', name: 'Minnesota Timberwolves', score: 70 },
    }),
    scoreboardGame({
      game_id: 'safety-stopped',
      lifecycle: 'live',
      period: 2,
      clock: '8:02',
      stale: true,
      stale_reason: 'polling_safety_stopped',
      polling_state: 'safety_stopped',
      home: { provider_team_id: '26', abbreviation: 'SAC', name: 'Sacramento Kings', score: 44 },
      visitor: { provider_team_id: '25', abbreviation: 'POR', name: 'Portland Trail Blazers', score: 41 },
    }),
    scoreboardGame({
      game_id: 'regular-label',
      lifecycle: 'scheduled',
      season_type: 'regular',
      scheduled_tip: '2026-10-22T23:30:00.000Z',
      home: { provider_team_id: '2', abbreviation: 'BOS', name: 'Boston Celtics' },
      visitor: { provider_team_id: '20', abbreviation: 'NYK', name: 'New York Knicks' },
    }),
    scoreboardGame({
      game_id: 'playin-label',
      lifecycle: 'live',
      season_type: 'playin',
      period: 1,
      clock: '9:15',
      home: { provider_team_id: '16', abbreviation: 'MIA', name: 'Miami Heat', score: 12 },
      visitor: { provider_team_id: '1', abbreviation: 'ATL', name: 'Atlanta Hawks', score: 10 },
    }),
    scoreboardGame({
      game_id: 'playoffs-label',
      lifecycle: 'final',
      season_type: 'playoffs',
      polling_state: 'complete',
      overtime_periods: 2,
      home: { provider_team_id: '2', abbreviation: 'BOS', name: 'Boston Celtics', score: 118 },
      visitor: { provider_team_id: '18', abbreviation: 'MIN', name: 'Minnesota Timberwolves', score: 115 },
    }),
  ];

  return scoreboardResponse(games);
}

/** Isolated adapter. Callers must be preview pages or tests, never the production strip. */
export function loadScoreboardFixture(): ScoreboardResponse {
  return scoreboardPreviewResponse();
}
