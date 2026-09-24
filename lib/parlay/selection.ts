/**
 * Transient parlay selection shared by Props Explorer and confirmed XRay.
 * In-memory only. Does not analyze, persist, or fetch.
 */

import { XRAY_PROP_KIND_LABEL, type XrayPropKind } from '@/lib/parlay-xray/types';
import {
  adaptPropsExplorerOffer,
  type AdapterFailureCode,
  type CanonicalParlayOffer,
  type ParlayOfferSnapshotKind,
  type ParlayOfferSourceKind,
  type PropsExplorerOfferInput,
} from './adapt-props-explorer-offer';
import type { XrayLegProvenance } from './adapt-xray-confirmed';

export const PARLAY_WORKSPACE_HREF = '/parlay-workspace';
export const PROPS_EXPLORER_HREF = '/betting/props-explorer';

/** Light source-neutral container. No persistence id. */
export type CanonicalParlaySelectionSourceContext = ParlayOfferSourceKind | 'mixed';

export type CanonicalParlaySelection = {
  legs: SelectedParlayLeg[];
  sourceContext: CanonicalParlaySelectionSourceContext;
};

export type CanonicalSelectionStructure = ParlaySelectionPreview & {
  legCount: number;
  samePlayerLegCount: number;
  sameGameLegCount: number;
};

/** Temporary runtime ceiling matching XRay structural scale tests. Not product policy. */
export const PARLAY_SELECTION_SOFT_CAP = 12;

/** Display-only fields for tray / workspace chrome. Not part of wager identity. */
export type SelectedParlayLegDisplay = {
  gameLabel?: string | null;
  nbaPlayerId?: string | null;
  awayAbbr?: string | null;
  homeAbbr?: string | null;
};

export type SelectedParlayLeg = {
  offer: CanonicalParlayOffer;
  gameLabel: string | null;
  nbaPlayerId?: string | null;
  awayAbbr?: string | null;
  homeAbbr?: string | null;
  xrayProvenance?: XrayLegProvenance | null;
};

function trimOrNull(value: string | null | undefined): string | null {
  const t = value?.trim();
  return t ? t : null;
}

export type AddExplorerOfferResult =
  | { status: 'added'; legs: SelectedParlayLeg[] }
  | { status: 'duplicate'; legs: SelectedParlayLeg[] }
  | { status: 'rejected'; legs: SelectedParlayLeg[]; code: AdapterFailureCode }
  | { status: 'cap'; legs: SelectedParlayLeg[] };

export type ParlaySelectionPreview = {
  samePlayer: boolean;
  sameGame: boolean;
  summary: string;
  labels: string[];
};

export const ADAPTER_ADD_COPY: Record<AdapterFailureCode, string> = {
  MISSING_PLAYER_ID: 'This offer is missing a player and cannot be added.',
  MISSING_GAME_ID: 'This offer is missing a game and cannot be added.',
  UNSUPPORTED_MARKET: 'This market is not supported for parlays yet.',
  MISSING_SIDE: 'This offer is missing Over/Under and cannot be added.',
  INVALID_LINE: 'This offer is missing a line and cannot be added.',
  MISSING_SPORTSBOOK: 'This offer is missing a sportsbook and cannot be added.',
  UNSUPPORTED_VENDOR: 'This sportsbook is not supported for parlays yet.',
  MISSING_SNAPSHOT_SEMANTICS: 'This offer is missing snapshot context and cannot be added.',
};

export function emptyParlaySelection(): SelectedParlayLeg[] {
  return [];
}

export function addExplorerOfferToSelection(
  legs: SelectedParlayLeg[],
  input: PropsExplorerOfferInput,
  display?: SelectedParlayLegDisplay
): AddExplorerOfferResult {
  const adapted = adaptPropsExplorerOffer(input);
  if (!adapted.ok) return { status: 'rejected', legs, code: adapted.code };

  if (legs.some((leg) => leg.offer.wagerIdentity === adapted.offer.wagerIdentity)) {
    return { status: 'duplicate', legs };
  }

  if (legs.length >= PARLAY_SELECTION_SOFT_CAP) {
    return { status: 'cap', legs };
  }

  const next: SelectedParlayLeg = {
    offer: adapted.offer,
    gameLabel: trimOrNull(display?.gameLabel),
    nbaPlayerId: trimOrNull(display?.nbaPlayerId),
    awayAbbr: trimOrNull(display?.awayAbbr),
    homeAbbr: trimOrNull(display?.homeAbbr),
  };
  return { status: 'added', legs: [...legs, next] };
}

export function removeSelectedLeg(
  legs: SelectedParlayLeg[],
  offerIdentity: string
): SelectedParlayLeg[] {
  return legs.filter((leg) => leg.offer.offerIdentity !== offerIdentity);
}

export function clearSelectedLegs(): SelectedParlayLeg[] {
  return [];
}

export function isOfferSelected(
  legs: SelectedParlayLeg[],
  input: PropsExplorerOfferInput
): boolean {
  const adapted = adaptPropsExplorerOffer(input);
  if (!adapted.ok) return false;
  return legs.some((leg) => leg.offer.wagerIdentity === adapted.offer.wagerIdentity);
}

export function marketDisplayLabel(market: CanonicalParlayOffer['market']): string {
  if (Object.prototype.hasOwnProperty.call(XRAY_PROP_KIND_LABEL, market)) {
    return XRAY_PROP_KIND_LABEL[market as XrayPropKind];
  }
  return market.replace(/_/g, ' ');
}

export function previewParlaySelection(legs: SelectedParlayLeg[]): ParlaySelectionPreview {
  const playerCounts = new Map<string, number>();
  const gameCounts = new Map<string, number>();
  for (const leg of legs) {
    playerCounts.set(leg.offer.playerId, (playerCounts.get(leg.offer.playerId) ?? 0) + 1);
    gameCounts.set(leg.offer.gameId, (gameCounts.get(leg.offer.gameId) ?? 0) + 1);
  }
  const samePlayer = [...playerCounts.values()].some((n) => n >= 2);
  const sameGame = [...gameCounts.values()].some((n) => n >= 2);
  const labels: string[] = [];
  if (samePlayer) labels.push('Same player');
  if (sameGame) labels.push('Same game');

  let summary = legs.length === 0 ? '' : `${legs.length} leg${legs.length === 1 ? '' : 's'} selected`;
  if (legs.length > 0 && gameCounts.size === 1) {
    const label = legs.find((leg) => leg.gameLabel)?.gameLabel;
    if (label) summary = `${legs.length} leg${legs.length === 1 ? '' : 's'} · ${label}`;
  }

  return { samePlayer, sameGame, summary, labels };
}

export function addResultNotice(result: AddExplorerOfferResult): string {
  if (result.status === 'added') {
    return result.legs.length === 1 ? 'Added to parlay' : `${result.legs.length} legs selected`;
  }
  if (result.status === 'duplicate') return 'Already added';
  if (result.status === 'cap') {
    return `Parlay is at the ${PARLAY_SELECTION_SOFT_CAP}-leg development ceiling`;
  }
  return ADAPTER_ADD_COPY[result.code];
}

export function snapshotDisplayLabel(kind: ParlayOfferSnapshotKind): string {
  if (kind === 'decision_close') return 'Decision Close';
  if (kind === 'live_current') return 'Current';
  if (kind === 'shared_snapshot') return 'Shared snapshot';
  return kind;
}

/** First occurrence of each wagerIdentity wins. Source provenance does not create a second wager. */
export function dedupeSelectedLegs(legs: SelectedParlayLeg[]): SelectedParlayLeg[] {
  const seen = new Set<string>();
  const next: SelectedParlayLeg[] = [];
  for (const leg of legs) {
    const id = leg.offer.wagerIdentity;
    if (seen.has(id)) continue;
    seen.add(id);
    next.push(leg);
  }
  return next;
}

export function selectionSourceContext(legs: SelectedParlayLeg[]): CanonicalParlaySelectionSourceContext {
  const sources = new Set(legs.map((leg) => leg.offer.source));
  if (sources.size === 0) return 'props_explorer';
  if (sources.size > 1) return 'mixed';
  return [...sources][0]!;
}

export function workspaceSourceLabel(legs: SelectedParlayLeg[]): string | null {
  if (legs.length === 0) return null;
  const context = selectionSourceContext(legs);
  if (context === 'xray') return 'Imported from Parlay XRay';
  if (context === 'props_explorer') return 'Built from Props Explorer';
  if (context === 'shared_slip') return 'Loaded from a shared slip';
  if (context === 'mixed') {
    const sources = new Set(legs.map((leg) => leg.offer.source));
    if (sources.has('shared_slip')) return 'Includes legs from a shared slip';
    return 'Combined from Parlay XRay and Props Explorer';
  }
  return 'Combined from Parlay XRay and Props Explorer';
}

export function canonicalParlaySelectionFromLegs(
  legs: SelectedParlayLeg[]
): CanonicalParlaySelection {
  const unique = dedupeSelectedLegs(legs);
  return {
    legs: unique,
    sourceContext: selectionSourceContext(unique),
  };
}

export function summarizeCanonicalSelection(legs: SelectedParlayLeg[]): CanonicalSelectionStructure {
  const preview = previewParlaySelection(legs);
  const playerCounts = new Map<string, number>();
  const gameCounts = new Map<string, number>();
  for (const leg of legs) {
    playerCounts.set(leg.offer.playerId, (playerCounts.get(leg.offer.playerId) ?? 0) + 1);
    gameCounts.set(leg.offer.gameId, (gameCounts.get(leg.offer.gameId) ?? 0) + 1);
  }
  let samePlayerLegCount = 0;
  for (const n of playerCounts.values()) {
    if (n >= 2) samePlayerLegCount += n;
  }
  let sameGameLegCount = 0;
  for (const n of gameCounts.values()) {
    if (n >= 2) sameGameLegCount += n;
  }
  return {
    ...preview,
    legCount: legs.length,
    samePlayerLegCount,
    sameGameLegCount,
  };
}
