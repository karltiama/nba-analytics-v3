import { NextRequest, NextResponse } from 'next/server';
import { withAdminJson } from '@/lib/model-lab/admin-route';
import { diagnoseCurrentBoard } from '@/lib/props/s3-current-board/diagnostic';
import { isCurrentBoardGameId } from '@/lib/props/s3-current-board/pointer';
import { openWebsiteCurrentBoardStore } from '@/lib/props/s3-current-board/website-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/current-board-diagnostic?game_id=
 * Admin allowlist only. Returns sanitized read status, never rows, tokens, or credentials.
 * Removal: delete this route, lib/props/s3-current-board/diagnostic.ts, and their tests
 * after the production OIDC read is recorded. This route must not become a public reader
 * and must not be used as a reason to set CURRENT_PROPS_SOURCE.
 */
export async function GET(request: NextRequest) {
  return withAdminJson(request, async () => {
    const gameId = request.nextUrl.searchParams.get('game_id')?.trim() ?? '';
    if (!isCurrentBoardGameId(gameId)) {
      return NextResponse.json({ error: 'unavailable' }, { status: 400 });
    }
    try {
      const status = await diagnoseCurrentBoard({
        store: openWebsiteCurrentBoardStore(),
        gameId,
        now: new Date().toISOString(),
      });
      return NextResponse.json(status);
    } catch {
      return NextResponse.json({ error: 'unavailable' }, { status: 503 });
    }
  });
}
