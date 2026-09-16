import {
  known,
  needsConfirmation,
  unknown,
  withDerivedResolution,
} from '@/lib/parlay-xray/fields';
import type { ExtractedParlayLeg, FieldStatus, XrayField } from '@/lib/parlay-xray/types';
import type { XrayExtractResult } from './result-codes';
import type { XrayVisionLeg, XrayVisionOutput } from './schema';
import { recoverExtractedLine, recoverLineOnExtractedLeg } from './line-value';
import { resolveLegMarket } from './market-identity';

const PROMO_ONLY_LABEL =
  /^(profit\s*boost|boost(?:ed)?(?:\s+bets)?|special|promo(?:tion)?|popular|trending)$/i;

export function isPromoOnlyLabel(playerName: string | null | undefined): boolean {
  if (playerName == null) return false;
  return PROMO_ONLY_LABEL.test(playerName.replace(/\s+/g, ' ').trim());
}

function cleanText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const t = value.replace(/\s+/g, ' ').trim();
  return t.length > 0 ? t.slice(0, 80) : null;
}

function hasEvidence(value: string | null | undefined): boolean {
  return cleanText(value) != null;
}

function statusFromConfidence(
  value: unknown,
  confidence: 'high' | 'medium' | 'low' | null | undefined
): FieldStatus {
  if (value == null || value === '') return 'unknown';
  if (confidence === 'medium' || confidence === 'low') return 'needs_confirmation';
  return 'known';
}

function evidencedStatus(
  value: unknown,
  evidence: string | null | undefined,
  confidence: 'high' | 'medium' | 'low' | null | undefined
): FieldStatus {
  if (value == null || value === '') return 'unknown';
  if (!hasEvidence(evidence)) return 'needs_confirmation';
  return statusFromConfidence(value, confidence);
}

function textField(
  value: string | null | undefined,
  evidence: string | null | undefined,
  confidence: 'high' | 'medium' | 'low' | null | undefined
): XrayField<string> {
  const cleaned = cleanText(value ?? null);
  if (!cleaned) return unknown();
  const status = evidencedStatus(cleaned, evidence, confidence);
  return status === 'known' ? known(cleaned) : needsConfirmation(cleaned);
}

function numberField(
  value: number | null | undefined,
  evidence: string | null | undefined,
  confidence: 'high' | 'medium' | 'low' | null | undefined
): XrayField<number> {
  if (value == null || !Number.isFinite(value)) return unknown();
  const status = evidencedStatus(value, evidence, confidence);
  return status === 'known' ? known(value) : needsConfirmation(value);
}

function recoveredLineField(
  value: number | null | undefined,
  evidence: string | null | undefined,
  snippet: string | null | undefined,
  confidence: 'high' | 'medium' | 'low' | null | undefined
): XrayField<number> {
  const recovered = recoverExtractedLine(value, evidence, snippet);
  if (recovered.value == null) return unknown();
  if (recovered.confirm) return needsConfirmation(recovered.value);
  return numberField(recovered.value, evidence, confidence);
}

export function visibleOverUnder(text: string | null | undefined): 'over' | 'under' | null {
  const cleaned = cleanText(text);
  if (!cleaned) return null;
  const t = cleaned.toLowerCase();
  const hasUnder = /\bunder\b/.test(t) || /^u(?:\b|\s)/.test(t);
  const hasOver = /\bover\b/.test(t) || /^o(?:\b|\s)/.test(t);
  if (hasUnder && !hasOver) return 'under';
  if (hasOver && !hasUnder) return 'over';
  return null;
}

export { propKindFromEvidence } from './market-identity';

function mapSide(leg: XrayVisionLeg): XrayField<'over' | 'under'> {
  const fromEvidence = visibleOverUnder(leg.side_evidence) ?? visibleOverUnder(leg.raw_snippet);
  if (!fromEvidence) return unknown();
  const conflict = leg.side != null && leg.side !== fromEvidence;
  const status = conflict
    ? 'needs_confirmation'
    : statusFromConfidence(fromEvidence, leg.field_confidence);
  return status === 'known' ? known(fromEvidence) : needsConfirmation(fromEvidence);
}

export function mapVisionLeg(leg: XrayVisionLeg, id: string, slipSportsbook: string | null): ExtractedParlayLeg {
  const conf = leg.field_confidence ?? null;
  const playerConf = leg.player_name_confidence ?? conf;
  const { propKind, propLabel } = resolveLegMarket(leg);
  const sportsbook = textField(leg.sportsbook ?? slipSportsbook, leg.sportsbook ?? slipSportsbook, conf);

  return recoverLineOnExtractedLeg(
    withDerivedResolution({
      id,
      playerDisplayName: textField(leg.player_name, leg.player_evidence ?? leg.player_name, playerConf),
      playerId: unknown(),
      nbaPlayerId: unknown(),
      teamAbbr: textField(leg.team_abbr, leg.team_abbr, conf),
      opponentAbbr: textField(leg.opponent_abbr, leg.opponent_abbr, conf),
      matchupLabel: textField(leg.matchup_label, leg.matchup_label, conf),
      propKind,
      propLabel,
      side: mapSide(leg),
      line: recoveredLineField(leg.line, leg.line_evidence, leg.raw_snippet, conf),
      oddsAmerican: numberField(leg.odds_american, leg.odds_evidence, conf),
      sportsbookText: sportsbook,
      gameDate: textField(leg.game_date, leg.game_date, conf),
      extractionConfidence: conf ? known(conf) : unknown(),
      resolution: 'unresolved',
      rawSnippet: cleanText(leg.raw_snippet)?.slice(0, 240) ?? null,
    })
  );
}

export function mapVisionOutput(output: XrayVisionOutput, idFactory: () => string): ExtractedParlayLeg[] {
  return output.legs.map((leg) => mapVisionLeg(leg, idFactory(), output.sportsbook));
}

export function resultFromLegs(
  legs: ExtractedParlayLeg[],
  imageQuality: XrayVisionOutput['image_quality']
): XrayExtractResult {
  if (imageQuality === 'unreadable' && legs.length === 0) return 'UNREADABLE_IMAGE';
  if (legs.length === 0) return 'NO_LEGS_FOUND';
  const needs = legs.filter((l) => l.resolution === 'needs_confirmation');
  const unresolved = legs.filter((l) => l.resolution === 'unresolved');
  if (unresolved.length === 0 && needs.length === 0) return 'SUCCESS';
  if (needs.length > 0 && unresolved.length === 0) return 'NEEDS_CONFIRMATION';
  return 'PARTIAL';
}
