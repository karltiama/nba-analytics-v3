import { NextRequest, NextResponse } from 'next/server';
import { getBacktestComparison } from '@/lib/backtesting/backtest-report-service';

export const runtime = 'nodejs';

function mapError(code: string): number {
  if (code === 'NOT_FOUND') return 404;
  if (code === 'NOT_CONFIGURED') return 503;
  if (code === 'BAD_REQUEST') return 400;
  return 500;
}

function parseSeasons(raw: string | null): number[] {
  if (!raw?.trim()) return [];
  return raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n >= 1900 && n <= 3000);
}

/**
 * GET /api/backtests/points-l5-vs-season/comparison?seasons=2023,2024&threshold=3
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const seasons = parseSeasons(sp.get('seasons'));
  const threshold = Number(sp.get('threshold') ?? '3');

  const out = await getBacktestComparison({ seasons, threshold });
  if (!out.ok) {
    const status = mapError(out.code);
    const friendly =
      out.code === 'NOT_FOUND'
        ? 'Report not found. Run the report command for this season pair and threshold first.'
        : out.message;
    return NextResponse.json(
      { error: friendly, code: out.code, detail: out.code === 'NOT_FOUND' ? out.message : undefined },
      { status }
    );
  }
  return NextResponse.json(out.data);
}
