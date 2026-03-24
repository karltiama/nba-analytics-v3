import { NextRequest, NextResponse } from 'next/server';
import { getInjuryOpportunityCandidates } from '@/lib/betting/queries';

/**
 * GET /api/betting/players/opportunity
 *
 * Injury Opportunity Engine (Beta):
 * Detects low-minute players with plausible injury-created opportunity.
 */
export async function GET(request: NextRequest) {
  try {
    const limitParam = request.nextUrl.searchParams.get('limit');
    const parsed = limitParam ? parseInt(limitParam, 10) : 25;
    const limit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 100) : 25;

    const candidates = await getInjuryOpportunityCandidates(limit);

    return NextResponse.json({
      engine: 'Injury Opportunity Engine (Beta)',
      candidates,
      meta: {
        count: candidates.length,
        ranking: 'adjusted_edge_desc',
        note: 'Conservative opportunity detector for low-minute players; not a full projection model.',
      },
    });
  } catch (error: unknown) {
    console.error('Error computing injury opportunity candidates:', error);
    return NextResponse.json(
      {
        error: 'Failed to compute injury opportunity candidates',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
