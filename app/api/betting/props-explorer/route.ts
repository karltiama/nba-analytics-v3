import { NextRequest, NextResponse } from 'next/server';
import { requireBettingAuth } from '@/lib/auth/require-betting-auth';
import { isIngestionFrozen } from '@/lib/betting/ai-briefing-eligibility';
import {
  getPlayerPropsForExplorer,
  PROPS_EXPLORER_MAX_LIMIT,
} from '@/lib/betting/props-explorer-serving';
import { etCalendarDate } from '@/lib/betting/props-market-context';

/**
 * GET /api/betting/props-explorer
 *
 * Paginated props for a date or game_id.
 * Live/current dates read analytics.player_props_current.
 * Historical dates read research.prop_decision_lines (last pre-tip closing line).
 * Auth required — EV/model compute is expensive on the live path.
 */
export async function GET(request: NextRequest) {
  const gate = await requireBettingAuth(request);
  if (!gate.ok) return gate.response;
  try {
    const sp = request.nextUrl.searchParams;
    let limit = parseInt(sp.get('limit') || '100', 10);
    let offset = parseInt(sp.get('offset') || '0', 10);
    if (Number.isNaN(limit)) limit = 100;
    if (Number.isNaN(offset)) offset = 0;
    limit = Math.min(Math.max(limit, 1), PROPS_EXPLORER_MAX_LIMIT);
    offset = Math.max(offset, 0);

    const dateEt = sp.get('date')?.trim() || etCalendarDate();
    const minEvParam = sp.get('min_ev');
    const minEv =
      minEvParam != null && minEvParam !== '' && !Number.isNaN(parseFloat(minEvParam))
        ? parseFloat(minEvParam)
        : null;

    const result = await getPlayerPropsForExplorer({
      dateEt,
      gameId: sp.get('game_id')?.trim() ?? '',
      playerName: sp.get('player_name')?.trim() ?? '',
      propType: sp.get('prop_type')?.trim() ?? '',
      side: sp.get('side') || 'all',
      sportsbook: sp.get('sportsbook')?.trim() ?? '',
      marketType: sp.get('market_type') || 'over_under',
      sort: sp.get('sort') || 'snapshot_at',
      dirAsc: sp.get('dir') === 'asc',
      limit,
      offset,
      minEv,
    });

    return NextResponse.json({
      rows: result.rows,
      limit,
      offset,
      meta: {
        totalMatching: result.totalMatching,
        evSelectedTrack: result.evSelectedTrack,
        calibrationVersion: result.calibrationVersion,
        computedAt: new Date().toISOString(),
        evFetchCap: result.evFetchCap,
        sort: result.sort,
        dir: sp.get('dir') === 'asc' ? 'asc' : 'desc',
        ingestionFrozen: isIngestionFrozen(),
        marketContext: result.marketContext,
        sourceTable: result.sourceTable,
        lineLabel: result.lineLabel,
        dateEt: result.dateEt,
      },
    });
  } catch (error: unknown) {
    console.error('props-explorer:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch props explorer',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
