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
  // Drop apostrophes without inserting spaces (Nah'Shon → nahshon).
  s = s.replace(/['’]/g, '');
  s = s.replace(/[^a-z0-9\s]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  // Collapse spaced initials: "a j green" / "k j simpson" → "aj green" / "kj simpson"
  // so "A.J. Green" and "AJ Green" match after punctuation stripping.
  let prev = '';
  while (s !== prev) {
    prev = s;
    s = s.replace(/\b([a-z])\s+(?=[a-z]\b)/g, '$1');
  }
  return s;
}

export function namesLooselyEqual(a: string, b: string): boolean {
  return normalizePersonName(a) === normalizePersonName(b);
}
