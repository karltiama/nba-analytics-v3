/**
 * Turns one display-ready Quick Builds leg into a research-snapshot offer.
 * Pure: no React, no database, and no current-price lookup.
 */

import { normalizeGameStatus } from '@/lib/betting/normalize-game-status';
import { parseLineValue, parsePropSide } from '@/lib/betting/prop-market-compare';
import { quickBuildGameStartLine } from '@/lib/quick-builds/format-et';
import { usableAmerican } from '@/lib/quick-builds/markets';
import { canonicalizeXrayMarket } from '@/lib/parlay-xray/resolution/market';
import { canonicalizeSportsbook } from '@/lib/parlay-xray/resolution/sportsbook';
import { XRAY_CANONICAL_MARKETS } from '@/lib/parlay-xray/resolution/types';
import type { XrayPropKind } from '@/lib/parlay-xray/types';
import {
  canonicalOfferIdentity,
  canonicalWagerIdentity,
  PARLAY_OFFER_SOURCE_QUICK_BUILD,
  PARLAY_SNAPSHOT_RESEARCH,
  type CanonicalParlayOffer,
} from './adapt-props-explorer-offer';
import type { SelectedParlayLeg } from './selection';

export const QUICK_BUILD_HANDOFF_CODES = [
  'NOT_DISPLAY_READY',
  'MISSING_PLAYER_ID',
  'INVALID_PLAYER_NAME',
  'MISSING_GAME_ID',
  'UNSUPPORTED_MARKET',
  'MISSING_SIDE',
  'INVALID_LINE',
  'UNSUPPORTED_BOOK',
  'INVALID_PRICE',
  'MISSING_OBSERVED_AT',
  'MISSING_GAME_START',
  'DUPLICATE_LEG',
] as const;

export type QuickBuildHandoffCode = (typeof QUICK_BUILD_HANDOFF_CODES)[number];

export type QuickBuildHandoffLeg = {
  displayReady: boolean;
  playerId: string;
  playerName: string | null;
  gameId: string;
  market: string;
  side: string;
  line: number;
  sportsbook: string;
  oddsAmerican: number;
  observedAt: string | null;
  gameStartTime: string | null;
  gameStatus: string | null;
};

export type AdaptQuickBuildLegResult =
  | { ok: true; leg: SelectedParlayLeg }
  | { ok: false; code: QuickBuildHandoffCode };

export type QuickBuildHandoffLegs =
  | readonly [QuickBuildHandoffLeg, QuickBuildHandoffLeg]
  | readonly [QuickBuildHandoffLeg, QuickBuildHandoffLeg, QuickBuildHandoffLeg]
  | readonly [QuickBuildHandoffLeg, QuickBuildHandoffLeg, QuickBuildHandoffLeg, QuickBuildHandoffLeg]
  | readonly [
      QuickBuildHandoffLeg,
      QuickBuildHandoffLeg,
      QuickBuildHandoffLeg,
      QuickBuildHandoffLeg,
      QuickBuildHandoffLeg,
    ];

export type QuickBuildHandoffResult =
  | { status: 'replaced'; legs: [SelectedParlayLeg, SelectedParlayLeg] }
  | { status: 'needs_confirmation' }
  | { status: 'tipped' }
  | { status: 'rejected'; code: QuickBuildHandoffCode };

type SelectedBuildLegs =
  | [SelectedParlayLeg, SelectedParlayLeg]
  | [SelectedParlayLeg, SelectedParlayLeg, SelectedParlayLeg]
  | [SelectedParlayLeg, SelectedParlayLeg, SelectedParlayLeg, SelectedParlayLeg]
  | [SelectedParlayLeg, SelectedParlayLeg, SelectedParlayLeg, SelectedParlayLeg, SelectedParlayLeg];

export type QuickBuildSelectionHandoffResult =
  | { status: 'replaced'; legs: SelectedBuildLegs }
  | { status: 'needs_confirmation' }
  | { status: 'tipped' }
  | { status: 'rejected'; code: QuickBuildHandoffCode };

const XRAY_MARKET_SET = new Set<string>(XRAY_CANONICAL_MARKETS);
const STARTED_STATUSES = new Set(['In Progress', 'Final', 'Postponed', 'Canceled']);

export function adaptQuickBuildLeg(input: QuickBuildHandoffLeg): AdaptQuickBuildLegResult {
  if (input.displayReady !== true) return { ok: false, code: 'NOT_DISPLAY_READY' };

  const playerId = canonicalId(input.playerId);
  if (!playerId) return { ok: false, code: 'MISSING_PLAYER_ID' };

  const playerName = verifiedPlayerName(input.playerName, playerId);
  if (!playerName) return { ok: false, code: 'INVALID_PLAYER_NAME' };

  const gameId = canonicalId(input.gameId);
  if (!gameId) return { ok: false, code: 'MISSING_GAME_ID' };

  const marketRaw = input.market.trim();
  const market = canonicalizeXrayMarket(asXrayKind(marketRaw), marketRaw || null);
  if (!market.propType) return { ok: false, code: 'UNSUPPORTED_MARKET' };

  const side = parsePropSide(input.side);
  if (!side) return { ok: false, code: 'MISSING_SIDE' };

  const line = parseLineValue(input.line);
  if (line == null) return { ok: false, code: 'INVALID_LINE' };

  const sportsbook = canonicalizeSportsbook(input.sportsbook);
  if (!sportsbook) return { ok: false, code: 'UNSUPPORTED_BOOK' };

  const oddsAmerican = usableAmerican(input.oddsAmerican);
  if (oddsAmerican == null) return { ok: false, code: 'INVALID_PRICE' };

  const observedAt = observedTimestamp(input.observedAt);
  if (!observedAt) return { ok: false, code: 'MISSING_OBSERVED_AT' };

  const offer: CanonicalParlayOffer = {
    source: PARLAY_OFFER_SOURCE_QUICK_BUILD,
    sourceProvenance: 'quick_build_research_snapshot',
    playerId,
    playerDisplayName: playerName,
    gameId,
    market: market.propType,
    side,
    line,
    sportsbook,
    oddsAmerican,
    snapshotKind: PARLAY_SNAPSHOT_RESEARCH,
    snapshotAt: observedAt,
    wagerIdentity: canonicalWagerIdentity({
      playerId,
      gameId,
      market: market.propType,
      side,
      line,
      sportsbookVendor: sportsbook.vendor,
    }),
    offerIdentity: '',
  };
  offer.offerIdentity = canonicalOfferIdentity({
    source: offer.source,
    snapshotKind: offer.snapshotKind,
    playerId,
    gameId,
    market: offer.market,
    side,
    line,
    sportsbookVendor: sportsbook.vendor,
  });

  return {
    ok: true,
    leg: {
      offer,
      gameLabel: quickBuildGameStartLine(input.gameStartTime),
      awayAbbr: null,
      homeAbbr: null,
    },
  };
}

/**
 * Structural pair check. Does not read the clock and does not mutate a selection.
 * A true result is necessary before a card may offer Use This Build.
 */
export function assessQuickBuildPair(
  legs: readonly [QuickBuildHandoffLeg, QuickBuildHandoffLeg],
): { ok: true; legs: [SelectedParlayLeg, SelectedParlayLeg] } | { ok: false; code: QuickBuildHandoffCode } {
  const assessed = assessQuickBuildSelection(legs);
  if (!assessed.ok) return assessed;
  return { ok: true, legs: [assessed.legs[0], assessed.legs[1]] };
}

/** Validates every leg before any replacement. One failure rejects the whole build. */
export function assessQuickBuildSelection(
  legs: QuickBuildHandoffLegs,
): { ok: true; legs: SelectedBuildLegs } | { ok: false; code: QuickBuildHandoffCode } {
  const adapted = legs.map((leg) => adaptQuickBuildLeg(leg));
  for (const result of adapted) {
    if (!result.ok) return result;
  }
  const ready = adapted.map((result) => (result.ok ? result.leg : null));
  const identities = new Set<string>();
  const players = new Set<string>();
  for (const leg of ready) {
    if (leg == null) return { ok: false, code: 'NOT_DISPLAY_READY' };
    if (players.has(leg.offer.playerId) || identities.has(leg.offer.wagerIdentity)) {
      return { ok: false, code: 'DUPLICATE_LEG' };
    }
    players.add(leg.offer.playerId);
    identities.add(leg.offer.wagerIdentity);
  }
  if (!gameStarts(legs)) return { ok: false, code: 'MISSING_GAME_START' };
  if (legs.length === 5) return { ok: true, legs: [ready[0]!, ready[1]!, ready[2]!, ready[3]!, ready[4]!] };
  if (legs.length === 4) return { ok: true, legs: [ready[0]!, ready[1]!, ready[2]!, ready[3]!] };
  if (legs.length === 3) return { ok: true, legs: [ready[0]!, ready[1]!, ready[2]!] };
  return { ok: true, legs: [ready[0]!, ready[1]!] };
}

/**
 * Validates both legs before describing a replacement.
 * Does not mutate the current selection. A non-empty slip returns
 * needs_confirmation until the caller passes confirmed.
 * The tip check uses nowMs again on every call, including confirmation.
 */
export function handoffQuickBuild(input: {
  current: readonly SelectedParlayLeg[];
  legs: readonly [QuickBuildHandoffLeg, QuickBuildHandoffLeg];
  nowMs: number;
  confirmed: boolean;
}): QuickBuildHandoffResult {
  const result = handoffQuickBuildSelection(input);
  if (result.status !== 'replaced') return result;
  return { status: 'replaced', legs: [result.legs[0], result.legs[1]] };
}

/** Same replacement rules as the two-leg handoff, for either two or three legs. */
export function handoffQuickBuildSelection(input: {
  current: readonly SelectedParlayLeg[];
  legs: QuickBuildHandoffLegs;
  nowMs: number;
  confirmed: boolean;
}): QuickBuildSelectionHandoffResult {
  const assessed = assessQuickBuildSelection(input.legs);
  if (!assessed.ok) return { status: 'rejected', code: assessed.code };

  const start = gameStarts(input.legs);
  if (!start) return { status: 'rejected', code: 'MISSING_GAME_START' };
  if (start.some((game) => gameHasTipped(game.startMs, game.status, input.nowMs))) {
    return { status: 'tipped' };
  }

  if (input.current.length > 0 && !input.confirmed) return { status: 'needs_confirmation' };
  return { status: 'replaced', legs: assessed.legs };
}

function canonicalId(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function verifiedPlayerName(value: string | null, playerId: string): string | null {
  const name = (value ?? '').trim();
  if (!name || name === playerId || /^\d+$/.test(name)) return null;
  return name;
}

function observedTimestamp(value: string | null): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed || !Number.isFinite(Date.parse(trimmed))) return null;
  return trimmed;
}

function asXrayKind(raw: string): XrayPropKind | null {
  const key = raw.trim().toLowerCase();
  return XRAY_MARKET_SET.has(key) ? (key as XrayPropKind) : null;
}

function gameStarts(
  legs: readonly QuickBuildHandoffLeg[]
): { startMs: number; status: string | null }[] | null {
  const starts = legs.map((leg) => {
    const startMs = Date.parse((leg.gameStartTime ?? '').trim());
    return Number.isFinite(startMs) ? { startMs, status: leg.gameStatus } : null;
  });
  if (starts.some((start) => start == null)) return null;
  return starts as { startMs: number; status: string | null }[];
}

function gameHasTipped(startMs: number, status: string | null, nowMs: number): boolean {
  if (STARTED_STATUSES.has(normalizeGameStatus(status))) return true;
  return startMs <= nowMs;
}
