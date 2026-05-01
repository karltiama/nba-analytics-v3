import 'dotenv/config';
import { S3Storage } from '@/lib/aws/s3';

type CliArgs = {
  season: number;
  dryRun: boolean;
  overwrite: boolean;
};

type BdlEnvelope<T> = {
  data: T[];
  meta?: Record<string, unknown>;
};

type BdlGame = {
  id: number | string;
  date?: string | null;
  season?: number | string | null;
  status?: string | null;
  period?: number | null;
  time?: string | null;
  postseason?: boolean | null;
  home_team_score?: number | null;
  visitor_team_score?: number | null;
  home_team?: { id?: number | string | null; abbreviation?: string | null } | null;
  visitor_team?: { id?: number | string | null; abbreviation?: string | null } | null;
};

type BdlStat = {
  player?: { id?: number | string | null; first_name?: string | null; last_name?: string | null } | null;
  team?: { id?: number | string | null; abbreviation?: string | null } | null;
  game?: {
    id?: number | string | null;
    date?: string | null;
    season?: number | string | null;
    status?: string | null;
    home_team_id?: number | string | null;
    visitor_team_id?: number | string | null;
    home_team_score?: number | null;
    visitor_team_score?: number | null;
  } | null;
  min?: string | number | null;
  pts?: number | null;
  reb?: number | null;
  ast?: number | null;
  fg3m?: number | null;
  plus_minus?: number | null;
  turnover?: number | null;
  stl?: number | null;
  blk?: number | null;
  fgm?: number | null;
  fga?: number | null;
  ftm?: number | null;
  fta?: number | null;
};

type ExistingRawGame = {
  season: string;
  game_id: string;
  game_date: string;
  start_time: string | null;
  status: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  home_team_abbr: string | null;
  away_team_abbr: string | null;
  home_score: number | null;
  away_score: number | null;
  venue: null;
  is_postseason: boolean | null;
  game_type: null;
};

type ExistingRawPlayerLog = {
  season: string;
  game_id: string;
  game_date: string;
  player_id: string;
  player_name: string | null;
  team_id: string | null;
  team_abbr: string | null;
  opponent_team_id: string | null;
  opponent_abbr: string | null;
  minutes: string | number | null;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  threes: number | null;
  pra: number | null;
  status: string | null;
  steals: number | null;
  blocks: number | null;
  turnovers: number | null;
  plus_minus: number | null;
  fgm: number | null;
  fga: number | null;
  ftm: number | null;
  fta: number | null;
};

type MaterializationManifest = {
  schemaVersion: 1;
  source: 'existing_ingestion';
  materializedFrom: 'balldontlie';
  originalSourcePrefix: string;
  outputPrefix: string;
  season: number;
  entities: Array<'games' | 'player_game_logs'>;
  recordCounts: {
    games: number;
    player_game_logs: number;
    gamePartitions: number;
    playerLogPartitions: number;
  };
  materializedAt: string;
  status: 'complete' | 'dry-run';
};

function fatal(msg: string): never {
  console.error(`[fatal] ${msg}`);
  process.exit(1);
}

function parseArgs(argv: string[]): CliArgs {
  const flags: Record<string, string | boolean> = {};
  for (const raw of argv) {
    if (!raw.startsWith('--')) continue;
    const eq = raw.indexOf('=');
    if (eq === -1) flags[raw.slice(2)] = true;
    else flags[raw.slice(2, eq)] = raw.slice(eq + 1);
  }
  const seasonRaw = flags.season;
  if (typeof seasonRaw !== 'string' || !/^\d{4}$/.test(seasonRaw)) {
    fatal('Missing or invalid --season=<YYYY>. Example: --season=2024');
  }
  return {
    season: Number(seasonRaw),
    dryRun: flags['dry-run'] === true,
    overwrite: flags.overwrite === true,
  };
}

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) fatal(`Missing required env var: ${name}`);
  return v;
}

function gameDateToDt(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = String(v);
  if (s.length >= 10) return s.slice(0, 10);
  return null;
}

function asString(v: unknown): string | null {
  if (v == null) return null;
  const out = String(v).trim();
  return out.length > 0 ? out : null;
}

async function loadBdlPages<T>(s3: S3Storage, prefix: string): Promise<T[]> {
  const pageKeys: string[] = [];
  for await (const obj of s3.listByPrefix(prefix)) {
    if (/\/page=\d+\.json$/.test(obj.key)) pageKeys.push(obj.key);
  }
  pageKeys.sort((a, b) => {
    const pa = Number(a.match(/page=(\d+)\.json$/)?.[1] ?? 0);
    const pb = Number(b.match(/page=(\d+)\.json$/)?.[1] ?? 0);
    return pa - pb;
  });
  const out: T[] = [];
  for (const key of pageKeys) {
    const env = await s3.getJson<BdlEnvelope<T>>(key);
    if (!env?.data?.length) continue;
    out.push(...env.data);
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const bucket = requireEnv('NBA_DATA_BUCKET');
  const region = process.env.AWS_REGION?.trim() || 'us-east-1';
  const s3 = new S3Storage({ bucket, region });

  const bdlGamesPrefix = `raw/source=balldontlie/league=nba/season=${args.season}/entity=games`;
  const bdlStatsPrefix = `raw/source=balldontlie/league=nba/season=${args.season}/entity=player_stats`;
  const existingGamesPrefix = `raw/source=existing_ingestion/league=nba/season=${args.season}/entity=games`;
  const existingLogsPrefix = `raw/source=existing_ingestion/league=nba/season=${args.season}/entity=player_game_logs`;

  console.log('=== Materialize BDL archive -> existing_ingestion raw ===');
  console.log(`  season         : ${args.season}`);
  console.log(`  dryRun         : ${args.dryRun}`);
  console.log(`  overwrite      : ${args.overwrite}`);
  console.log(`  bdlGamesPrefix : s3://${bucket}/${bdlGamesPrefix}/`);
  console.log(`  bdlStatsPrefix : s3://${bucket}/${bdlStatsPrefix}/`);

  const bdlGames = await loadBdlPages<BdlGame>(s3, bdlGamesPrefix);
  const bdlStats = await loadBdlPages<BdlStat>(s3, bdlStatsPrefix);
  if (bdlGames.length === 0) fatal('No archived BDL games pages found.');
  if (bdlStats.length === 0) fatal('No archived BDL player_stats pages found.');

  const gamesById = new Map<string, ExistingRawGame>();
  const gamesByDt = new Map<string, ExistingRawGame[]>();

  for (const g of bdlGames) {
    const gameId = asString(g.id);
    const dt = gameDateToDt(g.date);
    if (!gameId || !dt) continue;
    const row: ExistingRawGame = {
      season: String(args.season),
      game_id: gameId,
      game_date: dt,
      start_time: asString(g.date),
      status: asString(g.status),
      home_team_id: asString(g.home_team?.id),
      away_team_id: asString(g.visitor_team?.id),
      home_team_abbr: asString(g.home_team?.abbreviation),
      away_team_abbr: asString(g.visitor_team?.abbreviation),
      home_score: g.home_team_score ?? null,
      away_score: g.visitor_team_score ?? null,
      venue: null,
      is_postseason: g.postseason ?? null,
      game_type: null,
    };
    gamesById.set(gameId, row);
  }

  for (const row of gamesById.values()) {
    if (!gamesByDt.has(row.game_date)) gamesByDt.set(row.game_date, []);
    gamesByDt.get(row.game_date)!.push(row);
  }

  const logsByDt = new Map<string, ExistingRawPlayerLog[]>();
  const dedupe = new Set<string>();
  for (const s of bdlStats) {
    const gameId = asString(s.game?.id);
    const playerId = asString(s.player?.id);
    if (!gameId || !playerId) continue;
    const dt = gameDateToDt(s.game?.date) ?? gamesById.get(gameId)?.game_date ?? null;
    if (!dt) continue;
    const game = gamesById.get(gameId);
    const teamId = asString(s.team?.id);
    const homeId = asString(s.game?.home_team_id) ?? game?.home_team_id;
    const awayId = asString(s.game?.visitor_team_id) ?? game?.away_team_id;
    let opponentTeamId: string | null = null;
    let opponentAbbr: string | null = null;
    if (teamId && homeId && awayId) {
      opponentTeamId = teamId === homeId ? awayId : teamId === awayId ? homeId : null;
      opponentAbbr =
        teamId === homeId ? (game?.away_team_abbr ?? null) : teamId === awayId ? (game?.home_team_abbr ?? null) : null;
    }
    const key = `${playerId}::${gameId}`;
    if (dedupe.has(key)) continue;
    dedupe.add(key);
    const playerName = [asString(s.player?.first_name), asString(s.player?.last_name)]
      .filter((v): v is string => Boolean(v))
      .join(' ')
      .trim();
    const row: ExistingRawPlayerLog = {
      season: String(args.season),
      game_id: gameId,
      game_date: dt,
      player_id: playerId,
      player_name: playerName || null,
      team_id: teamId,
      team_abbr: asString(s.team?.abbreviation),
      opponent_team_id: opponentTeamId,
      opponent_abbr: opponentAbbr,
      minutes: s.min ?? null,
      points: s.pts ?? null,
      rebounds: s.reb ?? null,
      assists: s.ast ?? null,
      threes: s.fg3m ?? null,
      pra: s.pts != null && s.reb != null && s.ast != null ? s.pts + s.reb + s.ast : null,
      status: asString(s.game?.status) ?? game?.status ?? null,
      steals: s.stl ?? null,
      blocks: s.blk ?? null,
      turnovers: s.turnover ?? null,
      plus_minus: s.plus_minus ?? null,
      fgm: s.fgm ?? null,
      fga: s.fga ?? null,
      ftm: s.ftm ?? null,
      fta: s.fta ?? null,
    };
    if (!logsByDt.has(dt)) logsByDt.set(dt, []);
    logsByDt.get(dt)!.push(row);
  }

  const gameDts = [...gamesByDt.keys()].sort();
  const logDts = [...logsByDt.keys()].sort();
  console.log(`  games rows      : ${gamesById.size} across ${gameDts.length} dt partitions`);
  console.log(`  player log rows : ${dedupe.size} across ${logDts.length} dt partitions`);

  if (args.dryRun) {
    console.log('  [dry-run] no writes performed.');
    return;
  }

  for (const dt of gameDts) {
    const key = `${existingGamesPrefix}/dt=${dt}/data.jsonl`;
    const rows = gamesByDt.get(dt) ?? [];
    const result = await s3.putJsonLines(key, rows, { overwrite: args.overwrite });
    console.log(`  [${result.reason}] ${key} (${rows.length} rows)`);
  }
  for (const dt of logDts) {
    const key = `${existingLogsPrefix}/dt=${dt}/data.jsonl`;
    const rows = logsByDt.get(dt) ?? [];
    const result = await s3.putJsonLines(key, rows, { overwrite: args.overwrite });
    console.log(`  [${result.reason}] ${key} (${rows.length} rows)`);
  }

  const seasonOutputPrefix = `raw/source=existing_ingestion/league=nba/season=${args.season}`;
  const manifest: MaterializationManifest = {
    schemaVersion: 1,
    source: 'existing_ingestion',
    materializedFrom: 'balldontlie',
    originalSourcePrefix: `raw/source=balldontlie/league=nba/season=${args.season}`,
    outputPrefix: seasonOutputPrefix,
    season: args.season,
    entities: ['games', 'player_game_logs'],
    recordCounts: {
      games: gamesById.size,
      player_game_logs: dedupe.size,
      gamePartitions: gameDts.length,
      playerLogPartitions: logDts.length,
    },
    materializedAt: new Date().toISOString(),
    status: 'complete',
  };
  const manifestKey = `${seasonOutputPrefix}/_materialization_manifest.json`;
  await s3.putJson(manifestKey, manifest, { overwrite: true });
  console.log(`  [manifest] ${manifestKey}`);

  console.log('Done.');
}

main().catch((err) => {
  console.error('[fatal] unhandled error:', err);
  process.exit(1);
});
