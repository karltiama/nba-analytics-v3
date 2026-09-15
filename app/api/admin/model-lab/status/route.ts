import { NextResponse, type NextRequest } from 'next/server';
import { withAdminJson } from '@/lib/model-lab/admin-route';
import { loadModelLabStatus } from '@/lib/model-lab/status';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return withAdminJson(request, async () => {
    const status = await loadModelLabStatus();
    return NextResponse.json({ status });
  });
}
