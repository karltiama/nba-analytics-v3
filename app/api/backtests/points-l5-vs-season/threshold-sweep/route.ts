import { NextRequest, NextResponse } from 'next/server';
import { getBacktestThresholdSweep } from '@/lib/backtesting/backtest-report-service';

export const runtime = 'nodejs';

function mapError(code: string): number {
  if (code === 'NOT_FOUND') return 404;
  if (code === 'NOT_CONFIGURED') return 503;
  if (code === 'BAD_REQUEST') return 400;
  return 500;
}

function parseNums(raw: string | null): number[] {
  if (!raw?.trim()) return [];
  return raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
}

/**
 * GET /api/backtests/points-l5-vs-season/threshold-sweep?seasons=2023,2024&thresholds=1,2,3,4,5
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const seasons = parseNums(sp.get('seasons'));
  const thresholds = parseNums(sp.get('thresholds'));

  const out = await getBacktestThresholdSweep({ seasons, thresholds });
  if (!out.ok) {
    const status = mapError(out.code);
    const friendly =
      out.code === 'NOT_FOUND'
        ? 'Threshold sweep report not found. Run report:backtest:points-l5-threshold-sweep for these seasons first.'
        : out.message;
    return NextResponse.json(
      { error: friendly, code: out.code, detail: out.code === 'NOT_FOUND' ? out.message : undefined },
      { status }
    );
  }
  return NextResponse.json({
    ...out.data.payload,
    missingThresholds: out.data.missingThresholds,
  });
}
