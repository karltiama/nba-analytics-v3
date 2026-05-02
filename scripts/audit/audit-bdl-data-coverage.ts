import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { S3Storage } from '@/lib/aws/s3';

type StorageKind = 's3' | 'local';

type CliArgs = {
  seasons: number[];
  outputDir: string;
  localRoot: string | null;
};

type SeasonCoverage = {
  season: number;
  storage: StorageKind;
  games_count: number;
  player_logs_count: number;
  game_partitions: number;
  player_log_partitions: number;
  curated_games_count: number;
  curated_logs_count: number;
  feature_rows_count: number;
  missing_dates: {
    games: string[];
    player_game_logs: string[];
  };
  prop_odds: {
    detected: boolean;
    matched_prefixes: string[];
  };
  warnings: string[];
};

type CoverageReport = {
  generated_at: string;
  mode: StorageKind;
  bucket?: string;
  local_root?: string;
  seasons: number[];
  season_coverage: SeasonCoverage[];
  global_warnings: string[];
};

function fatal(message: string): never {
  console.error(`[fatal] ${message}`);
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

  const seasonsRaw = typeof flags.seasons === 'string' ? flags.seasons : '2023,2024,2025,2026';
  const seasons = seasonsRaw
    .split(',')
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isInteger(v) && String(v).length === 4);
  if (seasons.length === 0) {
    fatal('No valid seasons provided. Example: --seasons=2023,2024,2025,2026');
  }

  const outputDir =
    typeof flags['output-dir'] === 'string'
      ? path.resolve(flags['output-dir'])
      : path.resolve('reports/data-coverage');

  const localFromFlag = typeof flags['local-root'] === 'string' ? flags['local-root'] : null;
  const localFromEnv =
    process.env.NBA_DATA_LOCAL_ROOT?.trim() || process.env.DATA_LAKE_DIR?.trim() || null;

  return {
    seasons,
    outputDir,
    localRoot: localFromFlag ?? localFromEnv,
  };
}

function compactKeyPrefix(rawPrefix: string): string {
  const trimmed = rawPrefix.trim().replace(/^\/+|\/+$/g, '');
  return trimmed.length > 0 ? trimmed : 'raw';
}

async function existsLocal(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function dateRangeDates(from: string, to: string): string[] {
  const out: string[] = [];
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return out;
  const current = new Date(start);
  while (current <= end) {
    out.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return out;
}

function findMissingDates(partitions: string[]): string[] {
  const uniq = [...new Set(partitions)].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  if (uniq.length < 2) return [];
  const expected = new Set(dateRangeDates(uniq[0], uniq[uniq.length - 1]));
  for (const p of uniq) expected.delete(p);
  return [...expected].sort();
}

async function listS3DataJsonlPartitions(s3: S3Storage, prefix: string): Promise<string[]> {
  const dts = new Set<string>();
  for await (const obj of s3.listByPrefix(prefix)) {
    const m = obj.key.match(/\/dt=(\d{4}-\d{2}-\d{2})\/data\.jsonl$/);
    if (m) dts.add(m[1]);
  }
  return [...dts].sort();
}

async function countS3JsonlRows(s3: S3Storage, key: string): Promise<number> {
  const body = await s3.getText(key);
  if (!body || !body.trim()) return 0;
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean).length;
}

async function tryReadS3ManifestRecordCount(s3: S3Storage, key: string): Promise<number | null> {
  const manifest = await s3.getJson<Record<string, unknown>>(key);
  if (!manifest) return null;
  const rowCountRaw =
    manifest.rowCount ?? manifest.recordCount ?? (manifest.recordCounts as Record<string, unknown> | undefined);
  if (typeof rowCountRaw === 'number') return rowCountRaw;
  return null;
}

async function countS3RawRowsFromPartitions(
  s3: S3Storage,
  prefix: string,
  partitions: string[]
): Promise<number> {
  let total = 0;
  for (const dt of partitions) {
    total += await countS3JsonlRows(s3, `${prefix}/dt=${dt}/data.jsonl`);
  }
  return total;
}

async function listLocalJsonlPartitions(prefix: string): Promise<string[]> {
  const out = new Set<string>();
  if (!(await existsLocal(prefix))) return [];
  const entries = await fs.readdir(prefix, { withFileTypes: true });
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const m = ent.name.match(/^dt=(\d{4}-\d{2}-\d{2})$/);
    if (!m) continue;
    const filePath = path.join(prefix, ent.name, 'data.jsonl');
    if (await existsLocal(filePath)) out.add(m[1]);
  }
  return [...out].sort();
}

async function countLocalJsonlRows(filePath: string): Promise<number> {
  if (!(await existsLocal(filePath))) return 0;
  const body = await fs.readFile(filePath, 'utf8');
  if (!body.trim()) return 0;
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean).length;
}

async function countLocalRawRowsFromPartitions(prefix: string, partitions: string[]): Promise<number> {
  let total = 0;
  for (const dt of partitions) {
    total += await countLocalJsonlRows(path.join(prefix, `dt=${dt}`, 'data.jsonl'));
  }
  return total;
}

async function tryReadLocalManifestRecordCount(filePath: string): Promise<number | null> {
  if (!(await existsLocal(filePath))) return null;
  const text = await fs.readFile(filePath, 'utf8');
  const parsed = JSON.parse(text) as Record<string, unknown>;
  const rowCountRaw =
    parsed.rowCount ?? parsed.recordCount ?? (parsed.recordCounts as Record<string, unknown> | undefined);
  if (typeof rowCountRaw === 'number') return rowCountRaw;
  return null;
}

function uniqueWarnings(input: string[]): string[] {
  return [...new Set(input)];
}

async function buildS3SeasonCoverage(args: {
  s3: S3Storage;
  rawPrefix: string;
  season: number;
}): Promise<SeasonCoverage> {
  const { s3, rawPrefix, season } = args;
  const warnings: string[] = [];
  const seasonBase = `${rawPrefix}/source=existing_ingestion/league=nba/season=${season}`;
  const gamesRawPrefix = `${seasonBase}/entity=games`;
  const logsRawPrefix = `${seasonBase}/entity=player_game_logs`;
  const curatedGamesPrefix = `curated/league=nba/season=${season}/entity=games`;
  const curatedLogsPrefix = `curated/league=nba/season=${season}/entity=player_game_logs`;
  const featuresPrefix = `features/league=nba/season=${season}/entity=player_game_features`;

  const gamePartitions = await listS3DataJsonlPartitions(s3, gamesRawPrefix);
  const logPartitions = await listS3DataJsonlPartitions(s3, logsRawPrefix);

  if (gamePartitions.length === 0) warnings.push('Missing raw games archives under existing_ingestion.');
  if (logPartitions.length === 0) warnings.push('Missing raw player_game_logs archives under existing_ingestion.');

  const gamesCount = await countS3RawRowsFromPartitions(s3, gamesRawPrefix, gamePartitions);
  const playerLogsCount = await countS3RawRowsFromPartitions(s3, logsRawPrefix, logPartitions);

  const curatedGamesCount =
    (await tryReadS3ManifestRecordCount(s3, `${curatedGamesPrefix}/_manifest.json`)) ?? 0;
  const curatedLogsCount =
    (await tryReadS3ManifestRecordCount(s3, `${curatedLogsPrefix}/_manifest.json`)) ?? 0;
  const featureRowsCount =
    (await tryReadS3ManifestRecordCount(s3, `${featuresPrefix}/_manifest.json`)) ?? 0;

  if (curatedGamesCount === 0) warnings.push('Missing curated games parquet manifest/rows.');
  if (curatedLogsCount === 0) warnings.push('Missing curated player_game_logs parquet manifest/rows.');
  if (featureRowsCount === 0) warnings.push('Missing feature-layer outputs for player_game_features.');

  const matchedOddsPrefixes = new Set<string>();
  const oddsCandidatePrefixes = [
    `${rawPrefix}/source=balldontlie/league=nba/season=${season}/entity=player_props`,
    `${rawPrefix}/source=balldontlie/league=nba/season=${season}/entity=odds`,
    `${rawPrefix}/source=odds_api/league=nba/season=${season}`,
    `${rawPrefix}/source=oddsapi/league=nba/season=${season}`,
    `${rawPrefix}/source=player_props/league=nba/season=${season}`,
  ];
  for (const prefix of oddsCandidatePrefixes) {
    for await (const obj of s3.listByPrefix(prefix)) {
      if (obj.key) {
        matchedOddsPrefixes.add(prefix);
        break;
      }
    }
  }
  if (matchedOddsPrefixes.size === 0) {
    warnings.push('Missing prop odds/lines archives for this season.');
  }

  return {
    season,
    storage: 's3',
    games_count: gamesCount,
    player_logs_count: playerLogsCount,
    game_partitions: gamePartitions.length,
    player_log_partitions: logPartitions.length,
    curated_games_count: curatedGamesCount,
    curated_logs_count: curatedLogsCount,
    feature_rows_count: featureRowsCount,
    missing_dates: {
      games: findMissingDates(gamePartitions),
      player_game_logs: findMissingDates(logPartitions),
    },
    prop_odds: {
      detected: matchedOddsPrefixes.size > 0,
      matched_prefixes: [...matchedOddsPrefixes].sort(),
    },
    warnings: uniqueWarnings(warnings),
  };
}

async function buildLocalSeasonCoverage(args: {
  localRoot: string;
  season: number;
}): Promise<SeasonCoverage> {
  const { localRoot, season } = args;
  const warnings: string[] = [];
  const rawBase = path.join(localRoot, 'raw', 'source=existing_ingestion', 'league=nba', `season=${season}`);
  const gamesRawPrefix = path.join(rawBase, 'entity=games');
  const logsRawPrefix = path.join(rawBase, 'entity=player_game_logs');
  const curatedGamesPrefix = path.join(
    localRoot,
    'curated',
    'league=nba',
    `season=${season}`,
    'entity=games'
  );
  const curatedLogsPrefix = path.join(
    localRoot,
    'curated',
    'league=nba',
    `season=${season}`,
    'entity=player_game_logs'
  );
  const featuresPrefix = path.join(
    localRoot,
    'features',
    'league=nba',
    `season=${season}`,
    'entity=player_game_features'
  );

  const gamePartitions = await listLocalJsonlPartitions(gamesRawPrefix);
  const logPartitions = await listLocalJsonlPartitions(logsRawPrefix);

  if (gamePartitions.length === 0) warnings.push('Missing raw games archives under existing_ingestion.');
  if (logPartitions.length === 0) warnings.push('Missing raw player_game_logs archives under existing_ingestion.');

  const gamesCount = await countLocalRawRowsFromPartitions(gamesRawPrefix, gamePartitions);
  const playerLogsCount = await countLocalRawRowsFromPartitions(logsRawPrefix, logPartitions);

  const curatedGamesCount =
    (await tryReadLocalManifestRecordCount(path.join(curatedGamesPrefix, '_manifest.json'))) ?? 0;
  const curatedLogsCount =
    (await tryReadLocalManifestRecordCount(path.join(curatedLogsPrefix, '_manifest.json'))) ?? 0;
  const featureRowsCount =
    (await tryReadLocalManifestRecordCount(path.join(featuresPrefix, '_manifest.json'))) ?? 0;

  if (curatedGamesCount === 0) warnings.push('Missing curated games parquet manifest/rows.');
  if (curatedLogsCount === 0) warnings.push('Missing curated player_game_logs parquet manifest/rows.');
  if (featureRowsCount === 0) warnings.push('Missing feature-layer outputs for player_game_features.');

  const propOddsCandidates = [
    path.join(localRoot, 'raw', 'source=balldontlie', 'league=nba', `season=${season}`, 'entity=player_props'),
    path.join(localRoot, 'raw', 'source=balldontlie', 'league=nba', `season=${season}`, 'entity=odds'),
    path.join(localRoot, 'raw', 'source=odds_api', 'league=nba', `season=${season}`),
    path.join(localRoot, 'raw', 'source=oddsapi', 'league=nba', `season=${season}`),
  ];
  const matchedOddsPrefixes = (
    await Promise.all(
      propOddsCandidates.map(async (candidate) => ((await existsLocal(candidate)) ? candidate : null))
    )
  ).filter((v): v is string => v !== null);

  if (matchedOddsPrefixes.length === 0) {
    warnings.push('Missing prop odds/lines archives for this season.');
  }

  return {
    season,
    storage: 'local',
    games_count: gamesCount,
    player_logs_count: playerLogsCount,
    game_partitions: gamePartitions.length,
    player_log_partitions: logPartitions.length,
    curated_games_count: curatedGamesCount,
    curated_logs_count: curatedLogsCount,
    feature_rows_count: featureRowsCount,
    missing_dates: {
      games: findMissingDates(gamePartitions),
      player_game_logs: findMissingDates(logPartitions),
    },
    prop_odds: {
      detected: matchedOddsPrefixes.length > 0,
      matched_prefixes: matchedOddsPrefixes,
    },
    warnings: uniqueWarnings(warnings),
  };
}

function buildMarkdownReport(report: CoverageReport): string {
  const lines: string[] = [];
  lines.push('# BallDontLie NBA Data Coverage Report');
  lines.push('');
  lines.push(`- Generated at: ${report.generated_at}`);
  lines.push(`- Storage mode: ${report.mode}`);
  if (report.bucket) lines.push(`- Bucket: \`${report.bucket}\``);
  if (report.local_root) lines.push(`- Local root: \`${report.local_root}\``);
  lines.push(`- Seasons: ${report.seasons.join(', ')}`);
  lines.push('');
  if (report.global_warnings.length > 0) {
    lines.push('## Global Warnings');
    for (const warning of report.global_warnings) lines.push(`- ${warning}`);
    lines.push('');
  }

  lines.push('## Season Coverage');
  lines.push('');
  for (const s of report.season_coverage) {
    lines.push(`### Season ${s.season}`);
    lines.push(`- games_count: ${s.games_count}`);
    lines.push(`- player_logs_count: ${s.player_logs_count}`);
    lines.push(`- game_partitions: ${s.game_partitions}`);
    lines.push(`- player_log_partitions: ${s.player_log_partitions}`);
    lines.push(`- curated_games_count: ${s.curated_games_count}`);
    lines.push(`- curated_logs_count: ${s.curated_logs_count}`);
    lines.push(`- feature_rows_count: ${s.feature_rows_count}`);
    lines.push(
      `- prop_odds_detected: ${s.prop_odds.detected ? 'yes' : 'no'}${
        s.prop_odds.matched_prefixes.length > 0
          ? ` (${s.prop_odds.matched_prefixes.map((p) => `\`${p}\``).join(', ')})`
          : ''
      }`
    );
    lines.push(
      `- missing_dates.games: ${
        s.missing_dates.games.length > 0 ? s.missing_dates.games.join(', ') : '(none detected)'
      }`
    );
    lines.push(
      `- missing_dates.player_game_logs: ${
        s.missing_dates.player_game_logs.length > 0
          ? s.missing_dates.player_game_logs.join(', ')
          : '(none detected)'
      }`
    );
    if (s.warnings.length > 0) {
      lines.push('- warnings:');
      for (const warning of s.warnings) lines.push(`  - ${warning}`);
    } else {
      lines.push('- warnings: (none)');
    }
    lines.push('');
  }

  lines.push('## Preservation Priority');
  lines.push('');
  lines.push('- Preserve missing raw archives first (games + player_game_logs) for any season with zero partitions.');
  lines.push('- Preserve prop odds/lines immediately if not detected, before API access expires.');
  lines.push('- Materialize curated and feature manifests after raw preservation to validate downstream completeness.');
  lines.push('');
  return lines.join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const outputJsonPath = path.join(args.outputDir, 'balldontlie-nba-coverage-report.json');
  const outputMdPath = path.join(args.outputDir, 'balldontlie-nba-coverage-report.md');

  const bucket = process.env.NBA_DATA_BUCKET?.trim() || null;
  const rawPrefix = compactKeyPrefix(process.env.NBA_RAW_PREFIX ?? 'raw');
  const localRootResolved = args.localRoot ? path.resolve(args.localRoot) : null;
  const localAvailable = localRootResolved ? await existsLocal(localRootResolved) : false;

  if (!bucket && !localAvailable) {
    fatal(
      'No storage configured. Set NBA_DATA_BUCKET (S3) or provide --local-root=<path> / NBA_DATA_LOCAL_ROOT.'
    );
  }

  const mode: StorageKind = bucket ? 's3' : 'local';
  const seasonCoverage: SeasonCoverage[] = [];
  const globalWarnings: string[] = [];

  if (mode === 's3') {
    const region = process.env.AWS_REGION?.trim() || 'us-east-1';
    const s3 = new S3Storage({ bucket: bucket!, region });
    for (const season of args.seasons) {
      console.log(`[audit] season=${season} via S3`);
      seasonCoverage.push(await buildS3SeasonCoverage({ s3, rawPrefix, season }));
    }
    if (localAvailable) {
      globalWarnings.push('Local root was provided but ignored because NBA_DATA_BUCKET is set (S3 mode).');
    }
  } else {
    for (const season of args.seasons) {
      console.log(`[audit] season=${season} via local filesystem`);
      seasonCoverage.push(await buildLocalSeasonCoverage({ localRoot: localRootResolved!, season }));
    }
  }

  await fs.mkdir(args.outputDir, { recursive: true });
  const report: CoverageReport = {
    generated_at: new Date().toISOString(),
    mode,
    bucket: mode === 's3' ? bucket! : undefined,
    local_root: mode === 'local' ? localRootResolved! : undefined,
    seasons: args.seasons,
    season_coverage: seasonCoverage,
    global_warnings: uniqueWarnings(globalWarnings),
  };

  await fs.writeFile(outputJsonPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  await fs.writeFile(outputMdPath, buildMarkdownReport(report), 'utf8');

  console.log(`[done] JSON report: ${outputJsonPath}`);
  console.log(`[done] Markdown report: ${outputMdPath}`);
}

main().catch((err) => {
  console.error('[fatal] unhandled error:', err);
  process.exit(1);
});
