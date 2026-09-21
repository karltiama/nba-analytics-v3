/**
 * V1.2 roster status classification with evidence.
 *
 * Prefer false negatives over false positives for DEPARTED.
 * Missing from one open roster alone is never enough to confirm departure.
 *
 * V1.2.1: optional human-review flags for high-impact confirmed moves.
 * Flags never change status classification.
 */

import {
  HIGH_MINUTE_MPG,
  HIGH_USAGE_AVG,
  MEANINGFUL_MINUTE_MPG,
} from './policy';
import type { FactProvenance } from './types';

export type RosterStatusKind =
  | 'RETURNING'
  | 'ADDED'
  | 'DEPARTED'
  | 'UNRESOLVED';

export type RosterStatusConfidence = 'high' | 'medium' | 'low';

export type RosterStatusEvidence = {
  path: string;
  detail: string;
};

/** Lightweight review reasons — do not alter status. */
export type RosterReviewReason =
  | 'HIGH_MINUTES_CONFIRMED_DEPARTURE'
  | 'HIGH_USAGE_CONFIRMED_DEPARTURE'
  | 'HIGH_SCORING_CONFIRMED_DEPARTURE'
  | 'TOP_MINUTES_CONFIRMED_DEPARTURE'
  | 'HIGH_MINUTES_CONFIRMED_ADDITION'
  | 'HIGH_USAGE_CONFIRMED_ADDITION'
  | 'HIGH_SCORING_CONFIRMED_ADDITION'
  | 'TOP_MINUTES_CONFIRMED_ADDITION';

export type RosterStatusPlayer = {
  playerEntityId: string;
  displayName: string;
  playerId: string | null;
  position: string | null;
  status: RosterStatusKind;
  confidence: RosterStatusConfidence;
  evidence: RosterStatusEvidence[];
  /** Other-team abbreviation when used as move evidence. */
  otherTeamAbbr: string | null;
  provenance: FactProvenance;
  /** V1.2.1 — human review signal; status unchanged. */
  requiresHumanRosterReview: boolean;
  reviewReasons: RosterReviewReason[];
};

/** Prior-season role stats used only for review flags. */
export type RosterReviewStatInput = {
  playerEntityId: string;
  mpg: number | null;
  ppg: number | null;
  usageAvg: number | null;
};

/** Starter-ish scoring floor for review (existing-ish editorial threshold). */
export const HIGH_SCORING_PPG_FOR_REVIEW = 18;

/** Top-N by prior MPG among peer set triggers review. */
export const TOP_MINUTES_N_FOR_REVIEW = 5;

export type ContinuityPlayerInput = {
  playerEntityId: string;
  displayName: string;
  playerId: string | null;
  position?: string | null;
};

export type OtherTeamMembership = {
  playerEntityId: string;
  teamAbbr: string;
  teamId: string;
};

/**
 * Pure classifier.
 *
 * DEPARTED requires: on previous open roster, not on current open roster,
 * AND observed on another team's *current* open roster (move evidence).
 *
 * Absent from current with no elsewhere observation → UNRESOLVED.
 *
 * ADDED requires: on current, not on previous. If seen on another team's
 * previous open roster → medium/high. Else low-confidence ADDED (likely
 * new/rookie) still labeled ADDED with explicit evidence note — not UNRESOLVED —
 * because membership on current roster is positive observation.
 */
export function classifyRosterStatuses(args: {
  season: string;
  previousSeason: string;
  teamId: string;
  teamAbbr: string;
  previous: ContinuityPlayerInput[];
  current: ContinuityPlayerInput[];
  /** Current-season open roster elsewhere (not this team). */
  elsewhereCurrentByEntity: Map<string, OtherTeamMembership>;
  /** Previous-season open roster elsewhere (not this team). */
  elsewherePreviousByEntity: Map<string, OtherTeamMembership>;
}): RosterStatusPlayer[] {
  const prevById = new Map(args.previous.map((p) => [p.playerEntityId, p]));
  const currById = new Map(args.current.map((p) => [p.playerEntityId, p]));
  const out: RosterStatusPlayer[] = [];

  const baseProv = (note: string): FactProvenance => ({
    method: 'roster_status_v1.2',
    tables: [
      'analytics.team_roster_current',
      'analytics.player_team_stints',
    ],
    season: args.season,
    note,
  });

  for (const [id, curr] of currById) {
    const prev = prevById.get(id);
    if (prev) {
      out.push({
        playerEntityId: id,
        displayName: curr.displayName,
        playerId: curr.playerId,
        position: curr.position ?? null,
        status: 'RETURNING',
        confidence: 'high',
        evidence: [
          {
            path: `roster.${args.previousSeason}.${args.teamAbbr}.open`,
            detail: `Present on ${args.teamAbbr} open roster ${args.previousSeason}`,
          },
          {
            path: `roster.${args.season}.${args.teamAbbr}.open`,
            detail: `Present on ${args.teamAbbr} open roster ${args.season}`,
          },
        ],
        otherTeamAbbr: null,
        provenance: baseProv('Returning: entity on both season open rosters'),
        requiresHumanRosterReview: false,
        reviewReasons: [],
      });
      continue;
    }

    const elsewherePrev = args.elsewherePreviousByEntity.get(id);
    const evidence: RosterStatusEvidence[] = [
      {
        path: `roster.${args.season}.${args.teamAbbr}.open`,
        detail: `Present on ${args.teamAbbr} open roster ${args.season}`,
      },
      {
        path: `roster.${args.previousSeason}.${args.teamAbbr}.open.absent`,
        detail: `Not on ${args.teamAbbr} open roster ${args.previousSeason}`,
      },
    ];
    if (elsewherePrev) {
      evidence.push({
        path: `roster.${args.previousSeason}.${elsewherePrev.teamAbbr}.open`,
        detail: `Previously on ${elsewherePrev.teamAbbr} open roster ${args.previousSeason}`,
      });
    } else {
      evidence.push({
        path: `roster.${args.previousSeason}.elsewhere.absent`,
        detail: `No other-team open roster in ${args.previousSeason} (possible rookie/new NBA)`,
      });
    }

    out.push({
      playerEntityId: id,
      displayName: curr.displayName,
      playerId: curr.playerId,
      position: curr.position ?? null,
      status: 'ADDED',
      confidence: elsewherePrev ? 'high' : 'medium',
      evidence,
      otherTeamAbbr: elsewherePrev?.teamAbbr ?? null,
      provenance: baseProv(
        elsewherePrev
          ? 'Added: current open + prior open elsewhere'
          : 'Added: current open only; no prior open membership found'
      ),
      requiresHumanRosterReview: false,
      reviewReasons: [],
    });
  }

  for (const [id, prev] of prevById) {
    if (currById.has(id)) continue;

    const elsewhereCurr = args.elsewhereCurrentByEntity.get(id);
    const evidence: RosterStatusEvidence[] = [
      {
        path: `roster.${args.previousSeason}.${args.teamAbbr}.open`,
        detail: `Present on ${args.teamAbbr} open roster ${args.previousSeason}`,
      },
      {
        path: `roster.${args.season}.${args.teamAbbr}.open.absent`,
        detail: `Not on ${args.teamAbbr} open roster ${args.season}`,
      },
    ];

    if (elsewhereCurr) {
      evidence.push({
        path: `roster.${args.season}.${elsewhereCurr.teamAbbr}.open`,
        detail: `Observed on ${elsewhereCurr.teamAbbr} open roster ${args.season}`,
      });
      out.push({
        playerEntityId: id,
        displayName: prev.displayName,
        playerId: prev.playerId,
        position: prev.position ?? null,
        status: 'DEPARTED',
        confidence: 'high',
        evidence,
        otherTeamAbbr: elsewhereCurr.teamAbbr,
        provenance: baseProv(
          'Departed: prior open here + current open elsewhere (move evidence)'
        ),
        requiresHumanRosterReview: false,
        reviewReasons: [],
      });
    } else {
      evidence.push({
        path: `roster.${args.season}.elsewhere.absent`,
        detail: `Not observed on any other team open roster in ${args.season} — insufficient to confirm departure`,
      });
      out.push({
        playerEntityId: id,
        displayName: prev.displayName,
        playerId: prev.playerId,
        position: prev.position ?? null,
        status: 'UNRESOLVED',
        confidence: 'low',
        evidence,
        otherTeamAbbr: null,
        provenance: baseProv(
          'Unresolved: absent from current open roster without elsewhere observation'
        ),
        requiresHumanRosterReview: false,
        reviewReasons: [],
      });
    }
  }

  out.sort((a, b) => {
    const s = statusOrder(a.status) - statusOrder(b.status);
    if (s !== 0) return s;
    return a.displayName.localeCompare(b.displayName, 'en', {
      sensitivity: 'base',
    });
  });

  return out;
}

function statusOrder(s: RosterStatusKind): number {
  switch (s) {
    case 'DEPARTED':
      return 0;
    case 'ADDED':
      return 1;
    case 'UNRESOLVED':
      return 2;
    case 'RETURNING':
      return 3;
    default:
      return 9;
  }
}

export function partitionRosterStatuses(rows: RosterStatusPlayer[]): {
  returning: RosterStatusPlayer[];
  added: RosterStatusPlayer[];
  departed: RosterStatusPlayer[];
  unresolved: RosterStatusPlayer[];
} {
  return {
    returning: rows.filter((r) => r.status === 'RETURNING'),
    added: rows.filter((r) => r.status === 'ADDED'),
    departed: rows.filter((r) => r.status === 'DEPARTED'),
    unresolved: rows.filter((r) => r.status === 'UNRESOLVED'),
  };
}

/**
 * Attach human-review flags for high-impact confirmed DEPARTED / ADDED moves.
 * Does not change status. UNRESOLVED / RETURNING are never flagged.
 */
export function applyHumanRosterReviewFlags(args: {
  rows: RosterStatusPlayer[];
  /** Prior-season stats keyed for players on the previous open roster (departures). */
  previousRosterStats: RosterReviewStatInput[];
  /** Prior-season stats for current roster members (additions' prior roles). */
  currentRosterStats: RosterReviewStatInput[];
  topMinutesN?: number;
}): RosterStatusPlayer[] {
  const topN = args.topMinutesN ?? TOP_MINUTES_N_FOR_REVIEW;
  const prevById = new Map(
    args.previousRosterStats.map((s) => [s.playerEntityId, s])
  );
  const currById = new Map(
    args.currentRosterStats.map((s) => [s.playerEntityId, s])
  );

  const topPrevMinutes = topEntityIdsBy(
    args.previousRosterStats,
    (s) => s.mpg,
    topN
  );

  return args.rows.map((row) => {
    if (row.status !== 'DEPARTED' && row.status !== 'ADDED') {
      return {
        ...row,
        requiresHumanRosterReview: false,
        reviewReasons: [],
      };
    }

    const stats =
      row.status === 'DEPARTED'
        ? prevById.get(row.playerEntityId)
        : currById.get(row.playerEntityId);
    const reasons: RosterReviewReason[] = [];

    if (row.status === 'DEPARTED') {
      if (stats?.mpg != null && stats.mpg >= HIGH_MINUTE_MPG) {
        reasons.push('HIGH_MINUTES_CONFIRMED_DEPARTURE');
      } else if (
        stats?.mpg != null &&
        stats.mpg >= MEANINGFUL_MINUTE_MPG &&
        topPrevMinutes.has(row.playerEntityId)
      ) {
        reasons.push('TOP_MINUTES_CONFIRMED_DEPARTURE');
      }
      if (stats?.usageAvg != null && stats.usageAvg >= HIGH_USAGE_AVG) {
        reasons.push('HIGH_USAGE_CONFIRMED_DEPARTURE');
      }
      if (stats?.ppg != null && stats.ppg >= HIGH_SCORING_PPG_FOR_REVIEW) {
        reasons.push('HIGH_SCORING_CONFIRMED_DEPARTURE');
      }
    } else {
      if (stats?.mpg != null && stats.mpg >= HIGH_MINUTE_MPG) {
        reasons.push('HIGH_MINUTES_CONFIRMED_ADDITION');
      } else if (
        stats?.mpg != null &&
        stats.mpg >= MEANINGFUL_MINUTE_MPG &&
        topEntityIdsBy(args.currentRosterStats, (s) => s.mpg, topN).has(
          row.playerEntityId
        )
      ) {
        reasons.push('TOP_MINUTES_CONFIRMED_ADDITION');
      }
      if (stats?.usageAvg != null && stats.usageAvg >= HIGH_USAGE_AVG) {
        reasons.push('HIGH_USAGE_CONFIRMED_ADDITION');
      }
      if (stats?.ppg != null && stats.ppg >= HIGH_SCORING_PPG_FOR_REVIEW) {
        reasons.push('HIGH_SCORING_CONFIRMED_ADDITION');
      }
    }

    return {
      ...row,
      requiresHumanRosterReview: reasons.length > 0,
      reviewReasons: reasons,
    };
  });
}

function topEntityIdsBy(
  stats: RosterReviewStatInput[],
  value: (s: RosterReviewStatInput) => number | null,
  n: number
): Set<string> {
  const ranked = stats
    .map((s) => ({ id: s.playerEntityId, v: value(s) }))
    .filter((x): x is { id: string; v: number } => x.v != null && Number.isFinite(x.v))
    .sort((a, b) => b.v - a.v)
    .slice(0, n);
  return new Set(ranked.map((x) => x.id));
}
