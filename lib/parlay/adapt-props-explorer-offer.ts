/**
 * Source-neutral adapter: one Props Explorer offer → canonical parlay offer.
 * Does not fuzzy-match names, call providers, or replace the selected line
 * with 3-Hour Pre-Tip / consensus / another book.
 *
 * Historical Explorer rows are Decision Close (last pre-tip serving).
 * Live rows are live_current. 3-Hour Pre-Tip is comparison context only.
 */

import {
  PLAYER_PROP_COMPARISON_KIND,
  type CanonicalPropType,
  type PlayerPropComparisonKind,
} from '@/lib/betting/market-movement';
import { parseLineValue, parsePropSide } from '@/lib/betting/prop-market-compare';
import type { PropsMarketContext, PropsServingSource } from '@/lib/betting/props-market-context';
import { known, unknown, withDerivedResolution } from '@/lib/parlay-xray/fields';
import { canonicalizeXrayMarket } from '@/lib/parlay-xray/resolution/market';
import { canonicalizeSportsbook } from '@/lib/parlay-xray/resolution/sportsbook';
import {
  XRAY_CANONICAL_MARKETS,
  type CanonicalParlayLegResolution,
  type XrayResolutionCatalog,
} from '@/lib/parlay-xray/resolution/types';
import {
  XRAY_PROP_KIND_LABEL,
  type ExtractedParlayLeg,
  type ParlayLegSide,
  type XrayPropKind,
} from '@/lib/parlay-xray/types';

export const PARLAY_OFFER_SOURCE_PROPS_EXPLORER = 'props_explorer' as const;
export const PARLAY_OFFER_SOURCE_XRAY = 'xray' as const;
export type ParlayOfferSourceKind =
  | typeof PARLAY_OFFER_SOURCE_PROPS_EXPLORER
  | typeof PARLAY_OFFER_SOURCE_XRAY;
export type ParlayOfferSourceProvenance = 'selected_canonical_offer' | 'xray_confirmed';

export const PARLAY_SNAPSHOT_DECISION_CLOSE = PLAYER_PROP_COMPARISON_KIND;
export const PARLAY_SNAPSHOT_LIVE_CURRENT = 'live_current' as const;
export type ParlayOfferSnapshotKind = PlayerPropComparisonKind;

export const ADAPTER_FAILURE_CODES = [
  'MISSING_PLAYER_ID',
  'MISSING_GAME_ID',
  'UNSUPPORTED_MARKET',
  'MISSING_SIDE',
  'INVALID_LINE',
  'MISSING_SPORTSBOOK',
  'UNSUPPORTED_VENDOR',
  'MISSING_SNAPSHOT_SEMANTICS',
] as const;
export type AdapterFailureCode = (typeof ADAPTER_FAILURE_CODES)[number];

/** Minimal selected-offer contract. Extra keys (e.g. threeHourLine) are ignored. */
export type PropsExplorerOfferInput = {
  playerId?: string | number | null;
  playerName?: string | null;
  gameId?: string | number | null;
  propType?: string | null;
  side?: string | null;
  lineValue?: string | number | null;
  sportsbook?: string | null;
  oddsAmerican?: number | null;
  snapshotAt?: string | Date | null;
  marketContext?: PropsMarketContext | null;
  sourceTable?: PropsServingSource | string | null;
};

export type CanonicalParlayOffer = {
  source: ParlayOfferSourceKind;
  sourceProvenance: ParlayOfferSourceProvenance;
  playerId: string;
  playerDisplayName: string | null;
  gameId: string;
  market: CanonicalPropType;
  side: ParlayLegSide;
  line: number;
  sportsbook: { vendor: string; displayName: string };
  oddsAmerican: number | null;
  snapshotKind: ParlayOfferSnapshotKind;
  snapshotAt: string | null;
  offerIdentity: string;
  wagerIdentity: string;
};

export type AdaptPropsExplorerOfferResult =
  | { ok: true; offer: CanonicalParlayOffer }
  | { ok: false; code: AdapterFailureCode };

const XRAY_MARKET_SET = new Set<string>(XRAY_CANONICAL_MARKETS);

function canonicalId(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return String(value);
  }
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function displayName(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

function snapshotAtIso(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  }
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function oddsMetadata(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value;
}

function asXrayKind(raw: string): XrayPropKind | null {
  const key = raw.trim().toLowerCase();
  if (XRAY_MARKET_SET.has(key)) return key as XrayPropKind;
  return null;
}

function lineToken(line: number): string {
  return String(line);
}

export function canonicalWagerIdentity(input: {
  playerId: string;
  gameId: string;
  market: string;
  side: string;
  line: number;
  sportsbookVendor: string;
}): string {
  return [
    input.playerId,
    input.gameId,
    input.market,
    input.side,
    lineToken(input.line),
    input.sportsbookVendor,
  ].join('|');
}

export function canonicalOfferIdentity(input: {
  source: string;
  snapshotKind: string;
  playerId: string;
  gameId: string;
  market: string;
  side: string;
  line: number;
  sportsbookVendor: string;
}): string {
  return [
    input.source,
    input.snapshotKind,
    canonicalWagerIdentity(input),
  ].join('|');
}

export function canonicalWagerIdentityFromResolution(
  resolution: CanonicalParlayLegResolution
): string | null {
  const playerId = resolution.playerResolution.value?.playerId ?? null;
  const gameId = resolution.gameResolution.value?.gameId ?? null;
  const market = resolution.marketResolution.value?.propType ?? null;
  const side = resolution.sideResolution.value;
  const line = resolution.lineResolution.value;
  const vendor = resolution.sportsbookResolution.value?.vendor ?? null;
  if (!playerId || !gameId || !market || !side || line == null || !vendor) return null;
  return canonicalWagerIdentity({
    playerId,
    gameId,
    market,
    side,
    line,
    sportsbookVendor: vendor,
  });
}

export function deriveOfferSnapshotKind(input: {
  marketContext?: PropsMarketContext | null;
  sourceTable?: string | null;
}): ParlayOfferSnapshotKind | null {
  const context = (input.marketContext ?? '').trim().toLowerCase();
  if (context === 'historical') return PARLAY_SNAPSHOT_DECISION_CLOSE;
  if (context === 'live') return PARLAY_SNAPSHOT_LIVE_CURRENT;

  const table = (input.sourceTable ?? '').trim().toLowerCase();
  if (table === 'research.prop_decision_lines') return PARLAY_SNAPSHOT_DECISION_CLOSE;
  if (table === 'analytics.player_props_current') return PARLAY_SNAPSHOT_LIVE_CURRENT;
  return null;
}

export function adaptPropsExplorerOffer(
  input: PropsExplorerOfferInput
): AdaptPropsExplorerOfferResult {
  const playerId = canonicalId(input.playerId);
  if (!playerId) return { ok: false, code: 'MISSING_PLAYER_ID' };

  const gameId = canonicalId(input.gameId);
  if (!gameId) return { ok: false, code: 'MISSING_GAME_ID' };

  const propRaw = (input.propType ?? '').trim();
  const market = canonicalizeXrayMarket(asXrayKind(propRaw), propRaw || null);
  if (!market.propType) return { ok: false, code: 'UNSUPPORTED_MARKET' };

  const side = parsePropSide(input.side);
  if (!side) return { ok: false, code: 'MISSING_SIDE' };

  const line = parseLineValue(input.lineValue);
  if (line == null) return { ok: false, code: 'INVALID_LINE' };

  const sportsbookRaw = (input.sportsbook ?? '').trim();
  if (!sportsbookRaw) return { ok: false, code: 'MISSING_SPORTSBOOK' };
  const sportsbook = canonicalizeSportsbook(sportsbookRaw);
  if (!sportsbook) return { ok: false, code: 'UNSUPPORTED_VENDOR' };

  const snapshotKind = deriveOfferSnapshotKind({
    marketContext: input.marketContext,
    sourceTable: input.sourceTable,
  });
  if (!snapshotKind) return { ok: false, code: 'MISSING_SNAPSHOT_SEMANTICS' };

  const wagerIdentity = canonicalWagerIdentity({
    playerId,
    gameId,
    market: market.propType,
    side,
    line,
    sportsbookVendor: sportsbook.vendor,
  });
  const offerIdentity = canonicalOfferIdentity({
    source: PARLAY_OFFER_SOURCE_PROPS_EXPLORER,
    snapshotKind,
    playerId,
    gameId,
    market: market.propType,
    side,
    line,
    sportsbookVendor: sportsbook.vendor,
  });

  return {
    ok: true,
    offer: {
      source: PARLAY_OFFER_SOURCE_PROPS_EXPLORER,
      sourceProvenance: 'selected_canonical_offer',
      playerId,
      playerDisplayName: displayName(input.playerName),
      gameId,
      market: market.propType,
      side,
      line,
      sportsbook,
      oddsAmerican: oddsMetadata(input.oddsAmerican),
      snapshotKind,
      snapshotAt: snapshotAtIso(input.snapshotAt),
      offerIdentity,
      wagerIdentity,
    },
  };
}

function emptyTeam() {
  return {
    status: 'UNRESOLVED' as const,
    value: null,
    extracted: null,
    reason: 'MISSING_TEAM',
  };
}

export function toExtractedParlayLeg(offer: CanonicalParlayOffer): ExtractedParlayLeg {
  const kind = offer.market as XrayPropKind;
  return withDerivedResolution({
    id: offer.offerIdentity,
    playerDisplayName: offer.playerDisplayName
      ? known(offer.playerDisplayName)
      : unknown(),
    playerId: known(offer.playerId),
    nbaPlayerId: unknown(),
    teamAbbr: unknown(),
    opponentAbbr: unknown(),
    matchupLabel: unknown(),
    propKind: known(kind),
    propLabel: known(XRAY_PROP_KIND_LABEL[kind] ?? offer.market),
    side: known(offer.side),
    line: known(offer.line),
    oddsAmerican: offer.oddsAmerican != null ? known(offer.oddsAmerican) : unknown(),
    sportsbookText: known(offer.sportsbook.displayName),
    gameDate: unknown(),
    extractionConfidence: known('high'),
    resolution: 'resolved',
    rawSnippet: null,
  });
}

export function toCanonicalParlayLegResolution(
  offer: CanonicalParlayOffer,
  catalog?: XrayResolutionCatalog
): CanonicalParlayLegResolution {
  const playerHit = catalog?.players.find((p) => p.playerId === offer.playerId);
  const gameHit = catalog?.games.find((g) => g.gameId === offer.gameId);
  const originalLeg = toExtractedParlayLeg(offer);

  const playerResolution: CanonicalParlayLegResolution['playerResolution'] = playerHit
    ? {
        status: 'RESOLVED',
        value: {
          playerId: playerHit.playerId,
          entityId: playerHit.entityId,
          displayName: playerHit.displayName,
          nbaPlayerId: playerHit.nbaPlayerId ?? null,
        },
        extracted: offer.playerId,
        reason: null,
        candidates: [
          {
            playerId: playerHit.playerId,
            entityId: playerHit.entityId,
            displayName: playerHit.displayName,
          },
        ],
      }
    : {
        status: 'RESOLVED',
        value: {
          playerId: offer.playerId,
          entityId: null,
          displayName: offer.playerDisplayName ?? offer.playerId,
          nbaPlayerId: null,
        },
        extracted: offer.playerId,
        reason: null,
        candidates: [
          {
            playerId: offer.playerId,
            entityId: null,
            displayName: offer.playerDisplayName ?? offer.playerId,
          },
        ],
      };

  const gameValue = gameHit
    ? {
        gameId: gameHit.gameId,
        startTime: gameHit.startTime,
        homeTeamAbbr: gameHit.homeTeamAbbr,
        awayTeamAbbr: gameHit.awayTeamAbbr,
      }
    : {
        gameId: offer.gameId,
        startTime: '',
        homeTeamAbbr: '',
        awayTeamAbbr: '',
      };

  return {
    originalLeg,
    playerResolution,
    teamResolution: emptyTeam(),
    opponentResolution: emptyTeam(),
    gameResolution: {
      status: 'RESOLVED',
      value: gameValue,
      extracted: offer.gameId,
      reason: null,
      candidates: [gameValue],
    },
    marketResolution: {
      status: 'RESOLVED',
      value: { propType: offer.market },
      extracted: offer.market,
      reason: null,
      unsupported: false,
    },
    sideResolution: {
      status: 'RESOLVED',
      value: offer.side,
      extracted: offer.side,
      reason: null,
    },
    lineResolution: {
      status: 'RESOLVED',
      value: offer.line,
      extracted: offer.line,
      reason: null,
    },
    sportsbookResolution: {
      status: 'RESOLVED',
      value: offer.sportsbook,
      extracted: offer.sportsbook.vendor,
      reason: null,
    },
    overallStatus: 'FULLY_RESOLVED',
    coreResolved: true,
    fullyResolved: true,
  };
}
