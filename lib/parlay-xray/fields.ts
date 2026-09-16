import type {
  ExtractedParlayLeg,
  FieldStatus,
  ParlayLegResolution,
  XrayField,
  XrayPropKind,
} from './types';
import { XRAY_PROP_KIND_LABEL } from './types';

export function field<T>(value: T | null, status: FieldStatus): XrayField<T> {
  return { value, status };
}

export function known<T>(value: T): XrayField<T> {
  return { value, status: 'known' };
}

export function unknown<T>(): XrayField<T> {
  return { value: null, status: 'unknown' };
}

export function needsConfirmation<T>(value: T | null): XrayField<T> {
  return { value, status: 'needs_confirmation' };
}

export function deriveLegResolution(leg: Pick<
  ExtractedParlayLeg,
  'playerDisplayName' | 'propKind' | 'side' | 'line'
>): ParlayLegResolution {
  const required = [leg.playerDisplayName, leg.propKind, leg.side, leg.line];
  const missingValue = (f: XrayField<unknown>) => f.status === 'unknown' || f.value == null || f.value === '';
  if (required.some(missingValue)) return 'unresolved';
  if (required.some((f) => f.status === 'needs_confirmation')) return 'needs_confirmation';
  return 'resolved';
}

export function withDerivedResolution(leg: ExtractedParlayLeg): ExtractedParlayLeg {
  return { ...leg, resolution: deriveLegResolution(leg) };
}

export function extractionCounts(legs: ExtractedParlayLeg[]): {
  detected: number;
  resolved: number;
  needsConfirmation: number;
  unresolved: number;
} {
  return {
    detected: legs.length,
    resolved: legs.filter((l) => l.resolution === 'resolved').length,
    needsConfirmation: legs.filter((l) => l.resolution === 'needs_confirmation').length,
    unresolved: legs.filter((l) => l.resolution === 'unresolved').length,
  };
}

export function propLabelForKind(kind: XrayPropKind | null): string | null {
  if (!kind) return null;
  return XRAY_PROP_KIND_LABEL[kind];
}

export function emptyLeg(id: string): ExtractedParlayLeg {
  return withDerivedResolution({
    id,
    playerDisplayName: unknown(),
    playerId: unknown(),
    nbaPlayerId: unknown(),
    teamAbbr: unknown(),
    opponentAbbr: unknown(),
    matchupLabel: unknown(),
    propKind: unknown(),
    propLabel: unknown(),
    side: unknown(),
    line: unknown(),
    oddsAmerican: unknown(),
    sportsbookText: unknown(),
    gameDate: unknown(),
    extractionConfidence: unknown(),
    resolution: 'unresolved',
    rawSnippet: null,
  });
}
