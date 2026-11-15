/**
 * Temporary preview canary. It must be removed before any production promotion.
 * Production and development are rejected. Admin auth stays required.
 * The body has checksums and counts only.
 */
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { getVercelOidcToken } from '@vercel/oidc';
import { NextResponse, type NextRequest } from 'next/server';
import { withAdminJson } from '@/lib/model-lab/admin-route';
import {
  HISTORICAL_BOARD_PREVIEW_ROLE_ARN,
  historicalBoardCredentialProvider,
  openHistoricalBoardS3Store,
} from '@/lib/props/historical-board-s3';
import {
  buildHistoricalBoardCanaryReport,
  historicalBoardCanaryAllowed,
  publicFailureCategory,
  readCanaryArchive,
} from '@/lib/props/historical-board-canary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PREVIEW_SUBJECT = 'owner:karltiamas-projects:project:nba-analytics-v3:environment:preview';
const PREVIEW_ISSUER = 'https://oidc.vercel.com/karltiamas-projects';
const PREVIEW_AUDIENCE = 'https://vercel.com/karltiamas-projects';
const ASSUMED_PREFIX = 'arn:aws:sts::260029269390:assumed-role/court-context-historical-board-read-preview/';

export async function GET(request: NextRequest) {
  if (!historicalBoardCanaryAllowed({ VERCEL_ENV: process.env.VERCEL_ENV })) {
    return NextResponse.json({ error: 'preview_only' }, { status: 404 });
  }
  return withAdminJson(request, async () => {
    try {
      const report = await runPreviewCanary();
      return NextResponse.json(report);
    } catch (error) {
      const category = publicFailureCategory(error);
      console.error('[historical-board-canary]', category);
      const claims = category.startsWith('archive_') ? null : await claimCheck();
      return NextResponse.json({ error: category, claims }, { status: 502 });
    }
  });
}

async function runPreviewCanary() {
  if (process.env.AWS_ROLE_ARN !== HISTORICAL_BOARD_PREVIEW_ROLE_ARN) throw new Error('archive_config_rejected');
  const credentials = historicalBoardCredentialProvider({
    VERCEL: process.env.VERCEL,
    AWS_ROLE_ARN: process.env.AWS_ROLE_ARN,
  });
  if (!credentials) throw new Error('archive_config_rejected');
  const identity = await new STSClient({ region: 'us-east-1', credentials }).send(new GetCallerIdentityCommand({}));
  const arn = identity.Arn ?? '';
  if (!arn.startsWith(ASSUMED_PREFIX) || identity.Account !== '260029269390') throw new Error('archive_access_denied');
  const loaded = await readCanaryArchive(openHistoricalBoardS3Store());
  const todayEt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  return {
    environment: 'preview',
    assumedPreviewRole: true,
    account: identity.Account,
    ...buildHistoricalBoardCanaryReport({ ...loaded, todayEt }),
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

async function claimCheck() {
  try {
    const token = await getVercelOidcToken();
    const payload = token.split('.')[1];
    if (!payload) return { tokenReadable: false };
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
    const audience = claims.aud;
    const audiences = Array.isArray(audience) ? audience.map(String) : [String(audience ?? '')];
    return {
      tokenReadable: true,
      issuerMatches: claims.iss === PREVIEW_ISSUER,
      audienceMatches: audiences.includes(PREVIEW_AUDIENCE),
      subjectMatches: claims.sub === PREVIEW_SUBJECT,
      ownerMatches: claims.owner === 'karltiamas-projects',
      projectMatches: claims.project === 'nba-analytics-v3',
      environmentMatches: claims.environment === 'preview',
    };
  } catch {
    return { tokenReadable: false };
  }
}
