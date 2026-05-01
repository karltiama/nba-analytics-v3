import { NextRequest, NextResponse } from 'next/server';
import { getBacktestSummary } from '@/lib/backtesting/backtest-report-service';

export const runtime = 'nodejs';

function mapError(code: string): number {
  if (code === 'NOT_FOUND') return 404;
  if (code === 'NOT_CONFIGURED') return 503;
  if (code === 'BAD_REQUEST') return 400;
  return 500;
}

/**
 * GET /api/backtests/points-l5-vs-season/summary?season=2023&threshold=3
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const season = Number(sp.get('season'));
  const threshold = Number(sp.get('threshold') ?? '3');

  const out = await getBacktestSummary({ season, threshold });
  if (!out.ok) {
    const status = mapError(out.code);
    const friendly =
      out.code === 'NOT_FOUND'
        ? 'Report not found. Run the backtest/report commands for this season and threshold first.'
        : out.message;
    return NextResponse.json(
      { error: friendly, code: out.code, detail: out.code === 'NOT_FOUND' ? out.message : undefined },
      { status }
    );
  }
  return NextResponse.json(out.data);
}
