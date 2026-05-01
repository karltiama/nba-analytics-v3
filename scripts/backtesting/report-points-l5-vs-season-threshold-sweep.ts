/**
 * Slice 11: Threshold sweep report — reads existing per-threshold summary JSON only.
 * Does not run backtests or single-season reports.
 *
 * Usage:
 *   npx tsx scripts/backtesting/report-points-l5-vs-season-threshold-sweep.ts --seasons=2023,2024 --thresholds=1,2,3,4,5
 *   npx tsx ... --overwrite
 *
 * Expects files from report-points-l5-vs-season-backtest.ts:
 *   backtests/reports/strategy=points_l5_vs_season_v1/threshold=<T>/summary-season=<S>.json
 *
 * Writes:
 *   backtests/reports/strategy=points_l5_vs_season_v1/threshold-sweep-seasons=<S1>-<S2>.json
 *   .../threshold-sweep-seasons=<S1>-<S2>.md
 *
 * Env: NBA_DATA_BUCKET, AWS credentials.
 */

import 'dotenv/config';
import { S3Client } from '@aws-sdk/client-s3';
import { S3Storage } from '@/lib/aws/s3';
import { canonicalizeJson } from '@/lib/backtesting/build-backtest-report';
import {
  buildThresholdSweepReport,
  formatThresholdSweepMarkdown,
} from '@/lib/backtesting/build-threshold-sweep-report';
import type { BacktestReportSummary } from '@/lib/backtesting/backtest-report-types';
import type {
  ThresholdSweepConfig,
  ThresholdSweepFilePayload,
} from '@/lib/backtesting/backtest-threshold-sweep-types';

const STRATEGY_FOLDER = 'points_l5_vs_season_v1';

type CliArgs = {
  seasons: number[];
  thresholds: number[];
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

  const seasonsRaw = flags['seasons'];
  if (typeof seasonsRaw !== 'string' || !seasonsRaw.trim()) {
    fatal('Required --seasons=Y1,Y2,... (comma-separated years).');
  }
  const seasons = [...new Set(seasonsRaw.split(',').map((s) => Number(s.trim())))]
    .filter((n) => Number.isFinite(n) && n >= 1900)
    .sort((a, b) => a - b);
  if (seasons.length === 0) fatal('Invalid --seasons= (no valid years).');

  const thrRaw = flags['thresholds'];
  if (typeof thrRaw !== 'string' || !thrRaw.trim()) {
    fatal('Required --thresholds=1,2,3,... (comma-separated numbers).');
  }
  const thresholds = [...new Set(thrRaw.split(',').map((s) => Number(s.trim())))]
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  if (thresholds.length === 0) fatal('Invalid --thresholds= (no valid numbers).');

  return {
    seasons,
    thresholds,
    overwrite: flags['overwrite'] === true,
  };
}

function reportsStrategyRoot(): string {
  return `backtests/reports/strategy=${STRATEGY_FOLDER}`;
}

function summaryKey(threshold: number, season: number): string {
  return `${reportsStrategyRoot()}/threshold=${threshold}/summary-season=${season}.json`;
}

function isReportPayload(x: unknown): x is { summary: BacktestReportSummary } {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return o.summary != null && typeof o.summary === 'object';
}

function formatMissingInstructions(season: number, threshold: number, bucket: string): string {
  return (
    `  season=${season} threshold=${threshold}: s3://${bucket}/${summaryKey(threshold, season)}\n` +
    `    1) npm run backtest:points-l5-vs-season -- --season=${season} --threshold=${threshold}\n` +
    `    2) npm run report:backtest:points-l5-vs-season -- --season=${season} --threshold=${threshold}`
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const bucket = requireEnv('NBA_DATA_BUCKET');
  const region = process.env.AWS_REGION?.trim() || 'us-east-1';
  const s3 = new S3Storage({ bucket, client: new S3Client({ region }) });

  const missing: string[] = [];
  const summaries: { threshold: number; summary: BacktestReportSummary }[] = [];

  for (const threshold of args.thresholds) {
    for (const season of args.seasons) {
      const key = summaryKey(threshold, season);
      const raw = await s3.getJson<unknown>(key);
      if (!isReportPayload(raw)) {
        missing.push(formatMissingInstructions(season, threshold, bucket));
        continue;
      }
      const sum = raw.summary;
      if (sum.season !== season) {
        missing.push(
          `  season=${season} threshold=${threshold}: summary.season=${sum.season} (file ${key})`
        );
        continue;
      }
      if (sum.threshold !== threshold) {
        missing.push(
          `  season=${season} threshold=${threshold}: summary.threshold=${sum.threshold} (file ${key})`
        );
        continue;
      }
      summaries.push({ threshold, summary: sum });
    }
  }

  if (missing.length > 0) {
    console.error('[fatal] Missing or invalid threshold sweep inputs:\n');
    for (const m of missing) console.error(m + '\n');
    process.exit(1);
  }

  const strategyName = summaries[0].summary.strategyName;
  const strategyVersion = summaries[0].summary.strategyVersion;
  const config: ThresholdSweepConfig = {
    strategyName,
    strategyVersion,
    seasons: args.seasons,
    thresholds: args.thresholds,
  };

  const sweep = buildThresholdSweepReport({ config, summaries });
  const tag = args.seasons.join('-');
  const jsonKey = `${reportsStrategyRoot()}/threshold-sweep-seasons=${tag}.json`;
  const mdKey = `${reportsStrategyRoot()}/threshold-sweep-seasons=${tag}.md`;

  const generatedAt = new Date().toISOString();
  const payload: ThresholdSweepFilePayload = {
    generatedAt,
    reportVersion: 1,
    sweep,
  };
  const jsonBody = JSON.stringify(canonicalizeJson(payload), null, 2) + '\n';

  const jw = await s3.putText(jsonKey, jsonBody, {
    overwrite: args.overwrite,
    contentType: 'application/json; charset=utf-8',
  });
  const mw = await s3.putText(mdKey, formatThresholdSweepMarkdown(sweep), {
    overwrite: args.overwrite,
    contentType: 'text/markdown; charset=utf-8',
  });
  console.error(
    `[ok] threshold sweep: json ${jw.written ? 'written' : 'skipped (' + jw.reason + ')'}, md ${mw.written ? 'written' : 'skipped (' + mw.reason + ')'}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
