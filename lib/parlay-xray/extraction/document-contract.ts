import { XRAY_EXTRACT_MESSAGE, XRAY_NON_SLIP_MESSAGE } from './copy';
import { isPromoOnlyLabel, mapVisionOutput, resultFromLegs } from './map-legs';
import type { ExtractedParlayLeg } from '@/lib/parlay-xray/types';
import type { XrayExtractResult } from './result-codes';
import { xrayVisionOutputSchema, type XrayVisionOutput } from './schema';

export type ContractedExtraction =
  | { ok: true; legs: ExtractedParlayLeg[]; result: XrayExtractResult; message: string }
  | { ok: false; reason: 'malformed' };

const WAGER_CUE =
  /\b(over|under|parlay|bet\s*slip|straight\s*bet|same\s*game|sgp|moneyline|spread|odds|payout|wager|to\s*win|potential\s+(?:win|payout)|american\s*odds|decimal\s*odds|selections?)\b|\b[ou]\b|[+-]\d{2,}/i;

export function hasVisibleWageringEvidence(output: XrayVisionOutput): boolean {
  if (output.wager_evidence && WAGER_CUE.test(output.wager_evidence)) return true;
  return output.legs.some((leg) => {
    if (leg.side_evidence && WAGER_CUE.test(leg.side_evidence)) return true;
    if (leg.odds_evidence && WAGER_CUE.test(leg.odds_evidence)) return true;
    if (leg.raw_snippet && WAGER_CUE.test(leg.raw_snippet)) return true;
    return false;
  });
}

function refuseNonSlip(): Extract<ContractedExtraction, { ok: true }> {
  return {
    ok: true,
    legs: [],
    result: 'NO_LEGS_FOUND',
    message: XRAY_NON_SLIP_MESSAGE,
  };
}

/**
 * Deterministic application contract after a provider structured response.
 * Does not call a second model. Drops legs for non-slips even if the model invented them.
 */
export function applyXrayExtractionContract(
  output: unknown,
  idFactory: () => string
): ContractedExtraction {
  const parsed = xrayVisionOutputSchema.safeParse(output);
  if (!parsed.success) return { ok: false, reason: 'malformed' };
  const data = parsed.data;

  if (data.document_type === 'NOT_BET_SLIP' || data.document_type === 'UNCERTAIN') {
    return refuseNonSlip();
  }
  if (data.document_type !== 'BET_SLIP') {
    return { ok: false, reason: 'malformed' };
  }
  if (!hasVisibleWageringEvidence(data)) {
    return refuseNonSlip();
  }

  const filtered = { ...data, legs: data.legs.filter((leg) => !isPromoOnlyLabel(leg.player_name)) };
  const legs = mapVisionOutput(filtered, idFactory);
  const result = resultFromLegs(legs, data.image_quality);
  return {
    ok: true,
    legs,
    result,
    message: XRAY_EXTRACT_MESSAGE[result],
  };
}
