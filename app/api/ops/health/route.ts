import { NextRequest, NextResponse } from 'next/server';
import { withAdminJson } from '@/lib/model-lab/admin-route';
import { getCachedPlatformHealth } from '@/lib/ops/platform-health';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/ops/health
 * Compact data-platform health. Admin allowlist required, independent of the HTML page.
 * Does not expose credentials, bucket names, or provider payloads.
 */
export async function GET(request: NextRequest) {
  return withAdminJson(request, async () => {
    try {
      const report = await getCachedPlatformHealth();
      return NextResponse.json(report);
    } catch (error: unknown) {
      console.error('[api/ops/health] failed:', error instanceof Error ? error.message : 'unknown');
      return NextResponse.json(
        { error: 'health_unavailable', overall: 'UNKNOWN' },
        { status: 500 }
      );
    }
  });
}
