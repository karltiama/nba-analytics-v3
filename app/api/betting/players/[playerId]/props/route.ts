import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getPlayerPropModelInputs } from '@/lib/betting/player-prop-inputs';
import { getCalibrationVersion } from '@/lib/betting/ev-calibration';
import { resolveEvTrack } from '@/lib/betting/ev-selection-policy';
import { computePropEvFields } from '@/lib/betting/player-prop-ev-row';

type PropRow = {
  game_id: number;
  player_id: number;
  player_name: string | null;
  sportsbook: string | null;
  prop_type: string | null;
  market_type: string | null;
  side: string | null;
  line_value: number | null;
  odds_american: number | null;
  odds_decimal: number | null;
  implied_probability: number | null;
  snapshot_at: string;
};

function impliedProbFromAmerican(oddsAmerican: number | null): number | null {
  if (oddsAmerican == null || Number.isNaN(oddsAmerican) || oddsAmerican === 0) return null;
  if (oddsAmerican < 0) return (-oddsAmerican) / ((-oddsAmerican) + 100);
  return 100 / (oddsAmerican + 100);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? null;
  const a = sorted[mid - 1];
  const b = sorted[mid];
  if (a == null || b == null) return null;
  return (a + b) / 2;
}

/**
 * GET /api/betting/players/[playerId]/props
 *
 * Returns current player props for the player from analytics.player_props_current.
 * Optional ?game_id=... to limit to one game.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ playerId: string }> }
) {
  try {
    const selectedTrack = resolveEvTrack();
    const { playerId } = await params;
    const playerIdNum = parseInt(playerId, 10);
    if (Number.isNaN(playerIdNum)) {
      return NextResponse.json({ props: [] });
    }

    const { searchParams } = new URL(request.url);
    const gameIdParam = searchParams.get('game_id');
    const gameIdNum = gameIdParam != null ? parseInt(gameIdParam, 10) : null;
    const hasValidGameId = gameIdNum != null && !Number.isNaN(gameIdNum);
    const withConsensus = searchParams.get('with_consensus') === '1';
    const withEv = searchParams.get('with_ev') === '1';

    let modelInputs: Awaited<ReturnType<typeof getPlayerPropModelInputs>> = null;
    if (withEv) {
      try {
        modelInputs = await getPlayerPropModelInputs(playerId);
      } catch (err) {
        console.error('[props EV] getPlayerPropModelInputs failed', { playerId, err });
      }
    }

    const rows = await query<PropRow>(
      hasValidGameId
        ? `SELECT game_id, player_id, player_name, sportsbook, prop_type, market_type, side, line_value,
                odds_american, odds_decimal, implied_probability, snapshot_at
           FROM analytics.player_props_current
           WHERE player_id = $1 AND game_id = $2
           ORDER BY prop_type, side, line_value NULLS LAST, sportsbook`
        : `SELECT game_id, player_id, player_name, sportsbook, prop_type, market_type, side, line_value,
                odds_american, odds_decimal, implied_probability, snapshot_at
           FROM analytics.player_props_current
           WHERE player_id = $1
           ORDER BY prop_type, side, line_value NULLS LAST, sportsbook`,
      hasValidGameId ? [playerIdNum, gameIdNum] : [playerIdNum]
    );

    const consensusKeyForBook = (r: PropRow) =>
      `${r.game_id}|${r.player_id}|${r.prop_type ?? ''}|${r.market_type ?? ''}|${r.line_value ?? ''}|${r.sportsbook ?? ''}`;
    const consensusKeyNoBook = (r: PropRow) =>
      `${r.game_id}|${r.player_id}|${r.prop_type ?? ''}|${r.market_type ?? ''}|${r.line_value ?? ''}|${r.side ?? ''}`;

    const fairProbByBookSide = new Map<string, { over: number; under: number }>();
    const consensusBySide = new Map<string, number>();

    if (withConsensus) {
      const relevant = rows.filter(
        (r) =>
          (r.market_type ?? '').toLowerCase() === 'over_under' &&
          ((r.side ?? '').toLowerCase() === 'over' || (r.side ?? '').toLowerCase() === 'under') &&
          r.line_value != null &&
          r.sportsbook != null
      );

      // 1) Build vig-free fair probs per sportsbook when both sides exist.
      const byBook = new Map<string, { over?: number; under?: number }>();
      for (const r of relevant) {
        const pRaw =
          r.implied_probability != null ? Number(r.implied_probability) : impliedProbFromAmerican(r.odds_american);
        if (pRaw == null || Number.isNaN(pRaw)) continue;
        const key = consensusKeyForBook(r);
        const entry = byBook.get(key) ?? {};
        if ((r.side ?? '').toLowerCase() === 'over') entry.over = pRaw;
        if ((r.side ?? '').toLowerCase() === 'under') entry.under = pRaw;
        byBook.set(key, entry);
      }
      for (const [key, entry] of byBook.entries()) {
        if (entry.over == null || entry.under == null) continue;
        const denom = entry.over + entry.under;
        if (!Number.isFinite(denom) || denom <= 0) continue;
        fairProbByBookSide.set(key, { over: entry.over / denom, under: entry.under / denom });
      }

      // 2) Median across books for each side group.
      const probsBySideKey = new Map<string, number[]>();
      for (const r of relevant) {
        const bookKey = consensusKeyForBook(r);
        const fair = fairProbByBookSide.get(bookKey);
        if (!fair) continue;
        const side = (r.side ?? '').toLowerCase();
        const fairP = side === 'over' ? fair.over : fair.under;
        const sideKey = consensusKeyNoBook(r);
        if (!probsBySideKey.has(sideKey)) probsBySideKey.set(sideKey, []);
        probsBySideKey.get(sideKey)!.push(fairP);
      }

      const MIN_BOOKS = 3;
      for (const [sideKey, probs] of probsBySideKey.entries()) {
        if (probs.length < MIN_BOOKS) continue;
        const m = median(probs);
        if (m != null) consensusBySide.set(sideKey, m);
      }
    }

    const props = rows.map((r) => {
      const offerP =
        r.implied_probability != null ? Number(r.implied_probability) : impliedProbFromAmerican(r.odds_american);
      const consensusP = withConsensus ? (consensusBySide.get(consensusKeyNoBook(r)) ?? null) : null;
      const isOverUnder =
        (r.market_type ?? '').toLowerCase() === 'over_under' &&
        ((r.side ?? '').toLowerCase() === 'over' || (r.side ?? '').toLowerCase() === 'under');
      const fairForBook = isOverUnder ? fairProbByBookSide.get(consensusKeyForBook(r)) : null;
      const offerFairP =
        fairForBook != null
          ? (r.side ?? '').toLowerCase() === 'over'
            ? fairForBook.over
            : fairForBook.under
          : null;
      const edgeP =
        withConsensus && consensusP != null && offerFairP != null && Number.isFinite(offerFairP)
          ? consensusP - offerFairP
          : null;

      let modelProbability: number | null = null;
      let ev: number | null = null;
      let projection: number | null = null;
      let modelProbabilityTrackA: number | null = null;
      let evTrackA: number | null = null;
      let projectionTrackA: number | null = null;
      let modelProbabilityTrackB: number | null = null;
      let evTrackB: number | null = null;
      let projectionTrackB: number | null = null;
      if (withEv && modelInputs && isOverUnder) {
        const evFields = computePropEvFields(
          {
            prop_type: r.prop_type,
            market_type: r.market_type,
            side: r.side,
            line_value: r.line_value,
            odds_american: r.odds_american,
            odds_decimal: r.odds_decimal,
          },
          modelInputs,
          selectedTrack
        );
        modelProbability = evFields.modelProbability;
        ev = evFields.ev;
        projection = evFields.projection;
        modelProbabilityTrackA = evFields.modelProbabilityTrackA;
        evTrackA = evFields.evTrackA;
        projectionTrackA = evFields.projectionTrackA;
        modelProbabilityTrackB = evFields.modelProbabilityTrackB;
        evTrackB = evFields.evTrackB;
        projectionTrackB = evFields.projectionTrackB;
      }

      return {
        gameId: r.game_id,
        playerId: r.player_id,
        playerName: r.player_name ?? null,
        sportsbook: r.sportsbook ?? null,
        propType: r.prop_type ?? null,
        marketType: r.market_type ?? null,
        side: r.side ?? null,
        lineValue: r.line_value != null ? Number(r.line_value) : null,
        oddsAmerican: r.odds_american ?? null,
        oddsDecimal: r.odds_decimal != null ? Number(r.odds_decimal) : null,
        impliedProbability: offerP != null && Number.isFinite(offerP) ? offerP : null,
        snapshotAt: r.snapshot_at,
        consensusProbability: consensusP,
        edgeProbability: edgeP,
        modelProbability: modelProbability ?? null,
        ev: ev != null && Number.isFinite(ev) ? ev : null,
        projection,
        modelProbabilityTrackA: modelProbabilityTrackA != null && Number.isFinite(modelProbabilityTrackA) ? modelProbabilityTrackA : null,
        evTrackA: evTrackA != null && Number.isFinite(evTrackA) ? evTrackA : null,
        projectionTrackA: projectionTrackA != null && Number.isFinite(projectionTrackA) ? projectionTrackA : null,
        modelProbabilityTrackB: modelProbabilityTrackB != null && Number.isFinite(modelProbabilityTrackB) ? modelProbabilityTrackB : null,
        evTrackB: evTrackB != null && Number.isFinite(evTrackB) ? evTrackB : null,
        projectionTrackB: projectionTrackB != null && Number.isFinite(projectionTrackB) ? projectionTrackB : null,
        evSelectedTrack: selectedTrack,
        calibrationVersion: getCalibrationVersion(),
      };
    });

    return NextResponse.json({ props });
  } catch (error: unknown) {
    console.error('Error fetching player props:', error);
    return NextResponse.json(
      { error: 'Failed to fetch player props', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
