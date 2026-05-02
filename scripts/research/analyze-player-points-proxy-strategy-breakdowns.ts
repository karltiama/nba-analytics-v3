import 'dotenv/config';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import duckdb from '@duckdb/node-api';
import { S3Storage } from '@/lib/aws/s3';
import { buildProxyTarget } from '@/lib/research/feature-ranking';
import {
  assessStrategyNarrative,
  buildStrategyBreakdownBundle,
  isValidProxyStrategyName,
  renderProxyStrategyBreakdownMarkdownReport,
  type BreakdownInputRow,
  type ComparisonLeaderRow,
} from '@/lib/research/proxy-strategy-breakdowns';
import { enrichProxySweepRow, strategySignal, type ProxyStrategyName } from '@/lib/research/proxy-strategy-sweep';
import type { ComparedStrategy } from '@/lib/research/proxy-strategy-comparison';

type CliArgs = {
  seasons: number[];
  strategies: ProxyStrategyName[];
  dryRun: boolean;
};

const DEFAULT_SEASONS = [2023, 2024, 2025];
const DEFAULT_STRATEGIES: ProxyStrategyName[] = [
  'strong_recent_role_change_v1',
  'points_trend_minutes_trend_v1',
  'points_trend_minutes_floor_v1',
];

const REQUIRED_COLUMNS = [
  'actual_points',
  'points_season_avg_before_game',
  'prior_games',
  'points_l5_avg_before_game',
  'minutes_l5_avg_before_game',
  'minutes_l10_avg_before_game',
  'player_id',
] as const;

const OPTIONAL_COLUMNS = ['points_l5_minus_season_avg', 'minutes_l5_minus_l10_avg'] as const;

function fatal(msg: string): never {
  console.error(`[fatal] ${msg}`);
  process.exit(1);
}

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) fatal(`Missing required env var: ${name}`);
  return v;
}

function parseArgs(argv: string[]): CliArgs {
  const flags: Record<string, string | boolean> = {};
  for (const raw of argv) {
    if (!raw.startsWith('--')) continue;
    const eq = raw.indexOf('=');
    if (eq === -1) flags[raw.slice(2)] = true;
    else flags[raw.slice(2, eq)] = raw.slice(eq + 1);
  }

  let seasonsRaw =
    typeof flags.seasons === 'string'
      ? flags.seasons
      : typeof process.env.npm_config_seasons === 'string'
        ? process.env.npm_config_seasons
        : DEFAULT_SEASONS.join(',');
  let seasons = [...new Set(seasonsRaw.split(',').map((s) => Number(s.trim())))]
    .filter((n) => Number.isFinite(n) && n >= 1900 && n <= 3000)
    .sort((a, b) => a - b);
  if (seasons.length === 0) {
    seasons = DEFAULT_SEASONS;
    console.warn(`[warn] Could not parse --seasons; defaulting to ${DEFAULT_SEASONS.join(',')}.`);
  }

  let strategiesRaw =
    typeof flags.strategies === 'string'
      ? flags.strategies
      : typeof process.env.npm_config_strategies === 'string'
        ? process.env.npm_config_strategies
        : DEFAULT_STRATEGIES.join(',');
  const strategyTokens = [...new Set(strategiesRaw.split(',').map((s) => s.trim()).filter(Boolean))];
  const strategies = strategyTokens.filter((s): s is ProxyStrategyName => isValidProxyStrategyName(s));
  if (strategies.length === 0) {
    fatal(
      `No valid strategy names. Use --strategies=${DEFAULT_STRATEGIES.join(',')}. Valid: ${DEFAULT_STRATEGIES.join(', ')}`
    );
  }

  const dryRunFromNpmConfig =
    process.env.npm_config_dry_run === 'true' || process.env.npm_config_dryrun === 'true';
  return {
    seasons,
    strategies,
    dryRun: flags['dry-run'] === true || dryRunFromNpmConfig,
  };
}

function featureInputPrefix(season: number): string {
  return `features/league=nba/season=${season}/entity=player_game_features`;
}

function comparisonResultsKey(seasons: number[]): string {
  const tag = [...seasons].sort((a, b) => a - b).join('-');
  return `research/strategy-sweeps/league=nba/target=score_above_season_avg/comparison/seasons=${tag}/results.json`;
}

function breakdownOutputPrefix(seasons: number[]): string {
  const tag = [...seasons].sort((a, b) => a - b).join('-');
  return `research/strategy-sweeps/league=nba/target=score_above_season_avg/comparison/seasons=${tag}/breakdowns`;
}

async function downloadFeatureParquets(args: {
  s3: S3Storage;
  s3Client: S3Client;
  bucket: string;
  sourcePrefix: string;
  targetDir: string;
}): Promise<string[]> {
  const { s3, s3Client, bucket, sourcePrefix, targetDir } = args;
  const localPaths: string[] = [];
  for await (const obj of s3.listByPrefix(sourcePrefix)) {
    const m = obj.key.match(/\/dt=(\d{4}-\d{2}-\d{2})\/data\.parquet$/);
    if (!m) continue;
    const local = path.join(targetDir, `dt=${m[1]}.parquet`);
    const got = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: obj.key }));
    if (!got.Body) continue;
    const bytes = Buffer.from(await got.Body.transformToByteArray());
    await fs.writeFile(local, bytes);
    localPaths.push(local);
  }
  return localPaths.sort();
}

async function listParquetColumns(parquetPaths: string[]): Promise<Set<string>> {
  if (parquetPaths.length === 0) return new Set();
  const quotedList = parquetPaths
    .map((p) => `'${p.replace(/\\/g, '/').replace(/'/g, "''")}'`)
    .join(', ');
  const instance = await duckdb.DuckDBInstance.create(':memory:');
  const conn = await instance.connect();
  try {
    const reader = await conn.runAndReadAll(`SELECT * FROM read_parquet([${quotedList}]) LIMIT 0`);
    return new Set(reader.columnNames().map((n) => String(n)));
  } finally {
    conn.closeSync();
    instance.closeSync();
  }
}

function selectClause(col: string): string {
  if (col === 'player_id') {
    return `CAST(${col} AS VARCHAR) AS ${col}`;
  }
  return `TRY_CAST(${col} AS DOUBLE) AS ${col}`;
}

async function loadRows(parquetPaths: string[], availableColumns: Set<string>): Promise<Record<string, unknown>[]> {
  if (parquetPaths.length === 0) return [];
  const quotedList = parquetPaths
    .map((p) => `'${p.replace(/\\/g, '/').replace(/'/g, "''")}'`)
    .join(', ');
  const projection = [
    ...REQUIRED_COLUMNS.map((c) => selectClause(c)),
    ...OPTIONAL_COLUMNS.filter((c) => availableColumns.has(c)).map(selectClause),
  ].join(',\n        ');

  const instance = await duckdb.DuckDBInstance.create(':memory:');
  const conn = await instance.connect();
  try {
    const reader = await conn.runAndReadAll(`
      SELECT
        ${projection}
      FROM read_parquet([${quotedList}])
    `);
    return (await reader.getRowObjectsJS()) as Record<string, unknown>[];
  } finally {
    conn.closeSync();
    instance.closeSync();
  }
}

function safePlayerId(v: unknown): string {
  if (v == null) return '_unknown';
  const s = String(v).trim();
  return s.length ? s : '_unknown';
}

function parseComparisonLeaderboard(text: string | null): ComparisonLeaderRow[] {
  if (text == null) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return [];
  }
  if (!raw || typeof raw !== 'object') return [];
  const rec = raw as Record<string, unknown>;
  const arr = rec.strategy_summary;
  if (!Array.isArray(arr)) return [];
  return (arr as ComparedStrategy[]).map((s) => ({
    rank: s.rank,
    strategy_name: s.strategy_name,
    weighted_hit_rate: s.weighted_hit_rate,
    total_signal_count: s.total_signal_count,
  }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const bucket = requireEnv('NBA_DATA_BUCKET');
  const region = process.env.AWS_REGION?.trim() || 'us-east-1';
  const s3Client = new S3Client({ region });
  const s3 = new S3Storage({ bucket, client: s3Client });

  const outPrefix = breakdownOutputPrefix(args.seasons);
  const jsonKey = `${outPrefix}/results.json`;
  const mdKey = `${outPrefix}/report.md`;
  const comparisonKey = comparisonResultsKey(args.seasons);

  console.log(`seasons=${args.seasons.join(',')}`);
  console.log(`strategies=${args.strategies.join(',')}`);
  console.log(`comparison_input=s3://${bucket}/${comparisonKey}`);
  console.log(`output_json=s3://${bucket}/${jsonKey}`);
  console.log(`output_md=s3://${bucket}/${mdKey}`);

  const allRows: BreakdownInputRow[] = [];
  const inputPaths: string[] = [];

  for (const season of args.seasons) {
    const input = featureInputPrefix(season);
    inputPaths.push(`s3://${bucket}/${input}/`);
    const tmpDir = path.join(os.tmpdir(), `proxy-breakdown-${season}-${randomUUID()}`);
    await fs.mkdir(tmpDir, { recursive: true });
    const parquetPaths = await downloadFeatureParquets({
      s3,
      s3Client,
      bucket,
      sourcePrefix: input,
      targetDir: tmpDir,
    });
    if (parquetPaths.length === 0) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      fatal(`No feature parquet files under s3://${bucket}/${input}/`);
    }
    const columns = await listParquetColumns(parquetPaths);
    const reallyMissing = REQUIRED_COLUMNS.filter((c) => !columns.has(c));
    if (reallyMissing.length > 0) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      fatal(`Season ${season}: missing columns: ${reallyMissing.join(', ')}`);
    }

    const rawRows = await loadRows(parquetPaths, columns);
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});

    for (const raw of rawRows) {
      const enriched = enrichProxySweepRow(raw);
      if (enriched.actual_points == null || enriched.points_season_avg_before_game == null) continue;
      const target = buildProxyTarget({
        actual_points: enriched.actual_points,
        points_season_avg_before_game: enriched.points_season_avg_before_game,
      });
      if (target == null) continue;

      const signals: Partial<Record<ProxyStrategyName, boolean>> = {};
      for (const st of args.strategies) {
        signals[st] = strategySignal(st, enriched);
      }

      allRows.push({
        season,
        player_id: safePlayerId(raw.player_id),
        prior_games: enriched.prior_games,
        minutes_l5_avg_before_game: enriched.minutes_l5_avg_before_game,
        points_season_avg_before_game: enriched.points_season_avg_before_game,
        target_true: target,
        signals,
      });
    }
  }

  const comparisonText = await s3.getText(comparisonKey);
  const leaderboardRecap = parseComparisonLeaderboard(comparisonText).filter((r) =>
    args.strategies.includes(r.strategy_name as ProxyStrategyName)
  );

  const bundles = args.strategies.map((st) => buildStrategyBreakdownBundle({ rows: allRows, strategy: st }));
  const narratives = bundles.map((b) => assessStrategyNarrative(b));

  const targetDefinition = 'actual_points > points_season_avg_before_game';
  const generatedAt = new Date().toISOString();

  const executiveBullets = bundles.map((b) => {
    const n = narratives.find((x) => x.strategy_name === b.strategy_name);
    const sharePct = (b.concentration.top_k_signal_share * 100).toFixed(1);
    const role = b.strategy_name === 'strong_recent_role_change_v1' ? ' **(focus strategy)**' : '';
    return `**${b.strategy_name}**${role}: signals=${b.total_signals}, overall hit=${((b.overall_hit_rate ?? 0) * 100).toFixed(2)}%, top-${b.concentration.k_used} player signal share=${sharePct}%, narrative=**${n?.label ?? 'n/a'}** — ${n?.reasons.join(' ') ?? ''}`;
  });

  const payload = {
    seasons: args.seasons,
    strategies: args.strategies,
    target_definition: targetDefinition,
    generated_at: generatedAt,
    input_paths: inputPaths,
    comparison_results_key: `s3://${bucket}/${comparisonKey}`,
    output_path: `s3://${bucket}/${outPrefix}/`,
    total_rows_loaded: allRows.length,
    comparison_leaderboard_recap: leaderboardRecap,
    strategies_breakdown: bundles,
    narratives,
  };

  const markdown = renderProxyStrategyBreakdownMarkdownReport({
    seasons: args.seasons,
    strategies: args.strategies,
    generatedAt,
    inputPaths: [...inputPaths, `s3://${bucket}/${comparisonKey}`],
    outputPath: payload.output_path,
    targetDefinition,
    leaderboardRecap,
    bundles,
    narratives,
    executiveBullets,
  });

  if (args.dryRun) {
    console.log('[dry-run] no files were written.');
    console.log(
      JSON.stringify(
        {
          total_rows_loaded: allRows.length,
          strategies: args.strategies,
          per_strategy_signals: bundles.map((b) => ({
            strategy_name: b.strategy_name,
            total_signals: b.total_signals,
            top_k_share: b.concentration.top_k_signal_share,
          })),
        },
        null,
        2
      )
    );
    return;
  }

  await s3.putText(jsonKey, JSON.stringify(payload, null, 2) + '\n', {
    overwrite: true,
    contentType: 'application/json; charset=utf-8',
  });
  await s3.putText(mdKey, markdown, {
    overwrite: true,
    contentType: 'text/markdown; charset=utf-8',
  });
  console.log(`[ok] wrote s3://${bucket}/${jsonKey}`);
  console.log(`[ok] wrote s3://${bucket}/${mdKey}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
