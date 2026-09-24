/**
 * Presentation selectors for Parlay Workspace.
 * Summarizes existing interpretation fields. Does not score, correlate, or invent metrics.
 */

import { formatAmericanOdds, formatSignedLineDelta } from '@/lib/betting/market-movement-format';
import { americanToImpliedProb } from '@/lib/betting/odds-utils';
import { combinedAmericanOdds } from '@/lib/parlay-xray/combined-odds';
import {
  formatAvg,
  formatMarketLabel,
  formLineReadLabel,
  marketPositionLabel,
  parlayDependencyKindLabel,
  parlayReviewFlagLabel,
  roleMinutesLabel,
} from '@/lib/parlay-xray/interpretation/display';
import type { XRayParlayInterpretation } from '@/lib/parlay-xray/interpretation/parlay-types';
import type { XRayLegInterpretation } from '@/lib/parlay-xray/interpretation/types';
import type { XRayLegContext } from '@/lib/parlay-xray/context/types';
import type { SelectedParlayLeg } from './selection';

export type WorkspaceLegStatus = 'supported' | 'mixed' | 'needs_review';

export type WorkspaceSignalTone = 'support' | 'watch' | 'concern' | 'info';

export type WorkspaceSignal = {
  id: 'projection' | 'role' | 'relationships' | 'coverage';
  label: string;
  value: string;
  detail: string;
  tone: WorkspaceSignalTone;
  warnings: string[];
};

const STATUS_LABEL: Record<WorkspaceLegStatus, string> = {
  supported: 'Supported',
  mixed: 'Mixed',
  needs_review: 'Needs Review',
};

export function workspaceLegStatusLabel(status: WorkspaceLegStatus): string {
  return STATUS_LABEL[status];
}

export function workspaceLegStatus(interp: XRayLegInterpretation): WorkspaceLegStatus {
  if (interp.summaryState === 'COUNTERSIGNALS_PRESENT' || interp.summaryState === 'LIMITED_DATA') {
    return 'needs_review';
  }
  if (interp.summaryState === 'MIXED_CONTEXT' || interp.summaryState === 'NEUTRAL_CONTEXT') {
    return 'mixed';
  }
  return 'supported';
}

export function countWorkspaceStatuses(interpretations: XRayLegInterpretation[]): Record<WorkspaceLegStatus, number> {
  const counts: Record<WorkspaceLegStatus, number> = { supported: 0, mixed: 0, needs_review: 0 };
  for (const interp of interpretations) {
    counts[workspaceLegStatus(interp)] += 1;
  }
  return counts;
}

/** At most three existing evidence titles. Concerns first when the leg needs review. */
export function workspaceLegChips(interp: XRayLegInterpretation): string[] {
  const status = workspaceLegStatus(interp);
  const concerns = [
    ...interp.counterContext.map((item) => item.title),
    ...interp.whyItCouldFail.map((item) => item.title),
    ...interp.uncertainties.map((item) => item.title),
  ];
  const support = [
    ...interp.supportingContext.map((item) => item.title),
    marketPositionLabel(interp.marketPosition.kind),
    formLineReadLabel(interp.recentForm.lineRead),
    roleMinutesLabel(interp.role.minutesVsSeason),
  ];
  const ordered = status === 'needs_review' ? [...concerns, ...support] : [...support, ...concerns];
  const unique: string[] = [];
  for (const label of ordered) {
    const text = label.trim();
    if (!text || unique.includes(text)) continue;
    unique.push(text);
    if (unique.length === 3) break;
  }
  return unique;
}

export function workspaceSportsbookLabel(legs: SelectedParlayLeg[]): string {
  const names = [...new Set(legs.map((leg) => leg.offer.sportsbook.displayName).filter(Boolean))];
  if (names.length === 0) return '—';
  if (names.length === 1) return names[0]!;
  return 'Mixed';
}

export function workspaceCombinedOdds(legs: SelectedParlayLeg[]): number | null {
  return combinedAmericanOdds(legs.map((leg) => leg.offer.oddsAmerican));
}

export function workspaceImpliedProbabilityLabel(odds: number | null): string | null {
  if (odds == null) return null;
  const prob = americanToImpliedProb(odds);
  if (prob == null || !Number.isFinite(prob)) return null;
  return `${(prob * 100).toFixed(1)}%`;
}

export function workspaceOddsLabel(odds: number | null): string {
  return formatAmericanOdds(odds);
}

type CoverageBucket = { have: number; of: number };

function coverageShare(buckets: CoverageBucket[]): number | null {
  let have = 0;
  let of = 0;
  for (const bucket of buckets) {
    if (!Number.isFinite(bucket.have) || !Number.isFinite(bucket.of) || bucket.of <= 0) continue;
    have += bucket.have;
    of += bucket.of;
  }
  if (of <= 0) return null;
  return Math.round((100 * have) / of);
}

/** Presentation bands over existing have/of counts. Not a new coverage model. */
export function workspaceCoverageSummary(parlay: XRayParlayInterpretation): {
  percent: number | null;
  band: 'High' | 'Partial' | 'Limited' | 'Unavailable';
  warnings: string[];
} {
  const quality = parlay.dataQuality;
  const percent = coverageShare([
    quality.canonical,
    quality.recentForm,
    quality.role,
    quality.wowy,
    quality.projection,
    quality.availability,
    { have: quality.historicalMarket.exact, of: quality.historicalMarket.of },
  ]);
  const warnings: string[] = [];
  if (quality.wowy.of > 0 && quality.wowy.have === 0) warnings.push('WOWY unavailable');
  if (quality.projection.of > 0 && quality.projection.have === 0) warnings.push('Projection unavailable');
  if (quality.availability.of > 0 && quality.availability.have === 0) warnings.push('Availability unavailable');
  if (quality.historicalMarket.of > 0 && quality.historicalMarket.exact === 0) {
    warnings.push('No exact market history');
  }
  if (quality.recentForm.of > 0 && quality.recentForm.have < quality.recentForm.of) {
    warnings.push('Limited recent-form sample');
  }
  if (percent == null) return { percent: null, band: 'Unavailable', warnings };
  if (warnings.some((item) => item.endsWith('unavailable') || item.startsWith('No '))) {
    return { percent, band: percent >= 90 && warnings.length === 0 ? 'High' : percent >= 60 ? 'Partial' : 'Limited', warnings };
  }
  const band = percent >= 90 ? 'High' : percent >= 60 ? 'Partial' : 'Limited';
  return { percent, band, warnings };
}

function projectionOnRequestedSide(interp: XRayLegInterpretation, context: XRayLegContext | undefined): boolean | null {
  const difference = context?.projection.difference;
  if (context?.projection.status !== 'AVAILABLE' || difference == null || !Number.isFinite(difference) || difference === 0) {
    return null;
  }
  if (interp.identity.side === 'over') return difference > 0;
  if (interp.identity.side === 'under') return difference < 0;
  return null;
}

export function workspaceKeySignals(
  parlay: XRayParlayInterpretation,
  interpretations: XRayLegInterpretation[],
  contexts: XRayLegContext[]
): WorkspaceSignal[] {
  const knownProjection = interpretations.filter((interp, index) => projectionOnRequestedSide(interp, contexts[index]) != null);
  const onSide = interpretations.filter((interp, index) => projectionOnRequestedSide(interp, contexts[index]) === true).length;
  const projection: WorkspaceSignal =
    knownProjection.length === 0
      ? {
          id: 'projection',
          label: 'Projection',
          value: `${parlay.dataQuality.projection.have}/${parlay.dataQuality.projection.of}`,
          detail: 'Available',
          tone: parlay.dataQuality.projection.have === 0 ? 'concern' : 'info',
          warnings: parlay.dataQuality.projection.have === 0 ? ['Projection unavailable'] : [],
        }
      : {
          id: 'projection',
          label: 'Projection',
          value: `${onSide}/${interpretations.length}`,
          detail: 'On the projection side of the line',
          tone: onSide === interpretations.length ? 'support' : onSide === 0 ? 'concern' : 'watch',
          warnings: [],
        };

  const roleKnown = interpretations.filter((interp) => interp.role.minutesVsSeason !== 'UNKNOWN');
  const near = roleKnown.filter((interp) => interp.role.minutesVsSeason === 'NEAR').length;
  const role: WorkspaceSignal = {
    id: 'role',
    label: 'Role stability',
    value: roleKnown.length === 0 ? 'Unavailable' : roleMinutesLabel(dominantRole(roleKnown)),
    detail: `${parlay.dataQuality.role.have}/${parlay.dataQuality.role.of} with minutes`,
    tone: roleKnown.length === 0 ? 'concern' : near === roleKnown.length ? 'support' : 'info',
    warnings: parlay.dataQuality.role.have === 0 ? ['Role context unavailable'] : [],
  };

  const sharedGames = parlay.dependencyGroups.filter((group) => group.kind === 'SHARED_GAME' || group.kind === 'SHARED_GAME_ENVIRONMENT');
  const relationships: WorkspaceSignal = {
    id: 'relationships',
    label: 'Correlation',
    value: parlay.dependencyGroups.length === 0 ? 'Independent' : `${parlay.dependencyGroups.length} shared`,
    detail:
      sharedGames.length > 0
        ? `${sharedGames.reduce((sum, group) => sum + group.legIndexes.length, 0)} legs in a shared game`
        : 'Structural groups from identity',
    tone: sharedGames.length > 0 ? 'watch' : 'info',
    warnings: [],
  };

  const coverage = workspaceCoverageSummary(parlay);
  const coverageSignal: WorkspaceSignal = {
    id: 'coverage',
    label: 'Data coverage',
    value: coverage.band,
    detail: coverage.percent == null ? 'Share unavailable' : `${coverage.percent}%`,
    tone: coverage.band === 'High' ? 'support' : coverage.band === 'Limited' || coverage.band === 'Unavailable' ? 'concern' : 'watch',
    warnings: coverage.warnings,
  };

  return [projection, role, relationships, coverageSignal];
}

function dominantRole(legs: XRayLegInterpretation[]): XRayLegInterpretation['role']['minutesVsSeason'] {
  const counts = new Map<XRayLegInterpretation['role']['minutesVsSeason'], number>();
  for (const leg of legs) {
    counts.set(leg.role.minutesVsSeason, (counts.get(leg.role.minutesVsSeason) ?? 0) + 1);
  }
  let best: XRayLegInterpretation['role']['minutesVsSeason'] = 'UNKNOWN';
  let bestCount = -1;
  for (const [kind, count] of counts) {
    if (count > bestCount) {
      best = kind;
      bestCount = count;
    }
  }
  return best;
}

export function workspaceMainRisks(parlay: XRayParlayInterpretation): Array<{ title: string; detail: string }> {
  return parlay.whyThisParlayCouldFail.slice(0, 3).map((item) => ({ title: item.title, detail: item.detail }));
}

export function workspaceRelationships(parlay: XRayParlayInterpretation, limit = 3) {
  return parlay.dependencyGroups.slice(0, limit).map((group) => ({
    key: group.kind + group.key,
    kind: parlayDependencyKindLabel(group.kind),
    label: group.label,
    detail: group.detail,
  }));
}

export function workspaceReviewFlags(parlay: XRayParlayInterpretation, legIndex: number): string[] {
  const row = parlay.reviewNeeded.find((item) => item.legIndex === legIndex);
  return row ? row.flags.map((flag) => parlayReviewFlagLabel(flag)) : [];
}

export function workspaceProjectionDeltaLabel(context: XRayLegContext | undefined): string {
  return formatSignedLineDelta(context?.projection.difference);
}

export function workspaceFormTable(interpretations: XRayLegInterpretation[]) {
  return interpretations
    .filter(
      (interp) =>
        interp.recentForm.last5Average != null ||
        interp.recentForm.last10Average != null ||
        interp.recentForm.seasonAverage != null
    )
    .map((interp) => ({
      player: interp.identity.playerDisplayName ?? 'Unknown player',
      market: formatMarketLabel(interp.identity.market),
      last5: formatAvg(interp.recentForm.last5Average),
      last10: formatAvg(interp.recentForm.last10Average),
      season: formatAvg(interp.recentForm.seasonAverage),
    }));
}

export function workspaceProjectionTable(
  interpretations: XRayLegInterpretation[],
  contexts: XRayLegContext[]
) {
  return interpretations.flatMap((interp, index) => {
    const projection = contexts[index]?.projection;
    if (!projection || projection.status !== 'AVAILABLE' || projection.projectedStat == null) return [];
    return [
      {
        player: interp.identity.playerDisplayName ?? 'Unknown player',
        market: formatMarketLabel(interp.identity.market),
        line: projection.requestedLine == null ? '—' : String(projection.requestedLine),
        projection: formatAvg(projection.projectedStat),
        difference: formatSignedLineDelta(projection.difference),
      },
    ];
  });
}
