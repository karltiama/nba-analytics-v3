/**
 * Roster identity name normalization (pure).
 * Used for safe fallback matching only — never alone when >1 candidate.
 */

const SUFFIX_RE =
  /\b(?:jr\.?|sr\.?|ii|iii|iv|v)\b/gi;

export function stripDiacritics(input: string): string {
  return input.normalize('NFD').replace(/\p{M}/gu, '');
}

/**
 * Normalize a person name for equality checks:
 * - Unicode/diacritic fold
 * - lower-case
 * - drop Jr/Sr/II/III/IV suffixes
 * - drop punctuation
 * - collapse whitespace
 */
export function normalizePersonName(input: string): string {
  let s = stripDiacritics(input).toLowerCase().trim();
  s = s.replace(SUFFIX_RE, ' ');
  s = s.replace(/[^a-z0-9\s]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

export function namesLooselyEqual(a: string, b: string): boolean {
  return normalizePersonName(a) === normalizePersonName(b);
}
