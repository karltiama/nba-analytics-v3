import { NextRequest, NextResponse } from 'next/server';
import { getPlayerPointsFeatureRankingReport } from '@/lib/research/feature-ranking-report-service';

export const runtime = 'nodejs';

function mapError(code: string): number {
  if (code === 'NOT_FOUND') return 404;
  if (code === 'NOT_CONFIGURED') return 503;
  if (code === 'BAD_REQUEST') return 400;
  return 500;
}

/**
 * GET /api/research/feature-selection/player-points?season=2024
 */
export async function GET(request: NextRequest) {
  const season = Number(request.nextUrl.searchParams.get('season'));
  const out = await getPlayerPointsFeatureRankingReport(season);
  if (!out.ok) {
    const status = mapError(out.code);
    const friendly =
      out.code === 'NOT_FOUND'
        ? 'Feature ranking report not found. Run research:rank-point-features for this season first.'
        : out.message;
    return NextResponse.json(
      { error: friendly, code: out.code, detail: out.code === 'NOT_FOUND' ? out.message : undefined },
      { status }
    );
  }
  return NextResponse.json(out.data);
}
