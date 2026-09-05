/**
 * Merge current injuries onto canonical roster (Phase 2.T.3B).
 * Membership stays roster-first; injuries are optional availability.
 */

import type { CanonicalRosterPlayer } from './team-roster-presentation';
import type { TeamInjuryRow } from './team-injury-queries';
import {
  getLiveAvailabilitySeason,
  shouldShowCurrentAvailability,
} from '@/lib/season';

export type AvailabilityPriority = 'high' | 'moderate' | 'low';

export type RosterAvailability = {
  status: string;
  detail: string | null;
  label: string;
  priority: AvailabilityPriority;
  returnDateRaw: string | null;
  updatedAt: string | null;
};

export type RosterPlayerWithAvailability = CanonicalRosterPlayer & {
  availability: RosterAvailability | null;
};

export type MergeAvailabilityResult = {
  players: RosterPlayerWithAvailability[];
  /** Injuries skipped because injury.team_id ≠ roster team. */
  teamMismatches: Array<{ playerId: string; injuryTeamId: string | null }>;
  queryCount: 1 | 0;
  showAvailability: boolean;
  liveAvailabilitySeason: string;
};

/** Normalize provider status for display (no invented Healthy). */
export function normalizeAvailabilityStatus(
  status: string | null
): string | null {
  if (!status) return null;
  const trimmed = status.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (lower === 'out for season' || lower.includes('out for season')) {
    return 'Out For Season';
  }
  if (lower === 'out') return 'Out';
  if (lower === 'questionable') return 'Questionable';
  if (lower === 'doubtful') return 'Doubtful';
  if (lower === 'probable') return 'Probable';
  if (lower === 'day-to-day' || lower === 'day to day') return 'Day-To-Day';
  // Preserve unknown source statuses rather than inventing Healthy.
  return trimmed;
}

export function availabilityPriority(status: string): AvailabilityPriority {
  const s = status.toLowerCase();
  if (s.includes('out') || s.includes('doubtful')) return 'high';
  if (s.includes('questionable') || s.includes('day')) return 'moderate';
  if (s.includes('probable')) return 'low';
  return 'moderate';
}

/**
 * Prefer short body-part style details; drop long narrative provider text.
 */
export function formatInjuryDetail(description: string | null): string | null {
  if (!description) return null;
  const d = description.trim();
  if (!d) return null;
  if (d.length > 40) return null;
  if (/[.!?]/.test(d)) return null;
  // Avoid dumping full sentences that happen to be short.
  if (d.split(/\s+/).length > 5) return null;
  return d;
}

export function formatAvailabilityLabel(
  status: string,
  detail: string | null
): string {
  return detail ? `${status} — ${detail}` : status;
}

export function mergeRosterAvailability(args: {
  roster: CanonicalRosterPlayer[];
  injuries: TeamInjuryRow[];
  rosterTeamId: string;
  viewedSeason: string;
  liveAvailabilitySeason?: string;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}): MergeAvailabilityResult {
  const liveAvailabilitySeason =
    args.liveAvailabilitySeason ??
    getLiveAvailabilitySeason(args.env, args.now);
  const showAvailability = shouldShowCurrentAvailability(
    args.viewedSeason,
    liveAvailabilitySeason
  );

  if (!showAvailability) {
    return {
      players: args.roster.map((p) => ({ ...p, availability: null })),
      teamMismatches: [],
      queryCount: 0,
      showAvailability: false,
      liveAvailabilitySeason,
    };
  }

  const byPlayer = new Map(args.injuries.map((i) => [i.playerId, i]));
  const teamMismatches: MergeAvailabilityResult['teamMismatches'] = [];

  const players = args.roster.map((p): RosterPlayerWithAvailability => {
    if (!p.playerId) {
      return { ...p, availability: null };
    }
    const injury = byPlayer.get(p.playerId);
    if (!injury) {
      return { ...p, availability: null };
    }
    if (injury.teamId != null && injury.teamId !== args.rosterTeamId) {
      teamMismatches.push({
        playerId: p.playerId,
        injuryTeamId: injury.teamId,
      });
      return { ...p, availability: null };
    }
    const status = normalizeAvailabilityStatus(injury.status);
    if (!status) {
      return { ...p, availability: null };
    }
    const detail = formatInjuryDetail(injury.description);
    return {
      ...p,
      availability: {
        status,
        detail,
        label: formatAvailabilityLabel(status, detail),
        priority: availabilityPriority(status),
        returnDateRaw: injury.returnDateRaw,
        updatedAt: injury.updatedAt,
      },
    };
  });

  return {
    players,
    teamMismatches,
    queryCount: 1,
    showAvailability: true,
    liveAvailabilitySeason,
  };
}
