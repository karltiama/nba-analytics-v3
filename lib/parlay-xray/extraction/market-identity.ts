import { known, needsConfirmation, propLabelForKind, unknown } from '@/lib/parlay-xray/fields';
import type { FieldStatus, XrayField, XrayPropKind } from '@/lib/parlay-xray/types';
import type { XrayVisionLeg } from './schema';

function cleanText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const t = value.replace(/\s+/g, ' ').trim();
  return t.length > 0 ? t.slice(0, 80) : null;
}

/**
 * Unambiguous per-token aliases. Longer combo patterns are applied first so
 * PRA is not also counted as points+rebounds+assists independently.
 */
const COMBO_PATTERNS: Array<{ kind: XrayPropKind; re: RegExp }> = [
  { kind: 'points_rebounds_assists', re: /\bpra\b|pts\s*\+\s*reb\s*\+\s*ast|points\s*\+\s*rebounds\s*\+\s*assists/ },
  { kind: 'points_rebounds', re: /\bpts\s*\+\s*reb\b|points\s*\+\s*rebounds|\bpr\b/ },
  { kind: 'rebounds_assists', re: /\breb\s*\+\s*ast\b|rebounds\s*\+\s*assists|\bra\b/ },
  { kind: 'points_assists', re: /\bpts\s*\+\s*ast\b|points\s*\+\s*assists|\bpa\b/ },
];

const SINGLE_PATTERNS: Array<{ kind: XrayPropKind; re: RegExp }> = [
  { kind: 'threes', re: /\b3(?:\s*-?\s*)?(?:pt|pm|pointers?)\s*(?:made)?\b|\bthrees?\b|\bthree\s+pointers?\s*(?:made)?\b|\b3pm\b/ },
  { kind: 'rebounds', re: /\brebounds?\b|\brebs?\b|\bplayer\s+rebounds?\b/ },
  { kind: 'assists', re: /\bassists?\b|\basts?\b|\bplayer\s+assists?\b/ },
  { kind: 'points', re: /\bpoints?\b|\bpts\b|\bplayer\s+points?\b/ },
];

export function marketKindsFromText(text: string | null | undefined): Set<XrayPropKind> {
  const cleaned = cleanText(text);
  const found = new Set<XrayPropKind>();
  if (!cleaned) return found;
  const t = cleaned.toLowerCase();
  for (const { kind, re } of COMBO_PATTERNS) {
    if (re.test(t)) found.add(kind);
  }
  if (found.size > 0) return found;
  for (const { kind, re } of SINGLE_PATTERNS) {
    if (re.test(t)) found.add(kind);
  }
  return found;
}

/** Unique market from a single evidence string, or null if missing/ambiguous. */
export function propKindFromEvidence(text: string | null | undefined): XrayPropKind | null {
  const kinds = marketKindsFromText(text);
  if (kinds.size !== 1) return null;
  return [...kinds][0] ?? null;
}

function uniqueKind(kinds: Set<XrayPropKind>): XrayPropKind | null {
  if (kinds.size !== 1) return null;
  return [...kinds][0] ?? null;
}

function pack(
  kind: XrayPropKind | null,
  status: FieldStatus
): { propKind: XrayField<XrayPropKind>; propLabel: XrayField<string> } {
  if (!kind || status === 'unknown') {
    return { propKind: unknown(), propLabel: unknown() };
  }
  const label = propLabelForKind(kind);
  if (status === 'known') {
    return { propKind: known(kind), propLabel: label ? known(label) : unknown() };
  }
  return {
    propKind: needsConfirmation(kind),
    propLabel: label ? needsConfirmation(label) : unknown(),
  };
}

function confidenceStatus(
  confidence: 'high' | 'medium' | 'low' | null | undefined
): FieldStatus {
  if (confidence === 'medium' || confidence === 'low') return 'needs_confirmation';
  return 'known';
}

/**
 * Market is decided from THIS leg only.
 * Visible evidence/snippet wins. Model/market mismatch cannot stay known.
 * Never reads another leg.
 */
export function resolveLegMarket(leg: Pick<XrayVisionLeg, 'prop_kind' | 'market_evidence' | 'raw_snippet' | 'field_confidence'>): {
  propKind: XrayField<XrayPropKind>;
  propLabel: XrayField<string>;
} {
  const evidenceKinds = marketKindsFromText(leg.market_evidence);
  const snippetKinds = marketKindsFromText(leg.raw_snippet);
  const evidenceKind = uniqueKind(evidenceKinds);
  const snippetKind = uniqueKind(snippetKinds);

  if (evidenceKinds.size > 1 || snippetKinds.size > 1) {
    return pack(null, 'unknown');
  }
  if (evidenceKind && snippetKind && evidenceKind !== snippetKind) {
    return pack(null, 'unknown');
  }

  if (evidenceKind) {
    const status =
      leg.prop_kind && leg.prop_kind !== evidenceKind
        ? 'needs_confirmation'
        : confidenceStatus(leg.field_confidence);
    return pack(evidenceKind, status);
  }
  if (snippetKind) {
    if (leg.prop_kind && leg.prop_kind !== snippetKind) {
      return pack(snippetKind, 'needs_confirmation');
    }
    return pack(snippetKind, confidenceStatus(leg.field_confidence));
  }

  return pack(null, 'unknown');
}
