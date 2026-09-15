import { NextResponse, type NextRequest } from 'next/server';
import { withAdminJson } from '@/lib/model-lab/admin-route';
import { loadCatalog } from '@/lib/model-lab/catalog';
import { compareExperiments } from '@/lib/model-lab/compare';
import type { ComparePointer } from '@/lib/model-lab/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function pointer(sp: URLSearchParams, side: 'left' | 'right'): ComparePointer | null {
  const experimentId = sp.get(`${side}Experiment`)?.trim();
  const modelId = sp.get(`${side}Model`)?.trim();
  const splitId = sp.get(`${side}Split`)?.trim();
  const targetId = sp.get(`${side}Target`)?.trim();
  if (!experimentId || !modelId || !splitId || !targetId) return null;
  return { experimentId, modelId, splitId, targetId };
}

export async function GET(request: NextRequest) {
  return withAdminJson(request, async () => {
    const sp = request.nextUrl.searchParams;
    const left = pointer(sp, 'left');
    const right = pointer(sp, 'right');
    if (!left || !right) {
      return NextResponse.json({ error: 'left* and right* experiment/model/split/target are required.' }, { status: 400 });
    }
    const comparison = compareExperiments(loadCatalog(), left, right);
    return NextResponse.json({ comparison });
  });
}
