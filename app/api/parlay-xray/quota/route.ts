import { NextRequest, NextResponse } from 'next/server';
import { requireBettingAuth } from '@/lib/auth/require-betting-auth';
import { getUserEntitlements } from '@/lib/entitlements/queries';
import { XRAY_EXTRACT_MESSAGE } from '@/lib/parlay-xray/extraction';
import { readXrayQuota } from '@/lib/parlay-xray/extraction/pipeline';
import { getXrayRuntime } from '@/lib/parlay-xray/extraction/runtime';
import { XrayStoreUnavailableError } from '@/lib/parlay-xray/extraction/store';

export const runtime = 'nodejs';

/**
 * GET /api/parlay-xray/quota
 * Remaining daily extractions for the authenticated user. Never calls the provider.
 */
export async function GET(request: NextRequest) {
  const gate = await requireBettingAuth(request);
  if (!gate.ok) {
    return NextResponse.json(
      { result: 'AUTH_REQUIRED', message: XRAY_EXTRACT_MESSAGE.AUTH_REQUIRED },
      { status: 401 }
    );
  }

  try {
    const { config, store } = await getXrayRuntime();
    const entitlement = await getUserEntitlements(gate.auth.userId);
    const quota = await readXrayQuota(store, config, gate.auth.userId, entitlement.isPro);
    return gate.withAuthCookies(NextResponse.json({ result: 'OK', quota }));
  } catch (error) {
    if (error instanceof XrayStoreUnavailableError) {
      return gate.withAuthCookies(NextResponse.json({ result: 'OK', quota: null }));
    }
    console.error('[parlay-xray] quota internal error', error instanceof Error ? error.message : 'unknown');
    return gate.withAuthCookies(
      NextResponse.json(
        { result: 'INTERNAL_ERROR', message: XRAY_EXTRACT_MESSAGE.INTERNAL_ERROR, quota: null },
        { status: 500 }
      )
    );
  }
}
