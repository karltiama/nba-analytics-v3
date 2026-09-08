import { assertHistoricalServingSeason } from './supported-seasons';

export type HistoricalServingCliArgs = {
  season: number;
  dryRun: boolean;
  overwrite: boolean;
  execute: boolean;
  skipProbe: boolean;
  skipArchive: boolean;
};

export function parseHistoricalServingArgs(argv: string[]): HistoricalServingCliArgs {
  const flags: Record<string, string | boolean> = {};
  for (const raw of argv) {
    if (!raw.startsWith('--')) continue;
    const eq = raw.indexOf('=');
    if (eq === -1) flags[raw.slice(2)] = true;
    else flags[raw.slice(2, eq)] = raw.slice(eq + 1);
  }
  const seasonRaw = flags.season;
  if (typeof seasonRaw !== 'string' || !/^\d{4}$/.test(seasonRaw)) {
    throw new Error('Missing or invalid --season=<YYYY>. Example: --season=2024');
  }
  const season = Number(seasonRaw);
  assertHistoricalServingSeason(season);
  return {
    season,
    dryRun: flags['dry-run'] === true,
    overwrite: flags.overwrite === true,
    execute: flags.execute === true,
    skipProbe: flags['skip-probe'] === true,
    skipArchive: flags['skip-archive'] === true,
  };
}

export type ServingBackfillPlan = {
  season: number;
  storedSeason: string;
  s3GamesPrefix: string;
  s3StatsPrefix: string;
  stagingMode: 'none';
  steps: string[];
  blockedReason: string | null;
};

export function buildServingBackfillPlan(args: {
  season: number;
  rawPrefix?: string;
  blockedReason: string | null;
}): ServingBackfillPlan {
  const rawPrefix = (args.rawPrefix ?? 'raw').replace(/^\/+|\/+$/g, '') || 'raw';
  return {
    season: args.season,
    storedSeason: String(args.season),
    s3GamesPrefix: `${rawPrefix}/source=balldontlie/league=nba/season=${args.season}/entity=games`,
    s3StatsPrefix: `${rawPrefix}/source=balldontlie/league=nba/season=${args.season}/entity=player_stats`,
    stagingMode: 'none',
    blockedReason: args.blockedReason,
    steps: [
      'provider/archive command (BDL games + player_stats, skip-existing)',
      'S3 raw archive under season-scoped prefix',
      'independently verify manifests + page objects',
      'transformBdlArchiveToServing (stagingMode=none; no raw.player_game_stats)',
      'season-scoped analytics writes (games, players, player_game_logs)',
      'season-scoped team_game_stats rebuild',
      'season-scoped player_season_averages rebuild',
      'season-scoped team_season_averages rebuild',
      'season-scoped inferred_pgl stints rebuild',
      'completeness validation',
      'storage checkpoint',
    ],
  };
}

export const PLAYER_SEASON_AVERAGES_SQL = `
      select
        player_id,
        season,
        count(*)::int as games_played,
        avg(points) as pts_avg,
        avg(rebounds) as reb_avg,
        avg(assists) as ast_avg,
        avg(steals) as stl_avg,
        avg(blocks) as blk_avg,
        avg(turnovers) as turnover_avg,
        avg(pra) as pra_avg,
        case when sum(field_goals_attempted) > 0 then sum(field_goals_made)::numeric / sum(field_goals_attempted) else null end as fg_pct,
        case when sum(three_pointers_attempted) > 0 then sum(three_pointers_made)::numeric / sum(three_pointers_attempted) else null end as fg3_pct,
        case when sum(free_throws_attempted) > 0 then sum(free_throws_made)::numeric / sum(free_throws_attempted) else null end as ft_pct
      from analytics.player_game_logs
      where season = $1
      group by player_id, season
`;

export const TEAM_GAME_STATS_SEASON_PREDICATE = `g.season = $1`;
