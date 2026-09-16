import { displayVendor, isPlayerPropV1Vendor, normalizeVendor } from '@/lib/betting/market-movement';

const BOOK_ALIAS: Record<string, string> = {
  dk: 'draftkings',
  draftking: 'draftkings',
  'draft kings': 'draftkings',
  fd: 'fanduel',
  'fan duel': 'fanduel',
  mgm: 'betmgm',
  'bet mgm': 'betmgm',
  caeser: 'caesars',
  caesar: 'caesars',
};

export function canonicalizeSportsbook(raw: string | null | undefined): {
  vendor: string;
  displayName: string;
} | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  const aliased = BOOK_ALIAS[trimmed.toLowerCase().replace(/\s+/g, ' ')] ?? trimmed;
  const normalized = normalizeVendor(aliased);
  if (!normalized) return null;
  if (!isPlayerPropV1Vendor(normalized.canonical)) return null;
  return {
    vendor: normalized.canonical,
    displayName: displayVendor(normalized.canonical),
  };
}
