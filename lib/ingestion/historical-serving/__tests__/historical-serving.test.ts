import { describe, expect, it } from 'vitest';
import { historicalSeasonWindow, isDateInServingWindow } from '../season-window';
import {
  assertGameSeasonIsolation,
  mappingQualityFromReport,
  transformBdlArchiveToServing,
  type BdlGame,
  type BdlStat,
  type TeamCatalogRow,
} from '../bdl-to-serving';
import {
  assertCompleteHistoricalArchive,
  canMaterializeAnalytics,
  isSuccessfulBdlManifest,
  providerAccessBlocksBackfill,
  type BdlEntityManifest,
} from '../archive-gate';
import { planRawPlayerGameStatsCleanup } from '../raw-cleanup';
import { planCompletedSeasonStintsFromLogs } from '../stints-from-logs';
import {
  PLAYER_SEASON_AVERAGES_SQL,
  TEAM_GAME_STATS_SEASON_PREDICATE,
  buildServingBackfillPlan,
  parseHistoricalServingArgs,
} from '../plan';
import { INSERT_INFERRED_STINT_SQL } from '../season-scoped-writes';

const TEAMS: TeamCatalogRow[] = [
  { team_id: '1', abbreviation: 'ATL' },
  { team_id: '2', abbreviation: 'BOS' },
  { team_id: '8', abbreviation: 'DEN' },
  { team_id: '50', abbreviation: 'DEN' },
];

const game = (over: Partial<BdlGame> = {}): BdlGame => ({
  id: 1001,
  date: '2024-10-22',
  datetime: '2024-10-22T23:30:00Z',
  season: 2024,
  status: 'Final',
  postseason: false,
  home_team_score: 110,
  visitor_team_score: 108,
  home_team: { id: 2, abbreviation: 'BOS' },
  visitor_team: { id: 1, abbreviation: 'ATL' },
  ...over,
});

const stat = (over: Partial<BdlStat> = {}): BdlStat => ({
  id: 9,
  min: '34:12',
  pts: 25,
  reb: 8,
  oreb: 2,
  dreb: 6,
  ast: 4,
  stl: 1,
  blk: 0,
  turnover: 3,
  pf: 2,
  plus_minus: 6,
  fgm: 10,
  fga: 20,
  fg3m: 3,
  fg3a: 8,
  ftm: 2,
  fta: 2,
  player: { id: 42, first_name: 'Jayson', last_name: 'Tatum', position: 'F' },
  team: { id: 2, abbreviation: 'BOS' },
  game: {
    id: 1001,
    date: '2024-10-22',
    season: 2024,
    status: 'Final',
    home_team_id: 2,
    visitor_team_id: 1,
    home_team_score: 110,
    visitor_team_score: 108,
  },
  ...over,
});

function manifest(over: Partial<BdlEntityManifest>): BdlEntityManifest {
  return {
    schemaVersion: 1,
    source: 'balldontlie',
    season: 2024,
    entity: 'games',
    endpoint: '/games',
    pageCount: 2,
    recordCount: 200,
    status: 'success',
    ...over,
  };
}

describe('historical season window', () => {
  it('stores 2024 as 2024–25 start-year and excludes adjacent seasons', () => {
    const w = historicalSeasonWindow(2024);
    expect(w.storedSeason).toBe('2024');
    expect(w.label).toBe('2024–25');
    expect(isDateInServingWindow('2024-10-22', w)).toBe(true);
    expect(isDateInServingWindow('2025-06-22', w)).toBe(true);
    expect(isDateInServingWindow('2024-06-17', w)).toBe(false);
    expect(isDateInServingWindow('2025-10-21', w)).toBe(false);
    expect(isDateInServingWindow('2023-12-01', w)).toBe(false);
  });
});

describe('BDL → serving transform', () => {
  it('builds idempotent 2024 game + log rows with opponent/home/season', () => {
    const a = transformBdlArchiveToServing({
      seasonStartYear: 2024,
      games: [game()],
      stats: [stat()],
      teamCatalog: TEAMS,
      existingGames: [],
    });
    const b = transformBdlArchiveToServing({
      seasonStartYear: 2024,
      games: [game(), game()],
      stats: [stat(), stat()],
      teamCatalog: TEAMS,
      existingGames: [],
    });
    expect(a.games).toHaveLength(1);
    expect(a.logs).toHaveLength(1);
    expect(a.games[0]?.season).toBe('2024');
    expect(a.logs[0]?.season).toBe('2024');
    expect(a.logs[0]?.is_home).toBe(true);
    expect(a.logs[0]?.opponent_team_id).toBe('1');
    expect(a.logs[0]?.pra).toBe(37);
    expect(b.games).toEqual(a.games);
    expect(b.logs).toEqual(a.logs);
  });

  it('does not mutate or accept a 2025 game id collision', () => {
    const issue = assertGameSeasonIsolation({ game_id: '1001', season: '2025' }, '2024');
    expect(issue?.kind).toBe('cross_season_game');
    const report = transformBdlArchiveToServing({
      seasonStartYear: 2024,
      games: [game()],
      stats: [stat()],
      teamCatalog: TEAMS,
      existingGames: [{ game_id: '1001', season: '2025' }],
    });
    expect(report.games).toHaveLength(0);
    expect(report.logs).toHaveLength(0);
    expect(report.stats.crossSeasonConflicts).toBe(1);
  });

  it('reports missing teams explicitly instead of dropping silently', () => {
    const report = transformBdlArchiveToServing({
      seasonStartYear: 2024,
      games: [game({ home_team: { id: 99, abbreviation: 'ZZZ' } })],
      stats: [],
      teamCatalog: TEAMS,
      existingGames: [],
    });
    expect(report.games).toHaveLength(0);
    expect(report.issues.some((i) => i.kind === 'missing_team')).toBe(true);
    const q = mappingQualityFromReport(report);
    expect(q.teams.missing).toBeGreaterThan(0);
  });

  it('skips 2023–24 and 2025–26 dates', () => {
    const report = transformBdlArchiveToServing({
      seasonStartYear: 2024,
      games: [
        game({ id: 1, date: '2024-06-01' }),
        game({ id: 2, date: '2025-10-22' }),
        game({ id: 3, date: '2024-10-22' }),
      ],
      stats: [],
      teamCatalog: TEAMS,
      existingGames: [],
    });
    expect(report.games.map((g) => g.game_id)).toEqual(['3']);
    expect(report.stats.gamesSkippedWindow).toBe(2);
  });
});

describe('archive / materialize gate', () => {
  it('treats skip-existing success manifests as complete', () => {
    expect(isSuccessfulBdlManifest(manifest({ status: 'skipped', pageCount: 14, recordCount: 1310 }))).toBe(
      true
    );
    expect(isSuccessfulBdlManifest(manifest({ status: 'partial', pageCount: 3, recordCount: 10 }))).toBe(
      false
    );
    expect(isSuccessfulBdlManifest(manifest({ status: 'success', pageCount: 0, recordCount: 0 }))).toBe(
      false
    );
  });

  it('refuses analytics materialize when player_stats archive is missing', () => {
    const v = assertCompleteHistoricalArchive({
      season: 2024,
      gamesManifest: manifest({ entity: 'games' }),
      statsManifest: null,
      gamesPageKeys: ['page=1.json', 'page=2.json'],
      statsPageKeys: [],
    });
    expect(v.ok).toBe(false);
    expect(canMaterializeAnalytics(v)).toBe(false);
  });

  it('accepts matching page counts for both entities', () => {
    const v = assertCompleteHistoricalArchive({
      season: 2024,
      gamesManifest: manifest({ entity: 'games', pageCount: 2, recordCount: 200 }),
      statsManifest: manifest({
        entity: 'player_stats',
        endpoint: '/stats',
        pageCount: 3,
        recordCount: 300,
      }),
      gamesPageKeys: ['a/page=1.json', 'a/page=2.json'],
      statsPageKeys: ['b/page=1.json', 'b/page=2.json', 'b/page=3.json'],
    });
    expect(v.ok).toBe(true);
    expect(canMaterializeAnalytics(v)).toBe(true);
  });

  it('blocks backfill when /stats is 401', () => {
    const reason = providerAccessBlocksBackfill({
      gamesOk: true,
      statsOk: false,
      statsError: 'BDL /stats returned 401: Unauthorized',
    });
    expect(reason).toMatch(/401/);
    expect(reason).toMatch(/ALL-STAR|GOAT/);
  });
});

describe('raw staging cleanup scope', () => {
  it('refuses unscoped or 2025-overlapping deletes', () => {
    expect(
      planRawPlayerGameStatsCleanup({
        season: '2024',
        stagingGameIds: [],
        protectedSeasonGameIds: ['10'],
      }).ok
    ).toBe(false);
    expect(
      planRawPlayerGameStatsCleanup({
        season: '2024',
        stagingGameIds: ['10', '11'],
        protectedSeasonGameIds: ['10'],
      }).ok
    ).toBe(false);
    expect(
      planRawPlayerGameStatsCleanup({
        season: '2025',
        stagingGameIds: ['99'],
        protectedSeasonGameIds: [],
      }).ok
    ).toBe(false);
  });

  it('allows explicit 2024-only game ids', () => {
    const plan = planRawPlayerGameStatsCleanup({
      season: '2024',
      stagingGameIds: ['200', '201', '200'],
      protectedSeasonGameIds: ['15900001'],
    });
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.candidateCount).toBe(2);
  });
});

describe('player-team multi-stint from logs', () => {
  it('emits two closed inferred stints for a traded player without touching other seasons', () => {
    const plan = planCompletedSeasonStintsFromLogs({
      season: '2024',
      appearances: [
        { playerId: '42', teamId: '2', gameDate: '2024-10-22', gameId: '1' },
        { playerId: '42', teamId: '2', gameDate: '2024-12-01', gameId: '2' },
        { playerId: '42', teamId: '8', gameDate: '2025-02-01', gameId: '3' },
        { playerId: '42', teamId: '8', gameDate: '2025-04-01', gameId: '4' },
      ],
    });
    expect(plan.inferredStints).toHaveLength(2);
    expect(plan.inferredStints.every((s) => s.season === '2024')).toBe(true);
    expect(plan.inferredStints.every((s) => s.observedTo != null)).toBe(true);
    expect(plan.inferredStints.map((s) => s.teamId).sort()).toEqual(['2', '8']);
    expect(plan.stats.multiTeamPlayers).toBe(1);
  });
});

describe('season-average isolation SQL', () => {
  it('scopes averages and team-stats to a bound season', () => {
    expect(PLAYER_SEASON_AVERAGES_SQL).toMatch(/where season = \$1/i);
    expect(PLAYER_SEASON_AVERAGES_SQL).not.toMatch(/where season is not null and season <> ''/i);
    expect(TEAM_GAME_STATS_SEASON_PREDICATE).toBe('g.season = $1');
    expect(INSERT_INFERRED_STINT_SQL).toMatch(/player_entity_id/);
  });
});

describe('WP7.2 orchestrator plan', () => {
  it('parses 2024 dry-run and never selects raw JSONB staging', () => {
    const args = parseHistoricalServingArgs(['--season=2024', '--dry-run']);
    expect(args.season).toBe(2024);
    expect(args.dryRun).toBe(true);
    expect(args.skipArchive).toBe(false);
    expect(parseHistoricalServingArgs(['--season=2024', '--execute', '--skip-probe', '--skip-archive'])).toMatchObject({
      execute: true,
      skipProbe: true,
      skipArchive: true,
    });
    const plan = buildServingBackfillPlan({
      season: 2024,
      blockedReason: 'BDL GET /v1/stats is unauthorized',
    });
    expect(plan.stagingMode).toBe('none');
    expect(plan.s3GamesPrefix).toContain('season=2024/entity=games');
    expect(plan.s3StatsPrefix).toContain('season=2024/entity=player_stats');
    expect(plan.blockedReason).toMatch(/stats/);
  });
});
