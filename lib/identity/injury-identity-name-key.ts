/**
 * Suffix-preserving injury identity comparison key (Phase 4C/4D).
 * Diagnostic/candidate matching only — not identity authority by itself.
 *
 * SUFFIX_STRIPPING_SAFE_FOR_IDENTITY = NO
 * Do NOT reuse roster normalizePersonName (strips Jr/Sr/II/III/IV).
 */

const RESOLVER_VERSION = 'official-injury-player-identity-v1' as const;

export const OFFICIAL_INJURY_PLAYER_IDENTITY_RESOLVER_VERSION = RESOLVER_VERSION;

/** Reorder `Last, First` → `First Last`; leave other shapes unchanged. */
export function reorderLastCommaFirst(raw: string): string {
  const s = raw.trim();
  const idx = s.indexOf(',');
  if (idx === -1) return s;
  const last = s.slice(0, idx).trim();
  const first = s.slice(idx + 1).trim();
  if (!last || !first) return s;
  return `${first} ${last}`.trim();
}

function foldUnicode(input: string): string {
  return input.normalize('NFKD').replace(/\p{M}/gu, '');
}

/**
 * injury_identity_name_key — suffix-preserving SAFE_KEY.
 * Preserves Jr/Sr/II/III/IV/V. Does not strip suffixes.
 */
export function injuryIdentityNameKey(raw: string | null | undefined): string {
  const reordered = reorderLastCommaFirst(raw ?? '');
  let s = foldUnicode(reordered).toLowerCase().trim();
  s = s.replace(/[''`]/g, '');
  s = s.replace(/[^a-z0-9\s]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

export function isInjuryIdentityNameKeySafe(nameKey: string): boolean {
  return nameKey.length > 0;
}
