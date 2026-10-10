/**
 * Local scoreboard.v1 fixtures for previews and tests.
 * Not a data source for the production dashboard.
 */

import {
  SCOREBOARD_PROVIDER,
  SCOREBOARD_SCHEMA_VERSION,
  type ScoreboardGame,
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
