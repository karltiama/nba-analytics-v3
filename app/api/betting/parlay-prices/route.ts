import { NextRequest, NextResponse } from 'next/server';
import { requireBettingAuth } from '@/lib/auth/require-betting-auth';
import { parseLineValue, parsePropSide } from '@/lib/betting/prop-market-compare';
import { PARLAY_SELECTION_SOFT_CAP } from '@/lib/parlay/selection';
import { resolveParlayQuoteFallback } from '@/lib/parlay/resolve-parlay-quotes';
import { isBestBookViewEnabled, type TrueCostLegKey } from '@/lib/parlay/true-cost-quotes';
import { loadCurrentLegQuotes } from '@/lib/parlay/true-cost-server';
import { loadS3CurrentLegQuotes } from '@/lib/parlay/s3-current-quotes';
import { historicalBoardSourceFromEnv } from '@/lib/props/historical-board-config';
import { currentPropsSource } from '@/lib/props/s3-current-board/source';
import { websiteCurrentBoardStore } from '@/lib/props/s3-current-board/website-store';

export const runtime = 'nodejs';

type LegBody = {
  gameId?: unknown;
  playerId?: unknown;
  market?: unknown;
  side?: unknown;
  line?: unknown;
  vendor?: unknown;
};

function id(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return value.trim();
  return null;
}

/**
 * POST /api/betting/parlay-prices
 *
 * Current prices for each parlay leg across supported books, from analytics.player_props_current.
 * Feeds the True cost panel (opposite side for no-vig math, and the best single book).
 * When PARLAY_TRUE_COST_BEST_BOOK is off, only the leg's own book is returned.
 * Auth required, like the other /api/betting routes.
 */
export async function POST(request: NextRequest) {
  const gate = await requireBettingAuth(request);
  if (!gate.ok) return gate.response;

  let body: { legs?: LegBody[] };
  try {
    body = await request.json();
  } catch {
    return gate.withAuthCookies(NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }));
  }
  const raw = Array.isArray(body?.legs) ? body.legs : null;
  if (!raw || raw.length === 0 || raw.length > PARLAY_SELECTION_SOFT_CAP) {
    return gate.withAuthCookies(NextResponse.json({ error: 'Invalid legs' }, { status: 400 }));
  }

  const legs: TrueCostLegKey[] = [];
  const vendors: Array<string | null> = [];
  for (const leg of raw) {
    const gameId = id(leg.gameId);
    const playerId = id(leg.playerId);
    const side = parsePropSide(typeof leg.side === 'string' ? leg.side : null);
    const line = parseLineValue(typeof leg.line === 'number' || typeof leg.line === 'string' ? leg.line : null);
    const market = typeof leg.market === 'string' ? leg.market.trim().toLowerCase() : '';
    if (!gameId || !playerId || !side || line == null || !market) {
      return gate.withAuthCookies(NextResponse.json({ error: 'Invalid legs' }, { status: 400 }));
    }
    legs.push({ gameId, playerId, market, side, line });
    vendors.push(typeof leg.vendor === 'string' ? leg.vendor.trim().toLowerCase() : null);
  }

  try {
    const bestBookEnabled = isBestBookViewEnabled(process.env.PARLAY_TRUE_COST_BEST_BOOK);
    if (currentPropsSource() === 's3') {
      const resolved = await loadS3CurrentLegQuotes({
        legs,
        vendors,
        bestBookEnabled,
        now: new Date(),
        store: websiteCurrentBoardStore(),
      });
      return gate.withAuthCookies(
        NextResponse.json({
          quotesPerLeg: resolved.quotesPerLeg,
          bestBookEnabled,
          source: resolved.quoteSource,
        })
      );
    }
    const resolved = await resolveParlayQuoteFallback({
      legs,
      vendors,
      bestBookEnabled,
      source: historicalBoardSourceFromEnv(),
      loadSqlQuotes: loadCurrentLegQuotes,
    });
    return gate.withAuthCookies(
      NextResponse.json({
        quotesPerLeg: resolved.quotesPerLeg,
        bestBookEnabled,
        source: resolved.quoteSource,
      })
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code.startsWith('archive_')) {
      console.error('[parlay-prices]', code);
      return gate.withAuthCookies(NextResponse.json({ error: 'Historical prices unavailable' }, { status: 500 }));
    }
    console.error('[parlay-prices]', error);
    return gate.withAuthCookies(NextResponse.json({ error: 'Prices unavailable' }, { status: 500 }));
  }
}
