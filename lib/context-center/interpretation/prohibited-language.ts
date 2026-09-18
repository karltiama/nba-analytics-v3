/**
 * Prohibited / causal / predictive language scanners for rendered interpretation text.
 * Word-boundary aware to avoid false positives (hot⊂shot, over⊂overall).
 */

/** Frozen design prohibited list (predictive / polarity / psychology / significance). */
export const PROHIBITED_LANGUAGE_TERMS = [
  'likely',
  'will',
  'should',
  'expected to',
  'expected to score',
  'favorable',
  'unfavorable',
  'good matchup',
  'bad matchup',
  'edge',
  'advantage',
  'boost',
  'hurt',
  'upside',
  'downside',
  'over',
  'under',
  'lock',
  'best bet',
  'hot',
  'cold',
  'on fire',
  'slumping',
  'trending',
  'elite',
  'weak defense',
  'strong defense',
  'poor defense',
  'well rested',
  'fresh',
  'tired',
  'fatigued',
  'confidence',
  'rhythm',
  'momentum',
  'aggressive',
  'passive',
  'locked in',
  'struggling',
  'significant',
  'meaningful',
  'major',
  'substantial',
  'material',
] as const;

export const CAUSAL_LANGUAGE_TERMS = [
  'because',
  'therefore',
  'causes',
  'caused',
  'leads to',
  'will lead to',
  'results in',
  'due to',
] as const;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function termPattern(term: string): RegExp {
  const parts = term.trim().split(/\s+/).map(escapeRegExp);
  const body = parts.join('\\s+');
  return new RegExp(`(?<![a-zA-Z])${body}(?![a-zA-Z])`, 'i');
}

export type LanguageHit = { term: string; index: number };

export function scanProhibitedLanguage(text: string): LanguageHit[] {
  const hits: LanguageHit[] = [];
  for (const term of PROHIBITED_LANGUAGE_TERMS) {
    const m = termPattern(term).exec(text);
    if (m && m.index != null) {
      hits.push({ term, index: m.index });
    }
  }
  return hits;
}

export function scanCausalLanguage(text: string): LanguageHit[] {
  const hits: LanguageHit[] = [];
  for (const term of CAUSAL_LANGUAGE_TERMS) {
    const m = termPattern(term).exec(text);
    if (m && m.index != null) {
      hits.push({ term, index: m.index });
    }
  }
  return hits;
}

export function assertSafeRenderedText(text: string): void {
  const prohibited = scanProhibitedLanguage(text);
  if (prohibited.length > 0) {
    throw new Error(
      `Prohibited language in rendered interpretation: ${prohibited.map((h) => h.term).join(', ')}`
    );
  }
  const causal = scanCausalLanguage(text);
  if (causal.length > 0) {
    throw new Error(
      `Causal language in rendered interpretation: ${causal.map((h) => h.term).join(', ')}`
    );
  }
}
