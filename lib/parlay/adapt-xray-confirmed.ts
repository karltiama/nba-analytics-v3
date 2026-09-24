/**
 * Confirmed XRay legs → source-neutral Workspace offers.
 * XRay owns OCR, confirmation, and fuzzy canonical resolution.
 * Workspace never receives OCR-only or unconfirmed legs as analyzable identity.
 */

import { extractionCounts } from '@/lib/parlay-xray/fields';
import { resolveCanonicalParlayLegs } from '@/lib/parlay-xray/resolution/resolve-leg';
import type {
  CanonicalParlayLegResolution,
  XrayResolutionCatalog,
  XrayResolutionContext,
} from '@/lib/parlay-xray/resolution/types';
import type { XrayHistoricalReplay } from '@/lib/parlay-xray/session';
import type { ExtractedParlayLeg } from '@/lib/parlay-xray/types';
import {
  PARLAY_OFFER_SOURCE_XRAY,
  PARLAY_SNAPSHOT_DECISION_CLOSE,
  PARLAY_SNAPSHOT_LIVE_CURRENT,
  canonicalOfferIdentity,
  canonicalWagerIdentity,
  type CanonicalParlayOffer,
} from './adapt-props-explorer-offer';

export const XRAY_HANDOFF_FAILURE_CODES = [
  'NOT_CONFIRMED',
  'NEEDS_CONFIRMATION',
  'UNRESOLVED',
  'EMPTY',
  'NO_CATALOG',
  'INVALID_CANONICAL',
] as const;
export type XrayHandoffFailureCode = (typeof XRAY_HANDOFF_FAILURE_CODES)[number];

export type XrayLegProvenance = {
  ocrSnippet: string | null;
  confirmedPlayerName: string | null;
};

export type HandoffConfirmedXrayParlayInput = {
  confirmed: boolean;
  legs: ExtractedParlayLeg[];
  catalog: XrayResolutionCatalog | null;
  historicalReplay: XrayHistoricalReplay | null;
  resolveContext?: XrayResolutionContext;
};

export type XrayHandoffLeg = {
  offer: CanonicalParlayOffer;
  gameLabel: string | null;
  nbaPlayerId?: string | null;
  awayAbbr?: string | null;
  homeAbbr?: string | null;
  xrayProvenance: XrayLegProvenance;
};

export type HandoffConfirmedXrayParlayResult =
  | { ok: true; legs: XrayHandoffLeg[] }
  | { ok: false; code: XrayHandoffFailureCode };

function explicitHistoricalReplay(replay: XrayHistoricalReplay | null): replay is XrayHistoricalReplay & {
  gameId: string;
  cutoffAt: string;
} {
  return Boolean(replay?.gameId && replay?.cutoffAt);
}

function gameLabelFromResolution(resolution: CanonicalParlayLegResolution): string | null {
  const game = resolution.gameResolution.value;
  if (!game?.awayTeamAbbr || !game?.homeTeamAbbr) {
    return resolution.originalLeg.matchupLabel.value ?? null;
  }
  return `${game.awayTeamAbbr} @ ${game.homeTeamAbbr}`;
}

export function adaptConfirmedXrayResolution(
  resolution: CanonicalParlayLegResolution,
  historicalReplay: XrayHistoricalReplay | null
): { ok: true; offer: CanonicalParlayOffer; provenance: XrayLegProvenance } | { ok: false; code: XrayHandoffFailureCode } {
  if (!resolution.fullyResolved) return { ok: false, code: 'UNRESOLVED' };

  const playerId = resolution.playerResolution.value?.playerId ?? null;
  const displayName = resolution.playerResolution.value?.displayName ?? null;
  const gameId = resolution.gameResolution.value?.gameId ?? null;
  const market = resolution.marketResolution.value?.propType ?? null;
  const side = resolution.sideResolution.value;
  const line = resolution.lineResolution.value;
  const sportsbook = resolution.sportsbookResolution.value;
  if (!playerId || !gameId || !market || !side || line == null || !sportsbook) {
    return { ok: false, code: 'INVALID_CANONICAL' };
  }

  const historical = explicitHistoricalReplay(historicalReplay);
  const snapshotKind = historical ? PARLAY_SNAPSHOT_DECISION_CLOSE : PARLAY_SNAPSHOT_LIVE_CURRENT;
  const snapshotAt = historical ? historicalReplay.cutoffAt : null;

  const wagerIdentity = canonicalWagerIdentity({
    playerId,
    gameId,
    market,
    side,
    line,
    sportsbookVendor: sportsbook.vendor,
  });
  const offerIdentity = canonicalOfferIdentity({
    source: PARLAY_OFFER_SOURCE_XRAY,
    snapshotKind,
    playerId,
    gameId,
    market,
    side,
    line,
    sportsbookVendor: sportsbook.vendor,
  });

  const confirmedPlayerName =
    resolution.originalLeg.playerDisplayName.value ?? displayName;

  return {
    ok: true,
    offer: {
      source: PARLAY_OFFER_SOURCE_XRAY,
      sourceProvenance: 'xray_confirmed',
      playerId,
      playerDisplayName: displayName ?? confirmedPlayerName,
      gameId,
      market,
      side,
      line,
      sportsbook,
      oddsAmerican:
        resolution.originalLeg.oddsAmerican.status === 'known'
          ? resolution.originalLeg.oddsAmerican.value
          : null,
      snapshotKind,
      snapshotAt,
      offerIdentity,
      wagerIdentity,
    },
    provenance: {
      ocrSnippet: resolution.originalLeg.rawSnippet,
      confirmedPlayerName,
    },
  };
}

export function handoffConfirmedXrayParlay(
  input: HandoffConfirmedXrayParlayInput
): HandoffConfirmedXrayParlayResult {
  if (!input.confirmed) return { ok: false, code: 'NOT_CONFIRMED' };

  const counts = extractionCounts(input.legs);
  if (counts.detected === 0) return { ok: false, code: 'EMPTY' };
  if (counts.needsConfirmation > 0) return { ok: false, code: 'NEEDS_CONFIRMATION' };
  if (counts.unresolved > 0) return { ok: false, code: 'UNRESOLVED' };
  if (!input.catalog) return { ok: false, code: 'NO_CATALOG' };

  const resolutions = resolveCanonicalParlayLegs(
    input.legs,
    input.catalog,
    input.resolveContext
  );

  const next: XrayHandoffLeg[] = [];
  for (const resolution of resolutions) {
    const adapted = adaptConfirmedXrayResolution(resolution, input.historicalReplay);
    if (!adapted.ok) return { ok: false, code: adapted.code };
    next.push({
      offer: adapted.offer,
      gameLabel: gameLabelFromResolution(resolution),
      nbaPlayerId: resolution.playerResolution.value?.nbaPlayerId ?? null,
      awayAbbr: resolution.gameResolution.value?.awayTeamAbbr?.trim() || null,
      homeAbbr: resolution.gameResolution.value?.homeTeamAbbr?.trim() || null,
      xrayProvenance: adapted.provenance,
    });
  }

  return { ok: true, legs: next };
}

export function shouldShowXrayOcrProvenance(leg: {
  xrayProvenance?: XrayLegProvenance | null;
}): boolean {
  const snippet = (leg.xrayProvenance?.ocrSnippet ?? '').trim();
  const confirmed = (leg.xrayProvenance?.confirmedPlayerName ?? '').trim();
  if (!snippet || !confirmed) return false;
  return !snippet.toLowerCase().includes(confirmed.toLowerCase());
}
