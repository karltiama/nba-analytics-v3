/**
 * GET /api/shared-slips/[shareId] — public lookup.
 * Returns PublicSharedBetSlip only (never id / created_by).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSharedBetSlipByShareId } from '@/lib/bet-slip/server';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ shareId: string }> }
) {
  const { shareId } = await context.params;
  const result = await getSharedBetSlipByShareId(shareId);

  if (!result.ok) {
    const status = result.code === 'NOT_FOUND' ? 404 : 422;
    return NextResponse.json({ error: result.code, message: result.message }, { status });
  }

  return NextResponse.json({ share: result.share });
}
