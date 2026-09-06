import { NextRequest, NextResponse } from 'next/server';
import { requireBettingAuth } from '@/lib/auth/require-betting-auth';
import { getCachedPlatformHealth } from '@/lib/ops/platform-health';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/ops/health
 * Compact data-platform health. Session auth required (same gate as betting APIs).
 * Does not expose credentials, bucket names, or provider payloads.
 */
export async function GET(request: NextRequest) {
  const gate = await requireBettingAuth(request);
  if (!gate.ok) return gate.response;

  try {
    const report = await getCachedPlatformHealth();
    return gate.withAuthCookies(NextResponse.json(report));
  } catch (error: unknown) {
    console.error('[api/ops/health] failed:', error instanceof Error ? error.message : 'unknown');
    return gate.withAuthCookies(
      NextResponse.json(
        { error: 'health_unavailable', overall: 'UNKNOWN' },
        { status: 500 }
      )
    );
  }
}
