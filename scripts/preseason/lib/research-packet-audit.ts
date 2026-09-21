/**
 * Shared research-packet integrity audit (V1.2.2 / V1.3).
 * Research packets only — no editorial.
 */

import { partitionRosterStatuses } from '@/lib/teams/preseason-preview/automation/roster-status';
import { MAX_REGULAR_SEASON_GAMES } from '@/lib/teams/preseason-preview/automation/regular-season-integrity';
import { NBA_CUP_CHAMPIONSHIP_ET } from '@/lib/wowy/calendar';
import type { PreseasonResearchPacket } from '@/lib/teams/preseason-preview/automation/research-packet-types';
import type { RosterStatusPlayer } from '@/lib/teams/preseason-preview/automation/roster-status';
import type { PreseasonContextSignal } from '@/lib/teams/preseason-preview/automation/types';

export type TeamResearchAudit = {
  team: string;
  name: string;
  rsValid: boolean;
  rsRecord: string | null;
  rsGp: number;
  rsWins: number | null;
  rsLosses: number | null;
  add: number;
  dep: number;
  ret: number;
  unres: number;
  humanReviewFlags: string[];
  unresolvedNames: string[];
  evidenceGaps: number;
  majorIssues: string[];
  suspiciousSupported: string[];
  unexpected: string[];
  vacatedFromUnresolved: boolean;
  fabricatedWowy: boolean;
  cupChampionshipExcluded: boolean;
  generationError: string | null;
};

export function emptyFailedAudit(
  slug: string,
  error: string
): TeamResearchAudit {
  return {
    team: slug,
    name: slug,
    rsValid: false,
    rsRecord: null,
    rsGp: 0,
    rsWins: null,
    rsLosses: null,
    add: 0,
    dep: 0,
    ret: 0,
    unres: 0,
    humanReviewFlags: [],
    unresolvedNames: [],
    evidenceGaps: 0,
    majorIssues: [`GENERATION_ERROR: ${error}`],
    suspiciousSupported: [],
    unexpected: [],
    vacatedFromUnresolved: false,
    fabricatedWowy: false,
    cupChampionshipExcluded: false,
    generationError: error,
  };
}

export function auditResearchPacket(
  slug: string,
  research: PreseasonResearchPacket,
  rosterStatuses: RosterStatusPlayer[]
): TeamResearchAudit {
  const parts = partitionRosterStatuses(rosterStatuses);
  const rs = research.snapshot.regularSeason;
  const majorIssues: string[] = [];
  const unexpected: string[] = [];
  const suspiciousSupported: string[] = [];

  const rsValid =
    rs.available === true &&
    rs.metricsScope === 'regular_season' &&
    rs.wins != null &&
    rs.losses != null &&
    rs.wins >= 0 &&
    rs.losses >= 0 &&
    rs.wins + rs.losses === rs.gamesPlayed &&
    rs.gamesPlayed <= MAX_REGULAR_SEASON_GAMES &&
    rs.gamesPlayed > 0;

  if (!rsValid) {
    majorIssues.push(
      `INVALID_RS available=${rs.available} GP=${rs.gamesPlayed} W=${rs.wins} L=${rs.losses} scope=${rs.metricsScope}`
    );
  }

  const cupDates = NBA_CUP_CHAMPIONSHIP_ET['2025'] ?? [];
  const cupChampionshipExcluded =
    cupDates.length === 0 ||
    (rs.provenance.note ?? '').includes('Cup Championship') ||
    (rs.provenance.method ?? '').includes('1.2.1');
  if (rs.available && rs.gamesPlayed === 83) {
    majorIssues.push('Cup/RS contamination: GP=83');
  }

  for (const d of parts.departed) {
    if (!d.otherTeamAbbr) {
      majorIssues.push(`FALSE_DEPARTED_NO_ELSEWHERE: ${d.displayName}`);
    } else {
      const flag = d.requiresHumanRosterReview
        ? ` review=${d.reviewReasons.join('+')}`
        : '';
      suspiciousSupported.push(
        `${d.displayName}→${d.otherTeamAbbr} [${d.status}]${flag}`
      );
    }
  }

  for (const d of parts.departed) {
    const stats = research.playerSeasonStats.find(
      (s) => s.playerEntityId === d.playerEntityId
    );
    const highImpact =
      (stats?.mpg != null && stats.mpg >= 28) ||
      (stats?.usageAvg != null && stats.usageAvg >= 0.24) ||
      (stats?.ppg != null && stats.ppg >= 18);
    if (highImpact && !d.requiresHumanRosterReview) {
      majorIssues.push(
        `HIGH_IMPACT_DEPARTURE_NOT_FLAGGED: ${d.displayName} mpg=${stats?.mpg} usg=${stats?.usageAvg} ppg=${stats?.ppg}`
      );
    }
  }

  const unresolvedIds = new Set(parts.unresolved.map((u) => u.playerEntityId));
  const vacatedSignals = research.contextSignals.filter(
    (s: PreseasonContextSignal) => s.type === 'VACATED_MINUTES'
  );
  let vacatedFromUnresolved = false;
  for (const s of vacatedSignals) {
    if (s.playerEntityId && unresolvedIds.has(s.playerEntityId)) {
      vacatedFromUnresolved = true;
      majorIssues.push(
        `VACATED_FROM_UNRESOLVED: ${s.type} ${s.playerEntityId}`
      );
    }
    if (
      s.playerEntityId &&
      !parts.departed.some((d) => d.playerEntityId === s.playerEntityId)
    ) {
      majorIssues.push(
        `VACATED_NOT_DEPARTED: ${s.type} ${s.displayName ?? s.playerEntityId}`
      );
    }
  }

  let fabricatedWowy = false;
  for (const w of research.wowyCandidates) {
    if (w.status === 'HAS_DATA' && (!w.sampleSize || w.metrics == null)) {
      fabricatedWowy = true;
      majorIssues.push(`FABRICATED_WOWY: ${w.label}`);
    }
  }

  const claimsMissingEvidence = [
    ...research.roleUsageShiftCandidates.filter(
      (c) => !c.claim.evidence || c.claim.evidence.length === 0
    ),
    ...research.researchQuestions.filter(
      (q) => !q.evidence || q.evidence.length === 0
    ),
  ];
  const evidenceGaps = claimsMissingEvidence.length;
  if (evidenceGaps > 0) {
    majorIssues.push(`EVIDENCE_GAPS: ${evidenceGaps}`);
  }

  const projectionRe =
    /\b(will be|projected to|expect(ed)? to|should start|likely starter)\b/i;
  for (const c of research.roleUsageShiftCandidates) {
    if (projectionRe.test(c.claim.text)) {
      majorIssues.push(`PROJECTION_LANGUAGE: ${c.displayName}`);
    }
  }

  for (const s of research.contextSignals) {
    if (s.type === 'RECENT_COMPETITIVE_MINUTES_INCREASE') {
      const ev = s.evidence ?? {};
      const blob = `${Object.keys(ev).join(' ')} ${JSON.stringify(ev)}`;
      if (!/regularSeasonGameCount|postseasonGameCount|dateRange/i.test(blob)) {
        unexpected.push(
          `RECENT_COMPETITIVE evidence may lack RS/PS detail: ${s.displayName}`
        );
      }
    }
  }

  for (const d of parts.departed) {
    if (d.requiresHumanRosterReview) {
      unexpected.push(
        `Human-review departure: ${d.displayName}→${d.otherTeamAbbr} (${d.reviewReasons.join(',')})`
      );
    }
  }
  for (const a of parts.added) {
    if (a.requiresHumanRosterReview) {
      unexpected.push(
        `Human-review addition: ${a.displayName} from ${a.otherTeamAbbr ?? 'n/a'} (${a.reviewReasons.join(',')})`
      );
    }
  }

  const humanReviewFlags = rosterStatuses
    .filter((r) => r.requiresHumanRosterReview)
    .map(
      (r) => `${r.displayName}[${r.status}]:${r.reviewReasons.join('+')}`
    );

  return {
    team: slug,
    name: research.team.name,
    rsValid,
    rsRecord: rs.record,
    rsGp: rs.gamesPlayed,
    rsWins: rs.wins,
    rsLosses: rs.losses,
    add: parts.added.length,
    dep: parts.departed.length,
    ret: parts.returning.length,
    unres: parts.unresolved.length,
    humanReviewFlags,
    unresolvedNames: parts.unresolved.map((u) => u.displayName),
    evidenceGaps,
    majorIssues,
    suspiciousSupported,
    unexpected,
    vacatedFromUnresolved,
    fabricatedWowy,
    cupChampionshipExcluded,
    generationError: null,
  };
}
