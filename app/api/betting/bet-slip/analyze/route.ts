import { NextRequest, NextResponse } from 'next/server';
import { betSlipAnalyzeBodySchema } from '@/lib/betting/bet-slip/schema';
import { assertPlayerExists, resolvePlayerName } from '@/lib/betting/bet-slip/player-resolve';
import { computeParlaySummary, type LegForParlay } from '@/lib/betting/bet-slip/parlay-summary';
import { getPlayerPropModelInputs, resolvePropStatKey } from '@/lib/betting/player-prop-inputs';
import { resolveEvTrack } from '@/lib/betting/ev-selection-policy';
import { computePropEvFields, type PropEvFields } from '@/lib/betting/player-prop-ev-row';
import type { PropEvRowInput } from '@/lib/betting/player-prop-ev-row';

function oddsDecimalFromAmerican(am: number | null): number | null {
  if (am == null || !Number.isFinite(am) || am === 0) return null;
  return am < 0 ? 1 + 100 / Math.abs(am) : 1 + am / 100;
}

function serializeEv(ev: PropEvFields) {
  return {
    modelProbability: ev.modelProbability,
    ev: ev.ev,
    projection: ev.projection,
    marketImpliedProbability: ev.marketImpliedProbability,
    confidenceTier: ev.confidenceTier,
    sigmaSummary: ev.sigmaSummary,
    modelProbabilityTrackBRaw: ev.modelProbabilityTrackBRaw,
    modelProbabilityTrackBCalibrated: ev.modelProbabilityTrackBCalibrated,
    modelProbabilityTrackBAnchored: ev.modelProbabilityTrackBAnchored,
    evTrackBRaw: ev.evTrackBRaw,
    evTrackBCalibrated: ev.evTrackBCalibrated,
    evTrackBAnchored: ev.evTrackBAnchored,
    modelProbabilityTrackARaw: ev.modelProbabilityTrackARaw,
    evTrackARaw: ev.evTrackARaw,
    sampleGamesUsed: ev.sampleGamesUsed,
    minutesStabilityScore: ev.minutesStabilityScore,
    isComboProp: ev.isComboProp,
    calibrationVersion: ev.calibrationVersion,
    modelTrackVersion: ev.modelTrackVersion,
  };
}

/**
 * POST /api/betting/bet-slip/analyze
 * Confirmed slip (after user edits); returns per-leg EV using computePropEvFields + parlay summary.
 */
export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = betSlipAnalyzeBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 });
  }

  const body = parsed.data;
  const selectedTrack = resolveEvTrack();
  const legsOut: Array<{
    index: number;
    playerNameInput: string;
    propType: string;
    side: string;
    line: number;
    oddsAmerican: number | null;
    matchStatus: 'matched' | 'ambiguous' | 'unmatched';
    matchedPlayer: { playerId: string; fullName: string } | null;
    ambiguousCandidates: Array<{ playerId: string; fullName: string }> | null;
    unmatchedReason: string | null;
    propTypeError: string | null;
    analysis: ReturnType<typeof serializeEv> | null;
    evSelectedTrack: string;
  }> = [];

  const parlayLegs: LegForParlay[] = [];

  for (let i = 0; i < body.legs.length; i++) {
    const leg = body.legs[i]!;
    let matchStatus: 'matched' | 'ambiguous' | 'unmatched' = 'unmatched';
    let matchedPlayer: { playerId: string; fullName: string } | null = null;
    let ambiguousCandidates: Array<{ playerId: string; fullName: string }> | null = null;
    let unmatchedReason: string | null = null;
    let propTypeError: string | null = null;
    let analysis: ReturnType<typeof serializeEv> | null = null;

    let resolved: { playerId: string; fullName: string } | null = null;

    if (leg.resolved_player_id) {
      const ex = await assertPlayerExists(leg.resolved_player_id);
      if (!ex) {
        unmatchedReason = 'Resolved player id not found in database.';
        matchStatus = 'unmatched';
      } else {
        resolved = ex;
        matchStatus = 'matched';
        matchedPlayer = ex;
      }
    } else {
      const r = await resolvePlayerName(leg.player_name);
      if (r.status === 'matched') {
        resolved = { playerId: r.playerId, fullName: r.fullName };
        matchStatus = 'matched';
        matchedPlayer = resolved;
      } else if (r.status === 'ambiguous') {
        matchStatus = 'ambiguous';
        ambiguousCandidates = r.candidates;
        unmatchedReason = 'Multiple players matched; pick one or edit the name.';
      } else {
        matchStatus = 'unmatched';
        unmatchedReason = r.reason;
      }
    }

    if (resolved && matchStatus === 'matched') {
      const statKey = resolvePropStatKey(leg.prop_type);
      if (!statKey) {
        propTypeError =
          'This prop type is not supported by the player prop model (use points, rebounds, assists, threes, PRA, etc.).';
      } else {
        let inputs = null as Awaited<ReturnType<typeof getPlayerPropModelInputs>>;
        try {
          inputs = await getPlayerPropModelInputs(resolved.playerId);
        } catch {
          inputs = null;
        }
        if (!inputs) {
          propTypeError = propTypeError ?? 'Could not load player stats for the model.';
        } else {
          const row: PropEvRowInput = {
            prop_type: leg.prop_type.trim(),
            market_type: 'over_under',
            side: leg.side,
            line_value: leg.line,
            odds_american: leg.odds_american,
            odds_decimal: oddsDecimalFromAmerican(leg.odds_american),
          };
          const evFields = computePropEvFields(row, inputs, selectedTrack);
          analysis = serializeEv(evFields);
          parlayLegs.push({
            index: i,
            modelProbability: evFields.modelProbability,
            ev: evFields.ev,
            marketImpliedProbability: evFields.marketImpliedProbability,
          });
        }
      }
    }

    legsOut.push({
      index: i,
      playerNameInput: leg.player_name,
      propType: leg.prop_type,
      side: leg.side,
      line: leg.line,
      oddsAmerican: leg.odds_american,
      matchStatus,
      matchedPlayer,
      ambiguousCandidates,
      unmatchedReason,
      propTypeError,
      analysis,
      evSelectedTrack: selectedTrack,
    });
  }

  const parlay = computeParlaySummary({
    legs: parlayLegs,
    totalOddsAmerican: body.total_odds_american ?? null,
    totalOddsDecimal: body.total_odds_decimal ?? null,
  });

  return NextResponse.json({
    meta: {
      date: body.date,
      sportsbook: body.sportsbook ?? null,
      betType: body.bet_type,
      totalOddsAmerican: body.total_odds_american ?? null,
      totalOddsDecimal: body.total_odds_decimal ?? null,
    },
    legs: legsOut,
    parlay,
  });
}
