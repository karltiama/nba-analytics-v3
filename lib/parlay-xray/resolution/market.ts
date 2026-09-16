import {
  canonicalizePropType,
  type CanonicalPropType,
} from '@/lib/betting/market-movement';
import type { XrayPropKind } from '@/lib/parlay-xray/types';
import { XRAY_CANONICAL_MARKETS } from './types';

const LOCAL_ALIAS: Record<string, CanonicalPropType> = {
  '3pm': 'threes',
  '3_pm': 'threes',
  '3p': 'threes',
  '3_pointers': 'threes',
  '3_pointers_made': 'threes',
  '3-pointers_made': 'threes',
  three_pointers_made: 'threes',
  threes: 'threes',
  rebs: 'rebounds',
  asts: 'assists',
  pts: 'points',
  reb: 'rebounds',
  ast: 'assists',
  pra: 'points_rebounds_assists',
  pr: 'points_rebounds',
  pa: 'points_assists',
  ra: 'rebounds_assists',
};

const XRAY_SET = new Set<string>(XRAY_CANONICAL_MARKETS);

function keyOf(raw: string): string {
  return raw.trim().toLowerCase().replace(/[+]/g, ' ').replace(/\s+/g, '_');
}

export function canonicalizeXrayMarket(
  propKind: XrayPropKind | null | undefined,
  propLabel: string | null | undefined
): { propType: CanonicalPropType | null; unsupported: boolean; reason: string | null } {
  if (propKind && propKind !== 'other' && XRAY_SET.has(propKind)) {
    return { propType: propKind, unsupported: false, reason: null };
  }

  const label = propLabel?.trim() ?? '';
  if (label) {
    const fromCanonical = canonicalizePropType(label);
    if (fromCanonical && XRAY_SET.has(fromCanonical)) {
      return { propType: fromCanonical, unsupported: false, reason: null };
    }
    const local = LOCAL_ALIAS[keyOf(label)];
    if (local && XRAY_SET.has(local)) {
      return { propType: local, unsupported: false, reason: null };
    }
    if (fromCanonical && !XRAY_SET.has(fromCanonical)) {
      return { propType: null, unsupported: true, reason: 'UNSUPPORTED_MARKET' };
    }
  }

  if (propKind === 'other') {
    return { propType: null, unsupported: true, reason: 'UNSUPPORTED_MARKET' };
  }

  return { propType: null, unsupported: false, reason: 'UNKNOWN_MARKET' };
}
