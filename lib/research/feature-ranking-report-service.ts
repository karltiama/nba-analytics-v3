import { S3Client } from '@aws-sdk/client-s3';
import { S3Storage } from '@/lib/aws/s3';

export type FeatureScore = {
  feature_name: string;
  sample_size: number;
  null_count: number;
  null_rate: number;
  target_true_count: number;
  target_false_count: number;
  mean_when_target_true: number | null;
  mean_when_target_false: number | null;
  mean_difference: number | null;
  abs_mean_difference: number | null;
  simple_correlation_with_target: number | null;
  rank: number;
};

export type FeatureRankingReportPayload = {
  season: number;
  target_definition: string;
  generated_at: string;
  input_path: string;
  output_path: string;
  total_rows_analyzed: number;
  total_usable_rows: number;
  features_scored: number;
  feature_scores: FeatureScore[];
};

type ServiceErrorCode = 'NOT_CONFIGURED' | 'NOT_FOUND' | 'INVALID_JSON' | 'BAD_REQUEST';

type ServiceResult<T> = { ok: true; data: T } | { ok: false; code: ServiceErrorCode; message: string };

function featureRankingS3Key(season: number): string {
  return `research/feature-selection/league=nba/target=score_above_season_avg/season=${season}/feature_scores.json`;
}

function getS3(): S3Storage | null {
  const bucket = process.env.NBA_DATA_BUCKET?.trim();
  if (!bucket) return null;
  const region = process.env.AWS_REGION?.trim() || 'us-east-1';
  return new S3Storage({ bucket, client: new S3Client({ region }) });
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return x != null && typeof x === 'object' && !Array.isArray(x);
}

function parsePayload(raw: unknown): ServiceResult<FeatureRankingReportPayload> {
  if (!isRecord(raw)) return { ok: false, code: 'INVALID_JSON', message: 'Payload is not an object.' };
  if (
    typeof raw.season !== 'number' ||
    typeof raw.generated_at !== 'string' ||
    typeof raw.target_definition !== 'string' ||
    !Array.isArray(raw.feature_scores)
  ) {
    return { ok: false, code: 'INVALID_JSON', message: 'Payload missing required fields.' };
  }
  return { ok: true, data: raw as FeatureRankingReportPayload };
}

export async function getPlayerPointsFeatureRankingReport(
  season: number
): Promise<ServiceResult<FeatureRankingReportPayload>> {
  if (!Number.isFinite(season) || season < 1900 || season > 3000) {
    return { ok: false, code: 'BAD_REQUEST', message: 'Invalid season.' };
  }
  const s3 = getS3();
  if (!s3) {
    return {
      ok: false,
      code: 'NOT_CONFIGURED',
      message: 'NBA_DATA_BUCKET is not set. Configure the bucket on the server.',
    };
  }

  const key = featureRankingS3Key(season);
  const text = await s3.getText(key);
  if (text == null) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: `Feature ranking report not found at s3://${s3.bucket}/${key}`,
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, code: 'INVALID_JSON', message: `Invalid JSON at s3://${s3.bucket}/${key}` };
  }

  return parsePayload(raw);
}
