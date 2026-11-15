/**
 * Temporary production proof of the empty-SQL True Cost fallback.
 * Remove it after the one authenticated attempt.
 */
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { S3Client } from '@aws-sdk/client-s3';
import { NextResponse, type NextRequest } from 'next/server';
import { withAdminJson } from '@/lib/model-lab/admin-route';
import { runHistoricalFallbackProof } from '@/lib/parlay/historical-fallback-proof';
import { historicalBoardSourceFromEnv, HISTORICAL_BOARD_REGION } from '@/lib/props/historical-board-config';
import {
  HISTORICAL_BOARD_PRODUCTION_ROLE_ARN,
  historicalBoardCredentialProvider,
  historicalBoardS3ClientStore,
} from '@/lib/props/historical-board-s3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const ASSUMED_PREFIX = 'arn:aws:sts::260029269390:assumed-role/court-context-historical-board-read-production/';
const PRODUCTION_ORIGINS = new Set(['https://courtcontext.com', 'https://www.courtcontext.com']);

function noStore(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function failureCategory(error: unknown): string {
  const name = errorName(error);
  if (name === 'AccessDenied' || name === 'InvalidIdentityToken' || name === 'ExpiredTokenException') return name;
  if (error instanceof Error && error.message.startsWith('archive_')) return error.message;
  return 'credential_rejected';
}

function errorName(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const record = error as { name?: unknown; cause?: unknown };
  if (typeof record.name === 'string' && record.name !== 'Error') return record.name;
  return errorName(record.cause);
}

export async function POST(request: NextRequest) {
  if (process.env.VERCEL_ENV !== 'production') {
    return NextResponse.json({ error: 'not_found' }, { status: 404, headers: NO_STORE });
  }
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if (!origin || !PRODUCTION_ORIGINS.has(origin) || (fetchSite != null && fetchSite !== 'same-origin')) {
    return NextResponse.json({ error: 'origin_rejected' }, { status: 403, headers: NO_STORE });
  }
  const response = await withAdminJson(request, async () => {
    try {
      const report = await runProductionFallback();
      return NextResponse.json(report, { headers: NO_STORE });
    } catch (error) {
      const category = failureCategory(error);
      console.error('[historical-quote-fallback]', category);
      return NextResponse.json({ error: category }, { status: 502, headers: NO_STORE });
    }
  });
  return noStore(response);
}

export async function GET() {
  return NextResponse.json({ error: 'not_found' }, { status: 404, headers: NO_STORE });
}

async function runProductionFallback() {
  const source = historicalBoardSourceFromEnv(process.env);
  if (source.mode !== 's3') throw new Error('archive_config_rejected');
  if (process.env.AWS_ROLE_ARN !== HISTORICAL_BOARD_PRODUCTION_ROLE_ARN) throw new Error('archive_config_rejected');
  const credentials = historicalBoardCredentialProvider({
    VERCEL: process.env.VERCEL,
    AWS_ROLE_ARN: process.env.AWS_ROLE_ARN,
  });
  if (!credentials) throw new Error('archive_config_rejected');
  const identity = await new STSClient({ region: HISTORICAL_BOARD_REGION, credentials }).send(new GetCallerIdentityCommand({}));
  const arn = identity.Arn ?? '';
  if (!arn.startsWith(ASSUMED_PREFIX) || identity.Account !== '260029269390') throw new Error('archive_access_denied');
  const todayEt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const proof = await runHistoricalFallbackProof({
    source,
    todayEt,
    store: historicalBoardS3ClientStore(new S3Client({ region: HISTORICAL_BOARD_REGION, credentials })),
  });
  return {
    environment: 'production',
    assumedRole: 'court-context-historical-board-read-production',
    account: identity.Account,
    ...proof,
    postgres: await protectedCounts(),
  };
}

async function protectedCounts(): Promise<{ protectedFinalRows: number; openGameRows: number } | { error: 'postgres_read_failed' }> {
  try {
    const { query } = await import('@/lib/db');
    const rows = await query<{ game_id: string; n: number }>(
      `SELECT game_id::text AS game_id, COUNT(*)::int AS n
         FROM analytics.player_props_current
        WHERE game_id::text = ANY($1::text[])
        GROUP BY game_id::text`,
      [['21718094', '21718103']]
    );
    const counts = new Map(rows.map((row) => [row.game_id, row.n]));
    return {
      protectedFinalRows: counts.get('21718094') ?? 0,
      openGameRows: counts.get('21718103') ?? 0,
    };
  } catch {
    return { error: 'postgres_read_failed' };
  }
}
