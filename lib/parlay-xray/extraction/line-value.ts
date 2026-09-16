/**
 * Vision JSON often truncates half-point lines (8 instead of 8.5).
 * Recover the visible decimal only from quoted slip text. Do not invent .5.
 */

import { needsConfirmation, withDerivedResolution } from '@/lib/parlay-xray/fields';
import type { ExtractedParlayLeg, XrayPropKind } from '@/lib/parlay-xray/types';

const HALF_POINT_PROP: ReadonlySet<XrayPropKind> = new Set([
  'points',
  'rebounds',
  'assists',
  'threes',
  'points_rebounds_assists',
  'points_assists',
  'points_rebounds',
  'rebounds_assists',
]);

function normalizeDecimalText(text: string): string {
  return text.replace(/(\d)[,，٫·∙⋅․‧．](\d)/g, '$1.$2');
}

function visibleLineNumbers(text: string | null | undefined): number[] {
  if (!text) return [];
  const normalized = normalizeDecimalText(text);
  const out: number[] = [];
  const re = /(?<![+\-\d.])(\d+(?:\.\d+)?)(?![\d.])/g;
  let match: RegExpExecArray | null = re.exec(normalized);
  while (match) {
    const n = Number(match[1]);
    if (Number.isFinite(n)) out.push(n);
    match = re.exec(normalized);
  }
  return out;
}

function uniqueHalfPointForInteger(integer: number, nums: number[]): number | null {
  const plus = [...new Set(nums.filter((n) => n === integer + 0.5))];
  const minus = [...new Set(nums.filter((n) => n === integer - 0.5))];
  if (plus.length === 1 && minus.length === 0) return plus[0]!;
  if (minus.length === 1 && plus.length === 0) return minus[0]!;
  return null;
}

export type RecoveredExtractedLine = {
  value: number | null;
  /** True when the decimal came from snippet, not line_evidence. */
  confirm: boolean;
};

export function recoverExtractedLine(
  value: number | null | undefined,
  evidence: string | null | undefined,
  snippet: string | null | undefined
): RecoveredExtractedLine {
  const numeric = value != null && Number.isFinite(value) ? value : null;
  if (numeric != null && !Number.isInteger(numeric)) {
    return { value: numeric, confirm: false };
  }

  const evidenceNums = visibleLineNumbers(evidence);
  if (numeric != null && Number.isInteger(numeric)) {
    const fromEvidence = uniqueHalfPointForInteger(numeric, evidenceNums);
    if (fromEvidence != null) return { value: fromEvidence, confirm: false };
    const fromSnippet = uniqueHalfPointForInteger(numeric, visibleLineNumbers(snippet));
    if (fromSnippet != null) return { value: fromSnippet, confirm: true };
    return { value: numeric, confirm: false };
  }

  const evidenceDecimals = [...new Set(evidenceNums.filter((n) => !Number.isInteger(n)))];
  if (evidenceDecimals.length === 1) return { value: evidenceDecimals[0]!, confirm: false };
  if (evidenceNums.length === 1) return { value: evidenceNums[0]!, confirm: false };
  return { value: null, confirm: false };
}

export function parseJsonLine(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  const recovered = recoverExtractedLine(null, raw, raw);
  if (recovered.value != null) return recovered.value;
  const n = Number(normalizeDecimalText(raw.trim()));
  return Number.isFinite(n) ? n : null;
}

export function formatXrayPropLine(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return String(value);
}

export function isWholeNumberPlayerPropLine(leg: ExtractedParlayLeg): boolean {
  const value = leg.line.value;
  if (value == null || !Number.isFinite(value) || !Number.isInteger(value)) return false;
  if (value <= 0 || value >= 80) return false;
  const side = leg.side.value;
  const kind = leg.propKind.value;
  if (side !== 'over' && side !== 'under') return false;
  if (kind == null || kind === 'other') return false;
  return HALF_POINT_PROP.has(kind);
}

export function recoverLineOnExtractedLeg(leg: ExtractedParlayLeg): ExtractedParlayLeg {
  const recovered = recoverExtractedLine(leg.line.value, null, leg.rawSnippet);
  let next = leg;
  if (recovered.value != null && recovered.value !== leg.line.value) {
    next = withDerivedResolution({
      ...leg,
      line:
        recovered.confirm || leg.line.status !== 'known'
          ? needsConfirmation(recovered.value)
          : { value: recovered.value, status: 'known' },
    });
  }
  return next;
}
