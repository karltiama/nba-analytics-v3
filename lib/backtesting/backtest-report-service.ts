/**
 * Slice 12A: server-side read of pre-generated backtest report JSON from S3.
 * No strategy or report recomputation — read-only.
 */

import { S3Client } from '@aws-sdk/client-s3';
import { S3Storage } from '@/lib/aws/s3';
import type {
  BacktestComparisonFilePayload,
  BacktestReportFilePayload,
  BacktestReportSummary,
  BacktestSeasonComparison,
} from '@/lib/backtesting/backtest-report-types';
import type {
  ThresholdSweepFilePayload,
  ThresholdSweepReport,
} from '@/lib/backtesting/backtest-threshold-sweep-types';

export const POINTS_L5_VS_SEASON_STRATEGY_FOLDER = 'points_l5_vs_season_v1';

export type BacktestReportServiceErrorCode =
  | 'NOT_CONFIGURED'
  | 'NOT_FOUND'
  | 'INVALID_JSON'
  | 'BAD_REQUEST';

export type BacktestReportServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: BacktestReportServiceErrorCode; message: string };

function reportsRoot(): string {
  return `backtests/reports/strategy=${POINTS_L5_VS_SEASON_STRATEGY_FOLDER}`;
}

/** S3 object key for single-season summary JSON (Slice 10/11). */
export function summaryReportS3Key(threshold: number, season: number): string {
  return `${reportsRoot()}/threshold=${threshold}/summary-season=${season}.json`;
}

/**
 * Pre–Slice 11 layout: summaries lived next to strategy root (implicit threshold 3).
 * Still supported for reads when `threshold === 3`.
 */
export function legacySummaryReportS3Key(season: number): string {
  return `${reportsRoot()}/summary-season=${season}.json`;
}

/** S3 object key for multi-season comparison at a fixed threshold. */
export function comparisonReportS3Key(threshold: number, seasons: readonly number[]): string {
  const tag = [...seasons].sort((a, b) => a - b).join('-');
  return `${reportsRoot()}/threshold=${threshold}/comparison-seasons=${tag}.json`;
}

/** Pre–Slice 11 comparison JSON (implicit threshold 3). */
export function legacyComparisonReportS3Key(seasons: readonly number[]): string {
  const tag = [...seasons].sort((a, b) => a - b).join('-');
  return `${reportsRoot()}/comparison-seasons=${tag}.json`;
}

/** S3 object key for threshold sweep (seasons tag only; thresholds live inside JSON). */
export function thresholdSweepReportS3Key(seasons: readonly number[]): string {
  const tag = [...seasons].sort((a, b) => a - b).join('-');
  return `${reportsRoot()}/threshold-sweep-seasons=${tag}.json`;
}

function getBucket(): string | null {
  const b = process.env.NBA_DATA_BUCKET?.trim();
  return b && b.length > 0 ? b : null;
}

function getS3(): S3Storage | null {
  const bucket = getBucket();
  if (!bucket) return null;
  const region = process.env.AWS_REGION?.trim() || 'us-east-1';
  return new S3Storage({ bucket, client: new S3Client({ region }) });
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return x != null && typeof x === 'object' && !Array.isArray(x);
}

/** Light validation of stored summary file shape. */
export function parseBacktestSummaryPayload(
  raw: unknown
): BacktestReportServiceResult<{ generatedAt: string; summary: BacktestReportSummary }> {
  if (!isRecord(raw)) return { ok: false, code: 'INVALID_JSON', message: 'Report root is not an object.' };
  const gen = raw.generatedAt;
  const sum = raw.summary;
  if (typeof gen !== 'string' || !gen) {
    return { ok: false, code: 'INVALID_JSON', message: 'Missing generatedAt string.' };
  }
  if (!isRecord(sum)) return { ok: false, code: 'INVALID_JSON', message: 'Missing summary object.' };
  if (typeof sum.season !== 'number' || typeof sum.signalsGenerated !== 'number') {
    return { ok: false, code: 'INVALID_JSON', message: 'Summary missing season or signalsGenerated.' };
  }
  if (typeof sum.threshold !== 'number') {
    return { ok: false, code: 'INVALID_JSON', message: 'Summary missing threshold.' };
  }
  return { ok: true, data: { generatedAt: gen, summary: sum as BacktestReportSummary } };
}

export function parseBacktestComparisonPayload(
  raw: unknown
): BacktestReportServiceResult<{ generatedAt: string; comparison: BacktestSeasonComparison }> {
  if (!isRecord(raw)) return { ok: false, code: 'INVALID_JSON', message: 'Report root is not an object.' };
  const gen = raw.generatedAt;
  const comp = raw.comparison;
  if (typeof gen !== 'string' || !gen) {
    return { ok: false, code: 'INVALID_JSON', message: 'Missing generatedAt string.' };
  }
  if (!isRecord(comp)) return { ok: false, code: 'INVALID_JSON', message: 'Missing comparison object.' };
  if (!Array.isArray(comp.seasons) || !Array.isArray(comp.perSeason)) {
    return { ok: false, code: 'INVALID_JSON', message: 'Comparison missing seasons or perSeason.' };
  }
  return { ok: true, data: { generatedAt: gen, comparison: comp as BacktestSeasonComparison } };
}

export function parseThresholdSweepPayload(
  raw: unknown
): BacktestReportServiceResult<{ generatedAt: string; sweep: ThresholdSweepReport }> {
  if (!isRecord(raw)) return { ok: false, code: 'INVALID_JSON', message: 'Report root is not an object.' };
  const gen = raw.generatedAt;
  const sweep = raw.sweep;
  if (typeof gen !== 'string' || !gen) {
    return { ok: false, code: 'INVALID_JSON', message: 'Missing generatedAt string.' };
  }
  if (!isRecord(sweep)) return { ok: false, code: 'INVALID_JSON', message: 'Missing sweep object.' };
  if (!Array.isArray(sweep.rows)) {
    return { ok: false, code: 'INVALID_JSON', message: 'Sweep missing rows array.' };
  }
  return { ok: true, data: { generatedAt: gen, sweep: sweep as ThresholdSweepReport } };
}

async function readJsonKey(key: string): Promise<BacktestReportServiceResult<unknown>> {
  const s3 = getS3();
  if (!s3) {
    return {
      ok: false,
      code: 'NOT_CONFIGURED',
      message:
        'NBA_DATA_BUCKET is not set. Configure the bucket on the server to load backtest reports from S3.',
    };
  }
  const text = await s3.getText(key);
  if (text == null) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: `Report not found at s3://${s3.bucket}/${key}`,
    };
  }
  try {
    return { ok: true, data: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, code: 'INVALID_JSON', message: `Invalid JSON at s3://${s3.bucket}/${key}` };
  }
}

/** Try primary S3 key; on NOT_FOUND optionally try legacy key (same bucket). */
async function readJsonKeyOrLegacy(
  primaryKey: string,
  legacyKey: string | null
): Promise<BacktestReportServiceResult<unknown>> {
  const primary = await readJsonKey(primaryKey);
  if (primary.ok) return primary;
  if (primary.code !== 'NOT_FOUND' || legacyKey == null) return primary;
  return readJsonKey(legacyKey);
}

export async function getBacktestSummary(args: {
  season: number;
  threshold: number;
}): Promise<BacktestReportServiceResult<BacktestReportFilePayload>> {
  const { season, threshold } = args;
  if (!Number.isFinite(season) || season < 1900 || season > 3000) {
    return { ok: false, code: 'BAD_REQUEST', message: 'Invalid season.' };
  }
  if (!Number.isFinite(threshold)) {
    return { ok: false, code: 'BAD_REQUEST', message: 'Invalid threshold.' };
  }
  const key = summaryReportS3Key(threshold, season);
  const legacyKey = threshold === 3 ? legacySummaryReportS3Key(season) : null;
  const raw = await readJsonKeyOrLegacy(key, legacyKey);
  if (!raw.ok) return raw;
  const parsed = parseBacktestSummaryPayload(raw.data);
  if (!parsed.ok) return parsed;
  if (parsed.data.summary.threshold !== threshold) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: `Report at legacy path exists but summary.threshold=${parsed.data.summary.threshold} does not match requested ${threshold}. Re-run: npm run report:backtest:points-l5-vs-season -- --season=${season} --threshold=${threshold}`,
    };
  }
  const payload: BacktestReportFilePayload = {
    generatedAt: parsed.data.generatedAt,
    reportVersion: 1,
    summary: parsed.data.summary,
  };
  return { ok: true, data: payload };
}

export async function getBacktestComparison(args: {
  seasons: readonly number[];
  threshold: number;
}): Promise<BacktestReportServiceResult<BacktestComparisonFilePayload>> {
  const { seasons, threshold } = args;
  const uniq = [...new Set(seasons)].filter((n) => Number.isFinite(n) && n >= 1900 && n <= 3000).sort((a, b) => a - b);
  if (uniq.length < 2) {
    return {
      ok: false,
      code: 'BAD_REQUEST',
      message: 'comparison requires at least two distinct seasons.',
    };
  }
  if (!Number.isFinite(threshold)) {
    return { ok: false, code: 'BAD_REQUEST', message: 'Invalid threshold.' };
  }
  const key = comparisonReportS3Key(threshold, uniq);
  const legacyKey = threshold === 3 ? legacyComparisonReportS3Key(uniq) : null;
  const raw = await readJsonKeyOrLegacy(key, legacyKey);
  if (!raw.ok) return raw;
  const parsed = parseBacktestComparisonPayload(raw.data);
  if (!parsed.ok) return parsed;
  const mismatched = parsed.data.comparison.perSeason.some(
    (p) => typeof p.threshold === 'number' && p.threshold !== threshold
  );
  if (mismatched) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: `Comparison report thresholds do not match requested ${threshold}. Regenerate reports under threshold=${threshold}.`,
    };
  }
  const payload: BacktestComparisonFilePayload = {
    generatedAt: parsed.data.generatedAt,
    reportVersion: 1,
    comparison: parsed.data.comparison,
  };
  return { ok: true, data: payload };
}

export type ThresholdSweepLoadResult = {
  payload: ThresholdSweepFilePayload;
  /** Requested thresholds not present in `sweep.rows`. */
  missingThresholds: number[];
};

export async function getBacktestThresholdSweep(args: {
  seasons: readonly number[];
  thresholds: readonly number[];
}): Promise<BacktestReportServiceResult<ThresholdSweepLoadResult>> {
  const uniqSeasons = [...new Set(args.seasons)]
    .filter((n) => Number.isFinite(n) && n >= 1900 && n <= 3000)
    .sort((a, b) => a - b);
  if (uniqSeasons.length < 2) {
    return {
      ok: false,
      code: 'BAD_REQUEST',
      message: 'threshold sweep requires at least two distinct seasons.',
    };
  }
  const uniqThresholds = [...new Set(args.thresholds)].filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (uniqThresholds.length === 0) {
    return { ok: false, code: 'BAD_REQUEST', message: 'thresholds must include at least one number.' };
  }
  const key = thresholdSweepReportS3Key(uniqSeasons);
  const raw = await readJsonKey(key);
  if (!raw.ok) return raw;
  const parsed = parseThresholdSweepPayload(raw.data);
  if (!parsed.ok) return parsed;
  const sweep = parsed.data.sweep;
  const present = new Set(sweep.rows.map((r) => r.threshold));
  const missingThresholds = uniqThresholds.filter((t) => !present.has(t));
  const payload: ThresholdSweepFilePayload = {
    generatedAt: parsed.data.generatedAt,
    reportVersion: 1,
    sweep,
  };
  return { ok: true, data: { payload, missingThresholds } };
}
