import { resolvePlayerIdentityFromName } from '@/lib/parlay-xray/resolution/player';
import type { XrayPlayerRecord } from '@/lib/parlay-xray/resolution/types';

export const XRAY_HEADSHOT_MAX_NAMES = 20;

export type HeadshotLookup = {
  extracted: string;
  nbaPlayerId: string | null;
};

export function lookupHeadshotIds(
  names: string[],
  players: XrayPlayerRecord[]
): HeadshotLookup[] {
  const seen = new Set<string>();
  const out: HeadshotLookup[] = [];
  for (const raw of names) {
    const extracted = raw.replace(/\s+/g, ' ').trim();
    if (!extracted || seen.has(extracted.toLowerCase())) continue;
    seen.add(extracted.toLowerCase());
    if (out.length >= XRAY_HEADSHOT_MAX_NAMES) break;
    const resolved = resolvePlayerIdentityFromName(extracted, players);
    const nbaPlayerId =
      resolved.status === 'RESOLVED' ? resolved.value?.nbaPlayerId ?? null : null;
    out.push({ extracted, nbaPlayerId: nbaPlayerId && nbaPlayerId.trim() ? nbaPlayerId : null });
  }
  return out;
}
