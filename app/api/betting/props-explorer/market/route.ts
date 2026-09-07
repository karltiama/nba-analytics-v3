import { NextRequest, NextResponse } from 'next/server';
import { requireBettingAuth } from '@/lib/auth/require-betting-auth';
import { isIngestionFrozen } from '@/lib/betting/ai-briefing-eligibility';
import { etCalendarDate } from '@/lib/betting/props-market-context';
import { getPropMarketResearch } from '@/lib/betting/prop-market-serving';
import { getUserEntitlements } from '@/lib/entitlements/queries';
import { sanitizePropMarketResearch } from '@/lib/entitlements/sanitize-prop-market';

/**
 * GET /api/betting/props-explorer/market
 *
 * On-demand market research for one Explorer row.
 * Does not fan out across the visible table.
 */
export async function GET(request: NextRequest) {
  const gate = await requireBettingAuth(request);
  if (!gate.ok) return gate.response;
  try {
    const sp = request.nextUrl.searchParams;
    const result = await getPropMarketResearch({
      gameId: sp.get('game_id')?.trim() ?? '',
      playerId: sp.get('player_id')?.trim() ?? '',
      propType: sp.get('prop_type')?.trim() ?? '',
      side: sp.get('side')?.trim() ?? '',
      lineValue: sp.get('line_value') ?? '',
      sportsbook: sp.get('sportsbook')?.trim() ?? '',
      snapshotAt: sp.get('snapshot_at')?.trim() || undefined,
      oddsAmerican:
        sp.get('odds_american') != null && sp.get('odds_american') !== ''
          ? Number(sp.get('odds_american'))
          : null,
      dateEt: sp.get('date')?.trim() || etCalendarDate(),
      frozen: isIngestionFrozen(),
    });

    if ('error' in result) {
      return gate.withAuthCookies(NextResponse.json({ error: result.error }, { status: result.status }));
    }

    const entitlement = await getUserEntitlements(gate.auth.userId);
    const payload = sanitizePropMarketResearch(result, entitlement);
    return gate.withAuthCookies(NextResponse.json(payload));
  } catch (error: unknown) {
    console.error('props-explorer-market:', error);
    return gate.withAuthCookies(
      NextResponse.json(
        {
          error: 'Failed to fetch prop market comparison',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        { status: 500 }
      )
    );
  }
}
