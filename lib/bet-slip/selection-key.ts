/**
 * Sportsbook-independent selection identity for prop-slip v1.
 * Does not include odds or sportsbook vendor (unlike wagerIdentity).
 */

import type { CanonicalPropType } from '@/lib/betting/market-movement';
import type { ParlayLegSide } from '@/lib/parlay-xray/types';
import { BET_SLIP_SPORT_NBA, type BetSlipSport, type CanonicalBetLeg } from './types';

export type SelectionKeyInput = {
  sport?: BetSlipSport;
  gameId: string;
  playerId: string;
  market: CanonicalPropType | string;
  side: ParlayLegSide | string;
  line: number;
};

/**
 * Stable line token for selection keys.
 * Coerces via Number so "28.50" and 28.5 cannot diverge after JSON round-trips.
 * Mirrors wager-identity lineToken (String(finiteNumber)) once normalized.
 */
export function selectionLineToken(line: number): string {
  if (!Number.isFinite(line)) {
    throw new Error('INVALID_LINE');
  }
  return String(Number(line));
}

export function coerceSelectionLine(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Number(raw);
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw.trim());
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function trimId(value: string): string {
  return value.trim();
}

export function canonicalSelectionKey(input: SelectionKeyInput): string {
  const sport = input.sport ?? BET_SLIP_SPORT_NBA;
  const gameId = trimId(input.gameId);
  const playerId = trimId(input.playerId);
  const market = String(input.market).trim().toLowerCase();
  const side = String(input.side).trim().toLowerCase();
  if (!gameId || !playerId || !market || !side) {
    throw new Error('INVALID_SELECTION_KEY_INPUT');
  }
  return [
    sport,
    gameId,
    playerId,
    market,
    side,
    selectionLineToken(input.line),
  ].join('|');
}

export function sameCanonicalSelection(
  a: SelectionKeyInput | CanonicalBetLeg,
  b: SelectionKeyInput | CanonicalBetLeg
): boolean {
  return canonicalSelectionKey(a) === canonicalSelectionKey(b);
}

export function hasCanonicalSelection(
  legs: ReadonlyArray<SelectionKeyInput | CanonicalBetLeg>,
  candidate: SelectionKeyInput | CanonicalBetLeg
): boolean {
  const key = canonicalSelectionKey(candidate);
  return legs.some((leg) => canonicalSelectionKey(leg) === key);
}
