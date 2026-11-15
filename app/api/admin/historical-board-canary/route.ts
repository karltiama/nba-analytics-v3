/**
 * Temporary production canary. Remove it after the one authenticated attempt.
 * Preview and development return 404. The body has checksums and counts only.
 */
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { S3Client } from '@aws-sdk/client-s3';
import { NextResponse, type NextRequest } from 'next/server';
import { withAdminJson } from '@/lib/model-lab/admin-route';
import {
  historicalBoardCanaryAllowed,
  productionCanaryOriginAllowed,
  publicFailureCategory,
  readCanaryArchive,
  buildHistoricalBoardCanaryReport,
} from '@/lib/props/historical-board-canary';
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

export async function POST(request: NextRequest) {
  if (!historicalBoardCanaryAllowed({ VERCEL_ENV: process.env.VERCEL_ENV })) {
    return NextResponse.json({ error: 'not_found' }, { status: 404, headers: NO_STORE });
  }
  if (!productionCanaryOriginAllowed({
    origin: request.headers.get('origin'),
    fetchSite: request.headers.get('sec-fetch-site'),
  })) {
    return NextResponse.json({ error: 'origin_rejected' }, { status: 403, headers: NO_STORE });
  }
  return withAdminJson(request, async () => {
    try {
      const report = await runProductionCanary();
      return NextResponse.json(report, { headers: NO_STORE });
    } catch (error) {
      const category = publicFailureCategory(error);
      console.error('[historical-board-canary]', category);
      return NextResponse.json({ error: category }, { status: 502, headers: NO_STORE });
    }
  });
}

export async function GET() {
  return NextResponse.json({ error: 'not_found' }, { status: 404, headers: NO_STORE });
}

async function runProductionCanary() {
  if (historicalBoardSourceFromEnv(process.env).mode !== 'off') throw new Error('archive_config_rejected');
  if (process.env.AWS_ROLE_ARN !== HISTORICAL_BOARD_PRODUCTION_ROLE_ARN) throw new Error('archive_config_rejected');
  const credentials = historicalBoardCredentialProvider({
    VERCEL: process.env.VERCEL,
    AWS_ROLE_ARN: process.env.AWS_ROLE_ARN,
  });
  if (!credentials) throw new Error('archive_config_rejected');
  const identity = await new STSClient({ region: HISTORICAL_BOARD_REGION, credentials }).send(new GetCallerIdentityCommand({}));
  const arn = identity.Arn ?? '';
  if (!arn.startsWith(ASSUMED_PREFIX) || identity.Account !== '260029269390') throw new Error('archive_access_denied');
  const loaded = await readCanaryArchive(historicalBoardS3ClientStore(new S3Client({
    region: HISTORICAL_BOARD_REGION,
    credentials,
  })));
  const todayEt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  return {
    environment: 'production',
    assumedRole: 'court-context-historical-board-read-production',
    account: identity.Account,
    ...buildHistoricalBoardCanaryReport({ ...loaded, todayEt, archiveMode: 'off' }),
    postgres: await postgresCounts(),
  };
}

async function postgresCounts(): Promise<{ protectedFinalRows: number; openGameRows: number } | { error: 'postgres_read_failed' }> {
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
