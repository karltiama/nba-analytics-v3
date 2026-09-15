import { NextResponse, type NextRequest } from 'next/server';
import { withAdminJson } from '@/lib/model-lab/admin-route';
import { explorerMaxPageSize, queryExplorer } from '@/lib/model-lab/explorer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  return withAdminJson(request, async () => {
    const sp = request.nextUrl.searchParams;
    const experimentId = sp.get('experiment')?.trim();
    if (!experimentId) {
      return NextResponse.json({ error: 'experiment is required.' }, { status: 400 });
    }
    const pageSize = Number(sp.get('pageSize') ?? '25');
    const result = await queryExplorer({
      experimentId,
      playerId: sp.get('player') ?? undefined,
      gameDate: sp.get('date') ?? undefined,
      split: sp.get('split') ?? undefined,
      targetId: sp.get('target') ?? undefined,
      baselineModelId: sp.get('baseline') ?? undefined,
      learnedModelId: sp.get('learned') ?? undefined,
      page: Number(sp.get('page') ?? '1'),
      pageSize: Number.isFinite(pageSize) ? Math.min(pageSize, explorerMaxPageSize()) : 25,
    });
    return NextResponse.json(result);
  });
}
