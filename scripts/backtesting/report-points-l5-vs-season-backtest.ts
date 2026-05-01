/**
 * Slice 10 + 11: Read Slice 9 backtest outputs from S3 and write summary JSON + Markdown.
 * Does not re-run strategy logic.
 *
 * Reads threshold-specific outputs:
 *   backtests/.../strategy=points_l5_vs_season_v1/threshold=<T>/...
 * For threshold=3 only, falls back to legacy flat path (no threshold= segment) if present.
 *
 * Writes reports under:
 *   backtests/reports/strategy=points_l5_vs_season_v1/threshold=<T>/...
 *
 * Usage:
 *   npx tsx scripts/backtesting/report-points-l5-vs-season-backtest.ts --season=2023
 *   npx tsx scripts/backtesting/report-points-l5-vs-season-backtest.ts --seasons=2023,2024
 *   npx tsx scripts/backtesting/report-points-l5-vs-season-backtest.ts --season=2023 --threshold=5
 *
 * Default --threshold is 3 when omitted.
 *
 * Env: NBA_DATA_BUCKET, AWS credentials.
 */

import 'dotenv/config';
import { S3Client } from '@aws-sdk/client-s3';
import { S3Storage } from '@/lib/aws/s3';
import type { BacktestManifest } from '@/lib/backtesting/backtest-types';
import {
  buildBacktestReport,
  buildSeasonComparison,
  canonicalizeJson,
  formatBacktestReportMarkdown,
  formatSeasonComparisonMarkdown,
  parseBacktestResultLines,
} from '@/lib/backtesting/build-backtest-report';
import type {
  BacktestComparisonFilePayload,
  BacktestReportFilePayload,
} from '@/lib/backtesting/backtest-report-types';

const STRATEGY_FOLDER = 'points_l5_vs_season_v1';
const DEFAULT_THRESHOLD = 3;

type CliArgs = {
  seasons: number[];
  /** Resolved threshold for paths and manifest validation. */
  threshold: number;
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
  const seasonRaw = flags['season'];

  let seasons: number[] = [];
  if (typeof seasonsRaw === 'string' && seasonsRaw.trim().length > 0) {
    seasons = [...new Set(seasonsRaw.split(',').map((s) => Number(s.trim())))]
      .filter((n) => Number.isFinite(n) && n >= 1900)
      .sort((a, b) => a - b);
    if (seasons.length === 0) fatal('Invalid --seasons= (expected comma-separated years, e.g. 2023,2024).');
  } else if (typeof seasonRaw === 'string' && /^\d{4}$/.test(seasonRaw)) {
    seasons = [Number(seasonRaw)];
  } else {
    fatal('Provide --season=YYYY or --seasons=Y1,Y2,...');
  }

  const th = flags['threshold'];
  let thresholdRaw = DEFAULT_THRESHOLD;
  if (typeof th === 'string' && th.length > 0) {
    const n = Number(th);
    if (!Number.isFinite(n)) fatal('Invalid --threshold.');
    thresholdRaw = n;
  } else if (typeof th === 'number' && Number.isFinite(th)) {
    thresholdRaw = th;
  }

  return {
    seasons,
    threshold: thresholdRaw,
    overwrite: flags['overwrite'] === true,
  };
}

function backtestThresholdPrefix(season: number, threshold: number): string {
  return `backtests/league=nba/season=${season}/strategy=${STRATEGY_FOLDER}/threshold=${threshold}`;
}

/** Pre–Slice 11 layout (supported when threshold is 3). */
function legacyBacktestPrefix(season: number): string {
  return `backtests/league=nba/season=${season}/strategy=${STRATEGY_FOLDER}`;
}

function reportsPrefix(threshold: number): string {
  return `backtests/reports/strategy=${STRATEGY_FOLDER}/threshold=${threshold}`;
}

function isManifest(x: unknown): x is BacktestManifest {
  if (!x || typeof x !== 'object') return false;
  const m = x as Record<string, unknown>;
  return (
    typeof m.strategyName === 'string' &&
    typeof m.strategyVersion === 'string' &&
    typeof m.season === 'number' &&
    typeof m.signalsGenerated === 'number' &&
    typeof m.rowsScanned === 'number' &&
    m.skippedReasons != null &&
    typeof m.skippedReasons === 'object'
  );
}

async function loadSeasonArtifacts(
  s3: S3Storage,
  season: number,
  expectedThreshold: number
): Promise<{ manifest: BacktestManifest; resultsText: string }> {
  const scopedPrefix = backtestThresholdPrefix(season, expectedThreshold);
  let manifestKey = `${scopedPrefix}/_manifest.json`;
  let resultsKey = `${scopedPrefix}/results.jsonl`;

  let manifestRaw = await s3.getJson<unknown>(manifestKey);
  if (!isManifest(manifestRaw) && expectedThreshold === 3) {
    const leg = legacyBacktestPrefix(season);
    const legManifestKey = `${leg}/_manifest.json`;
    const legResultsKey = `${leg}/results.jsonl`;
    const legManifest = await s3.getJson<unknown>(legManifestKey);
    if (isManifest(legManifest)) {
      manifestRaw = legManifest;
      manifestKey = legManifestKey;
      resultsKey = legResultsKey;
    }
  }

  if (!isManifest(manifestRaw)) {
    fatal(
      `Missing or invalid manifest for season=${season} threshold=${expectedThreshold}. ` +
        `Tried s3://${s3.bucket}/${scopedPrefix}/ and (if threshold=3) legacy s3://${s3.bucket}/${legacyBacktestPrefix(season)}/`
    );
  }
  if (manifestRaw.season !== season) {
    fatal(`Manifest season ${manifestRaw.season} does not match requested ${season}.`);
  }
  if (manifestRaw.threshold !== expectedThreshold) {
    fatal(
      `Manifest threshold ${manifestRaw.threshold} does not match expected ${expectedThreshold} (from --threshold or default 3).`
    );
  }

  const resultsText = await s3.getText(resultsKey);
  if (resultsText == null) fatal(`Missing results: s3://${s3.bucket}/${resultsKey}`);

  return { manifest: manifestRaw, resultsText };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const bucket = requireEnv('NBA_DATA_BUCKET');
  const region = process.env.AWS_REGION?.trim() || 'us-east-1';
  const s3 = new S3Storage({ bucket, client: new S3Client({ region }) });
  const th = args.threshold;

  const summaries = [];
  for (const season of args.seasons) {
    const { manifest, resultsText } = await loadSeasonArtifacts(s3, season, th);
    const results = parseBacktestResultLines(resultsText);
    const summary = buildBacktestReport({ manifest, results });
    summaries.push(summary);

    const reportBase = reportsPrefix(th);
    const jsonKey = `${reportBase}/summary-season=${season}.json`;
    const mdKey = `${reportBase}/summary-season=${season}.md`;
    const generatedAt = new Date().toISOString();
    const jsonPayload: BacktestReportFilePayload = {
      generatedAt,
      reportVersion: 1,
      summary,
    };
    const jsonBody = JSON.stringify(canonicalizeJson(jsonPayload), null, 2) + '\n';
    const jw = await s3.putText(jsonKey, jsonBody, {
      overwrite: args.overwrite,
      contentType: 'application/json; charset=utf-8',
    });
    const mw = await s3.putText(mdKey, formatBacktestReportMarkdown(summary), {
      overwrite: args.overwrite,
      contentType: 'text/markdown; charset=utf-8',
    });
    console.error(
      `[ok] season ${season} threshold=${th}: json ${jw.written ? 'written' : 'skipped (' + jw.reason + ')'}, md ${mw.written ? 'written' : 'skipped (' + mw.reason + ')'}`
    );
  }

  if (args.seasons.length >= 2) {
    const comparison = buildSeasonComparison(summaries);
    const tag = args.seasons.join('-');
    const reportBase = reportsPrefix(th);
    const cmpJsonKey = `${reportBase}/comparison-seasons=${tag}.json`;
    const cmpMdKey = `${reportBase}/comparison-seasons=${tag}.md`;
    const generatedAt = new Date().toISOString();
    const cmpPayload: BacktestComparisonFilePayload = {
      generatedAt,
      reportVersion: 1,
      comparison,
    };
    const cmpJsonBody = JSON.stringify(canonicalizeJson(cmpPayload), null, 2) + '\n';
    const cj = await s3.putText(cmpJsonKey, cmpJsonBody, {
      overwrite: args.overwrite,
      contentType: 'application/json; charset=utf-8',
    });
    const cm = await s3.putText(cmpMdKey, formatSeasonComparisonMarkdown(comparison), {
      overwrite: args.overwrite,
      contentType: 'text/markdown; charset=utf-8',
    });
    console.error(
      `[ok] comparison threshold=${th}: json ${cj.written ? 'written' : 'skipped (' + cj.reason + ')'}, md ${cm.written ? 'written' : 'skipped (' + cm.reason + ')'}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
