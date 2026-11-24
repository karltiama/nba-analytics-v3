import { NextRequest, NextResponse } from 'next/server';
import { withAdminJson } from '@/lib/model-lab/admin-route';
import { diagnoseCurrentBoard } from '@/lib/props/s3-current-board/diagnostic';
import { openWebsiteCurrentBoardStore } from '@/lib/props/s3-current-board/website-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DIAGNOSTIC_GAME_ID = '21718182';
const NO_STORE = { 'Cache-Control': 'private, no-store' };
const SAFE_FAILURES = new Set([
  'current_board_config_rejected',
  'AccessDenied',
  'CredentialsProviderError',
  'InvalidIdentityTokenException',
  'AccessDeniedException',
  'ExpiredTokenException',
  'NoSuchKey',
  'TimeoutError',
  'AbortError',
  'VercelOidcTokenError',
]);

/**
 * GET /api/admin/current-board-diagnostic?game_id=21718182
 * Admin allowlist only. This temporary route accepts one game and returns sanitized status.
 * Removal: delete this route, lib/props/s3-current-board/diagnostic.ts, and their tests
 * after the production OIDC read is recorded. This route must not become a public reader
 * and must not be used as a reason to set CURRENT_PROPS_SOURCE.
 */
function diagnosticFailureClass(error: unknown): string {
  if (!(error instanceof Error)) return 'unavailable';
  if (error.message === 'current_board_config_rejected') return 'current_board_config_rejected';
  return SAFE_FAILURES.has(error.name) ? error.name : 'unavailable';
}

export async function GET(request: NextRequest) {
  const response = await withAdminJson(request, async () => {
    const gameId = request.nextUrl.searchParams.get('game_id')?.trim() ?? '';
    if (gameId !== DIAGNOSTIC_GAME_ID) {
      return NextResponse.json({ error: 'unavailable' }, { status: 400, headers: NO_STORE });
    }
    try {
      const status = await diagnoseCurrentBoard({
        store: openWebsiteCurrentBoardStore(),
        gameId,
        now: new Date().toISOString(),
      });
      return NextResponse.json(status, { headers: NO_STORE });
    } catch (error) {
      const failure = diagnosticFailureClass(error);
      console.error('current_board_diagnostic', failure);
      return NextResponse.json(
        { error: 'unavailable', failure },
        { status: 503, headers: NO_STORE },
      );
    }
  });
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
