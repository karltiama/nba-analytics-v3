/**
 * Slice 4: CLI runner for the RECENT_FORM_MINUTES backtesting strategy.
 *
 * Pipeline:
 *   1. Fetch player game logs from Postgres for the requested season window
 *      (season start through evaluationEndDate, so the strategy has lookback
 *      history for pre-window targets).
 *   2. Run the pure `evaluateRecentFormMinutes` strategy.
 *   3. Print the full uncapped summary.
 *   4. Write three artifacts to S3 under
 *        backtests/strategy=recent_form_minutes/run_id=<runId>/
 *      - config.json     resolved config + run metadata
 *      - summary.json    full uncapped summary (no 1000-cap)
 *      - signals.jsonl   one JSON object per line, full signal list
 *
 * Read-only against Postgres. Idempotent: with --overwrite=false (default) and
 * an explicit --run-id, repeated runs skip S3 keys that already exist.
 *
 * Usage:
 *   tsx scripts/backtesting/run-recent-form-minutes.ts \
 *     --season=2025 --start=2026-01-01 --end=2026-04-30 --stat=points
 *
 *   tsx scripts/backtesting/run-recent-form-minutes.ts \
 *     --season=2025 --start=2026-01-01 --end=2026-04-30 --stat=points \
 *     --min-prior-games=8 --min-minutes-l5=28 --recent-form-threshold=1.15 \
 *     --projection-weight-l10=0.7 --projection-weight-season=0.3
 *
 *   # Dry-run: still hits Postgres + runs strategy, but writes nothing to S3.
 *   tsx scripts/backtesting/run-recent-form-minutes.ts \
 *     --season=2025 --start=2026-01-01 --end=2026-04-30 --stat=points --dry-run
 *
 *   # Replay an existing run id, force-overwrite the artifacts.
 *   tsx scripts/backtesting/run-recent-form-minutes.ts \
 *     --season=2025 --start=2026-01-01 --end=2026-04-30 --stat=points \
 *     --run-id=00000000-0000-0000-0000-000000000001 --overwrite
 *
 * Required env: SUPABASE_DB_URL, NBA_DATA_BUCKET
 * Optional env: AWS_REGION (default us-east-1)
 *
 * Validation parity: --start/--end and projection-weight rules MUST match
 * `app/api/backtests/run/route.ts` so CLI and HTTP behave identically.
 */

import 'dotenv/config';
import { randomUUID } from 'crypto';
import dbPool from '@/lib/db';
import { S3Storage } from '@/lib/aws/s3';
import { fetchPlayerGameLogsForBacktest } from '@/lib/backtesting/repositories/postgres';
import { evaluateRecentFormMinutes } from '@/lib/backtesting/strategies/recent-form-minutes';
import type { BacktestResult, Stat } from '@/lib/backtesting/types';

const STRATEGY_PREFIX = 'backtests/strategy=recent_form_minutes';
const PROJECTION_WEIGHT_TOLERANCE = 0.0001;
const VALID_STATS: readonly Stat[] = ['points', 'rebounds', 'assists', 'threes', 'pra'];

type CliArgs = {
  season: number;
  evaluationStartDate: string;
  evaluationEndDate: string;
  stat: Stat;
  minPriorGames?: number;
  minMinutesL5?: number;
  recentFormThreshold?: number;
  projectionWeightL10?: number;
  projectionWeightSeason?: number;
  runId: string;
  dryRun: boolean;
  overwrite: boolean;
};

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

  const seasonRaw = flags['season'];
  if (typeof seasonRaw !== 'string' || !/^\d{4}$/.test(seasonRaw)) {
    fatal('Missing or invalid --season=<YYYY>. Example: --season=2025.');
  }

  const start = flags['start'];
  if (typeof start !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(start)) {
    fatal('Missing or invalid --start=<YYYY-MM-DD>.');
  }
  const end = flags['end'];
  if (typeof end !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    fatal('Missing or invalid --end=<YYYY-MM-DD>.');
  }
  if (start > end) fatal('--start must be <= --end.');

  const statRaw = flags['stat'];
  if (typeof statRaw !== 'string' || !(VALID_STATS as readonly string[]).includes(statRaw)) {
    fatal(`Missing or invalid --stat. Valid: ${VALID_STATS.join(', ')}.`);
  }

  function numFlag(name: string): number | undefined {
    const v = flags[name];
    if (v === undefined) return undefined;
    if (typeof v !== 'string') fatal(`--${name} requires a numeric value.`);
    const n = Number(v);
    if (!Number.isFinite(n)) fatal(`--${name} must be a finite number.`);
    return n;
  }

  const minPriorGames = numFlag('min-prior-games');
  const minMinutesL5 = numFlag('min-minutes-l5');
  const recentFormThreshold = numFlag('recent-form-threshold');
  const projectionWeightL10 = numFlag('projection-weight-l10');
  const projectionWeightSeason = numFlag('projection-weight-season');

  // Parity with app/api/backtests/run/route.ts: same defaults, same tolerance.
  const wL10 = projectionWeightL10 ?? 0.7;
  const wSeason = projectionWeightSeason ?? 0.3;
  if (Math.abs(wL10 + wSeason - 1) > PROJECTION_WEIGHT_TOLERANCE) {
    fatal(
      `--projection-weight-l10 + --projection-weight-season must be approximately 1 ` +
        `(tolerance ${PROJECTION_WEIGHT_TOLERANCE}); got ${wL10 + wSeason}.`
    );
  }

  if (
    minPriorGames !== undefined &&
    (!Number.isInteger(minPriorGames) || minPriorGames < 1)
  ) {
    fatal('--min-prior-games must be a positive integer.');
  }
  if (minMinutesL5 !== undefined && minMinutesL5 < 0) {
    fatal('--min-minutes-l5 must be non-negative.');
  }
  if (recentFormThreshold !== undefined && recentFormThreshold <= 0) {
    fatal('--recent-form-threshold must be > 0.');
  }
  if (projectionWeightL10 !== undefined && projectionWeightL10 < 0) {
    fatal('--projection-weight-l10 must be non-negative.');
  }
  if (projectionWeightSeason !== undefined && projectionWeightSeason < 0) {
    fatal('--projection-weight-season must be non-negative.');
  }

  const runIdRaw = flags['run-id'];
  const runId =
    typeof runIdRaw === 'string' && runIdRaw.length > 0 ? runIdRaw : randomUUID();

  return {
    season: Number(seasonRaw),
    evaluationStartDate: start,
    evaluationEndDate: end,
    stat: statRaw as Stat,
    minPriorGames,
    minMinutesL5,
    recentFormThreshold,
    projectionWeightL10,
    projectionWeightSeason,
    runId,
    dryRun: flags['dry-run'] === true,
    overwrite: flags['overwrite'] === true,
  };
}

function fmt(x: number): string {
  return x.toFixed(4);
}

function buildConfigArtifact(opts: {
  args: CliArgs;
  seasonStartDate: string;
  logsFetched: number;
  startedAt: string;
  completedAt: string;
  resolved: BacktestResult['config'];
}): Record<string, unknown> {
  const { args, seasonStartDate, logsFetched, startedAt, completedAt, resolved } = opts;
  return {
    schemaVersion: 1,
    runId: args.runId,
    strategy: 'RECENT_FORM_MINUTES',
    season: args.season,
    seasonStartDate,
    stat: args.stat,
    evaluationStartDate: args.evaluationStartDate,
    evaluationEndDate: args.evaluationEndDate,
    requestedFilters: {
      minPriorGames: args.minPriorGames ?? null,
      minMinutesL5: args.minMinutesL5 ?? null,
      recentFormThreshold: args.recentFormThreshold ?? null,
      projectionWeightL10: args.projectionWeightL10 ?? null,
      projectionWeightSeason: args.projectionWeightSeason ?? null,
    },
    resolvedConfig: resolved,
    logsFetched,
    startedAt,
    completedAt,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const bucket = requireEnv('NBA_DATA_BUCKET');
  const region = process.env.AWS_REGION?.trim() || 'us-east-1';

  const runPrefix = `${STRATEGY_PREFIX}/run_id=${args.runId}`;
  const configKey = `${runPrefix}/config.json`;
  const summaryKey = `${runPrefix}/summary.json`;
  const signalsKey = `${runPrefix}/signals.jsonl`;

  console.log('=== Backtest: RECENT_FORM_MINUTES ===');
  console.log(`  runId        : ${args.runId}`);
  console.log(`  season       : ${args.season}`);
  console.log(`  stat         : ${args.stat}`);
  console.log(`  eval window  : ${args.evaluationStartDate} -> ${args.evaluationEndDate}`);
  console.log(`  bucket       : s3://${bucket}/${runPrefix}/`);
  console.log(`  region       : ${region}`);
  console.log(`  dry-run      : ${args.dryRun}`);
  console.log(`  overwrite    : ${args.overwrite}`);

  const startedAt = new Date().toISOString();

  console.log('\n[1/3] Fetching logs from Postgres...');
  const repo = await fetchPlayerGameLogsForBacktest({
    season: args.season,
    evaluationEndDate: args.evaluationEndDate,
  });
  console.log(`      seasonStart   : ${repo.seasonStartDate}`);
  console.log(`      logsFetched   : ${repo.logs.length}`);

  console.log('\n[2/3] Running strategy...');
  const result = evaluateRecentFormMinutes(repo.logs, {
    stat: args.stat,
    evaluationStartDate: args.evaluationStartDate,
    evaluationEndDate: args.evaluationEndDate,
    minPriorGames: args.minPriorGames,
    minMinutesL5: args.minMinutesL5,
    recentFormThreshold: args.recentFormThreshold,
    projectionWeightL10: args.projectionWeightL10,
    projectionWeightSeason: args.projectionWeightSeason,
  });
  const completedAt = new Date().toISOString();

  const summary = result.summary;
  console.log(`      totalSignals  : ${summary.totalSignals}`);
  console.log(
    `      hit vs season : ${fmt(summary.hitRateVsSeasonAvg)}  ` +
      `(avg margin ${fmt(summary.averageMarginVsSeasonAvg)}, median ${fmt(summary.medianMarginVsSeasonAvg)})`
  );
  console.log(
    `      hit vs proj   : ${fmt(summary.hitRateVsProjection)}  ` +
      `(avg margin ${fmt(summary.averageMarginVsProjection)}, median ${fmt(summary.medianMarginVsProjection)})`
  );

  const configArtifact = buildConfigArtifact({
    args,
    seasonStartDate: repo.seasonStartDate,
    logsFetched: repo.logs.length,
    startedAt,
    completedAt,
    resolved: result.config,
  });

  const summaryArtifact = {
    schemaVersion: 1 as const,
    runId: args.runId,
    strategy: 'RECENT_FORM_MINUTES' as const,
    summary,
  };

  console.log('\n[3/3] Writing to S3...');
  if (args.dryRun) {
    console.log(`  [dry-run]       would write ${configKey}`);
    console.log(`  [dry-run]       would write ${summaryKey}`);
    console.log(`  [dry-run]       would write ${signalsKey}  (${result.signals.length} rows)`);
    console.log('\n[dry-run] no S3 objects were written.');
    return;
  }

  const s3 = new S3Storage({ bucket, region });

  const cfgRes = await s3.putJson(configKey, configArtifact, { overwrite: args.overwrite });
  console.log(`  ${cfgRes.written ? '[wrote]        ' : '[skip-existing] '}${configKey}`);

  const sumRes = await s3.putJson(summaryKey, summaryArtifact, { overwrite: args.overwrite });
  console.log(`  ${sumRes.written ? '[wrote]        ' : '[skip-existing] '}${summaryKey}`);

  const sigRes = await s3.putJsonLines(signalsKey, result.signals, {
    overwrite: args.overwrite,
  });
  console.log(
    `  ${sigRes.written ? '[wrote]        ' : '[skip-existing] '}${signalsKey}  ` +
      `(${sigRes.count ?? result.signals.length} rows)`
  );

  console.log('\nDone.');
}

main()
  .catch((err) => {
    console.error('[fatal] unhandled error:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await dbPool.end().catch(() => {});
  });
