import { NextResponse, type NextRequest } from 'next/server';
import { withAdminJson } from '@/lib/model-lab/admin-route';
import { loadExplorerDetail } from '@/lib/model-lab/explorer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  return withAdminJson(request, async () => {
    const sp = request.nextUrl.searchParams;
    const experimentId = sp.get('experiment')?.trim();
    const playerId = sp.get('player')?.trim();
    const gameId = sp.get('game')?.trim();
    if (!experimentId || !playerId || !gameId) {
      return NextResponse.json({ error: 'experiment, player, and game are required.' }, { status: 400 });
    }
    const detail = await loadExplorerDetail({ experimentId, playerId, gameId });
    return NextResponse.json(detail);
  });
}
