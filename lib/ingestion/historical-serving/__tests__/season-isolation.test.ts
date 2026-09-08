import { describe, expect, it } from 'vitest';
import { transformBdlArchiveToServing, type BdlGame, type BdlStat, type TeamCatalogRow } from '../bdl-to-serving';
import { parseHistoricalServingArgs } from '../plan';
import {
  applyHistoricalServingToMemoryStore,
  assertSeasonScopedWriterSql,
  DELETE_INFERRED_STINTS_FOR_SEASON_SQL,
  DELETE_PLAYER_AVERAGES_FOR_SEASON_SQL,
  DELETE_TEAM_AVERAGES_FOR_SEASON_SQL,
  DELETE_TEAM_GAME_STATS_FOR_SEASON_SQL,
  REBUILD_PLAYER_AVERAGES_FOR_SEASON_SQL,
  REBUILD_TEAM_AVERAGES_FOR_SEASON_SQL,
  REBUILD_TEAM_GAME_STATS_FOR_SEASON_SQL,
  snapshotServingStore,
  UPSERT_SERVING_GAME_SQL,
  UPSERT_SERVING_LOG_SQL,
  type MemoryServingStore,
} from '../season-scoped-writes';
import { assertHistoricalServingSeason } from '../supported-seasons';

const TEAMS: TeamCatalogRow[] = [
  { team_id: '1', abbreviation: 'ATL' },
  { team_id: '2', abbreviation: 'BOS' },
];

function game2024(): BdlGame {
  return {
    id: 9001,
    date: '2024-10-22',
    datetime: '2024-10-22T23:30:00Z',
    season: 2024,
    status: 'Final',
    home_team_score: 110,
    visitor_team_score: 108,
    home_team: { id: 2, abbreviation: 'BOS' },
    visitor_team: { id: 1, abbreviation: 'ATL' },
  };
}

function stat2024(): BdlStat {
  return {
    id: 1,
    min: '30:00',
    pts: 20,
    reb: 5,
    ast: 4,
    player: { id: 42, first_name: 'Jayson', last_name: 'Tatum' },
    team: { id: 2, abbreviation: 'BOS' },
    game: {
      id: 9001,
      date: '2024-10-22',
      season: 2024,
      home_team_id: 2,
      visitor_team_id: 1,
      home_team_score: 110,
      visitor_team_score: 108,
    },
  };
}

function protectedStore(): MemoryServingStore {
  return {
    currentAnalyticsSeason: '2025',
    games: [
      { game_id: '2025g', season: '2025', status: 'Final', home_score: 100, away_score: 99 },
    ],
    logs: [{ game_id: '2025g', player_id: '99', team_id: '2', season: '2025', game_date: '2025-10-22' }],
    playerAverages: [{ player_id: '99', season: '2025' }],
    teamStats: [{ team_id: '2', game_id: '2025g', season: '2025' }],
    teamAverages: [{ team_id: '2', season: '2025' }],
    stints: [{ player_id: '99', team_id: '2', season: '2025', source: 'nba_stats' }],
    schedule2026: [{ game_id: '2026g', season: '2026', status: 'Scheduled' }],
  };
}

describe('supported historical serving seasons', () => {
  it('allows 2024 and 2023 and refuses 2022 / arbitrary years', () => {
    expect(parseHistoricalServingArgs(['--season=2024', '--dry-run']).season).toBe(2024);
    expect(parseHistoricalServingArgs(['--season=2023', '--dry-run']).season).toBe(2023);
    expect(() => parseHistoricalServingArgs(['--season=2022'])).toThrow(/S3-archive-only/);
    expect(() => assertHistoricalServingSeason(2021)).toThrow(/2024 and --season=2023 only/);
  });
});

describe('season-scoped historical writers', () => {
  it('keeps every rebuild/delete bound to season = $1', () => {
    for (const sql of [
      UPSERT_SERVING_GAME_SQL,
      UPSERT_SERVING_LOG_SQL,
      DELETE_TEAM_GAME_STATS_FOR_SEASON_SQL,
      DELETE_PLAYER_AVERAGES_FOR_SEASON_SQL,
      DELETE_TEAM_AVERAGES_FOR_SEASON_SQL,
      DELETE_INFERRED_STINTS_FOR_SEASON_SQL,
      REBUILD_TEAM_GAME_STATS_FOR_SEASON_SQL,
      REBUILD_PLAYER_AVERAGES_FOR_SEASON_SQL,
      REBUILD_TEAM_AVERAGES_FOR_SEASON_SQL,
    ]) {
      assertSeasonScopedWriterSql(sql);
    }
    expect(DELETE_TEAM_GAME_STATS_FOR_SEASON_SQL).toMatch(/season = \$1/);
    expect(REBUILD_TEAM_GAME_STATS_FOR_SEASON_SQL).toMatch(/g\.season = \$1/);
    expect(REBUILD_PLAYER_AVERAGES_FOR_SEASON_SQL).toMatch(/where season = \$1/i);
    expect(DELETE_INFERRED_STINTS_FOR_SEASON_SQL).toMatch(/season = \$1/);
    expect(UPSERT_SERVING_GAME_SQL).toMatch(/where analytics\.games\.season = excluded\.season/);
    expect(UPSERT_SERVING_LOG_SQL).toMatch(/where analytics\.player_game_logs\.season = excluded\.season/);
  });

  it('2024 apply leaves synthetic 2025/2026 fixtures and the season pin unchanged', () => {
    const store = protectedStore();
    const before = snapshotServingStore(store);
    const report = transformBdlArchiveToServing({
      seasonStartYear: 2024,
      games: [game2024()],
      stats: [stat2024()],
      teamCatalog: TEAMS,
      existingGames: store.games,
    });
    applyHistoricalServingToMemoryStore(store, report);
    expect(store.games.some((g) => g.game_id === '9001' && g.season === '2024')).toBe(true);
    expect(store.logs.some((l) => l.season === '2024')).toBe(true);
    const protectedSlice = {
      currentAnalyticsSeason: store.currentAnalyticsSeason,
      games2025: store.games.filter((g) => g.season === '2025'),
      logs2025: store.logs.filter((l) => l.season === '2025'),
      playerAverages2025: store.playerAverages.filter((r) => r.season === '2025'),
      teamStats2025: store.teamStats.filter((r) => r.season === '2025'),
      teamAverages2025: store.teamAverages.filter((r) => r.season === '2025'),
      stints2025: store.stints.filter((s) => s.season === '2025'),
      schedule2026: store.schedule2026,
    };
    const beforeObj = JSON.parse(before) as MemoryServingStore;
    expect(protectedSlice).toEqual({
      currentAnalyticsSeason: '2025',
      games2025: beforeObj.games.filter((g) => g.season === '2025'),
      logs2025: beforeObj.logs.filter((l) => l.season === '2025'),
      playerAverages2025: beforeObj.playerAverages.filter((r) => r.season === '2025'),
      teamStats2025: beforeObj.teamStats.filter((r) => r.season === '2025'),
      teamAverages2025: beforeObj.teamAverages.filter((r) => r.season === '2025'),
      stints2025: beforeObj.stints.filter((s) => s.season === '2025'),
      schedule2026: beforeObj.schedule2026,
    });
  });
});
