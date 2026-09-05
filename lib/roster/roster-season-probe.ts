/**
 * Phase 2.T.2D.1 — Pure helpers for 2026–27 roster probe / dry-run seed plan.
 *
 * Never writes stints. Callers must keep mode=dry-run.
 */

import { parseSeasonStartYear, toNbaStatsSeason } from '../season';
import { findDuplicateCanonicalAssignments } from './identity-integrity';
import type { ResolveResult, ResolveStatus } from './identity-resolver';

export type ProbeRosterPlayer = {
  nbaPlayerId: string;
  fullName: string;
  teamAbbr: string;
  analyticsTeamId: string;
  jersey: string | null;
  position: string | null;
  experience?: string | number | null;
  school?: string | null;
  rosterStatus?: string | null;
  apiSeasonField?: string | null;
};

export type Open2025Stint = {
  playerId: string;
  teamId: string;
  teamAbbr: string;
};

export type LastPglTeam = {
  playerId: string;
  teamAbbr: string;
  lastGameDate: string;
};

export type SeedActionKind =
  | 'open_new_2026_stint'
  | 'skip_unresolved'
  | 'skip_ambiguous'
  | 'conflict';

export type SimulatedSeedAction = {
  action: SeedActionKind;
  nbaPlayerId: string;
  fullName: string;
  teamAbbr: string;
  analyticsPlayerId: string | null;
  season: '2026';
  observedFrom: string; // observation date YYYY-MM-DD
  observedTo: null;
  source: 'nba_stats';
  sourcePlayerId: string;
  jersey: string | null;
  position: string | null;
  membershipType: 'standard' | null;
  resolveStatus: ResolveStatus;
  reason: string | null;
};

export type OffseasonCompareRow = {
  nbaPlayerId: string;
  fullName: string;
  team2026: string;
  analyticsPlayerId: string | null;
  open2025Team: string | null;
  lastPgl2025Team: string | null;
  classification:
    | 'returning_same_team'
    | 'offseason_team_change'
    | 'no_prior_open_stint'
    | 'pgl_differs_from_2026'
    | 'multi_team_2026_collision';
};

/** Confirm 2026-27 label normalizes to analytics season '2026'. */
export function analyticsSeasonForNbaLabel(nbaSeasonLabel: string): string {
  const parsed = parseSeasonStartYear(nbaSeasonLabel);
  if (!parsed) {
    throw new Error(`Invalid NBA season label: ${nbaSeasonLabel}`);
  }
  return parsed;
}

export function assertNoHyphenSeasonInStintPlan(season: string): void {
  if (season.includes('-')) {
    throw new Error(
      `analytics.player_team_stints.season must be start-year only, got ${season}`
    );
  }
}

export function verify2026SeasonSemantics(): {
  nbaLabel: string;
  analyticsSeason: string;
  roundTripNbaLabel: string;
} {
  const nbaLabel = '2026-27';
  const analyticsSeason = analyticsSeasonForNbaLabel(nbaLabel);
  assertNoHyphenSeasonInStintPlan(analyticsSeason);
  return {
    nbaLabel,
    analyticsSeason,
    roundTripNbaLabel: toNbaStatsSeason(analyticsSeason),
  };
}

export function rosterSizeStats(counts: number[]): {
  min: number | null;
  median: number | null;
  max: number | null;
} {
  if (counts.length === 0) return { min: null, median: null, max: null };
  const sorted = [...counts].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2
      ? sorted[mid]!
      : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return {
    min: sorted[0]!,
    median,
    max: sorted[sorted.length - 1]!,
  };
}

/**
 * Simulate 2026 open-stint seed actions from resolve results.
 * Fail-closed: unresolved/ambiguous never open; duplicate canonical → conflict.
 */
export function plan2026StintSeedDryRun(args: {
  observedOn: string;
  results: ResolveResult[];
}): {
  actions: SimulatedSeedAction[];
  duplicateCanonical: ReturnType<typeof findDuplicateCanonicalAssignments>;
  multiTeamNbaIds: string[];
} {
  const { observedOn, results } = args;
  const season = analyticsSeasonForNbaLabel('2026-27');
  assertNoHyphenSeasonInStintPlan(season);

  const nbaIdTeams = new Map<string, Set<string>>();
  for (const r of results) {
    const set = nbaIdTeams.get(r.nbaPlayerId) ?? new Set();
    set.add(r.teamAbbr);
    nbaIdTeams.set(r.nbaPlayerId, set);
  }
  const multiTeamNbaIds = [...nbaIdTeams.entries()]
    .filter(([, teams]) => teams.size > 1)
    .map(([id]) => id)
    .sort();

  const safe = results.filter(
    (r) => r.status === 'provider_match' || r.status === 'safe_fallback_match'
  );
  const assignments = safe
    .filter((r) => r.analyticsPlayerId)
    .map((r) => ({
      nbaPlayerId: r.nbaPlayerId,
      analyticsPlayerId: r.analyticsPlayerId!,
      fullName: r.fullName,
      teamAbbr: r.teamAbbr,
    }));
  const duplicateCanonical = findDuplicateCanonicalAssignments(assignments);
  const conflictCanonical = new Set(
    duplicateCanonical.map((d) => d.analyticsPlayerId)
  );
  const conflictNba = new Set(multiTeamNbaIds);

  const actions: SimulatedSeedAction[] = [];
  for (const r of results) {
    const base = {
      nbaPlayerId: r.nbaPlayerId,
      fullName: r.fullName,
      teamAbbr: r.teamAbbr,
      analyticsPlayerId: r.analyticsPlayerId,
      season: '2026' as const,
      observedFrom: observedOn,
      observedTo: null,
      source: 'nba_stats' as const,
      sourcePlayerId: r.nbaPlayerId,
      jersey: r.jersey,
      position: r.position,
      membershipType: 'standard' as const,
      resolveStatus: r.status,
      reason: r.reason,
    };

    if (conflictNba.has(r.nbaPlayerId)) {
      actions.push({
        ...base,
        action: 'conflict',
        membershipType: null,
        reason: `NBA player appears on multiple 2026 teams: ${[
          ...(nbaIdTeams.get(r.nbaPlayerId) ?? []),
        ].join(',')}`,
      });
      continue;
    }
    if (
      r.analyticsPlayerId &&
      conflictCanonical.has(r.analyticsPlayerId) &&
      (r.status === 'provider_match' || r.status === 'safe_fallback_match')
    ) {
      actions.push({
        ...base,
        action: 'conflict',
        membershipType: null,
        reason: `Duplicate canonical assignment for analytics id ${r.analyticsPlayerId}`,
      });
      continue;
    }
    if (r.status === 'unresolved') {
      actions.push({
        ...base,
        action: 'skip_unresolved',
        membershipType: null,
      });
      continue;
    }
    if (r.status === 'ambiguous') {
      actions.push({
        ...base,
        action: 'skip_ambiguous',
        membershipType: null,
      });
      continue;
    }
    actions.push({
      ...base,
      action: 'open_new_2026_stint',
      analyticsPlayerId: r.analyticsPlayerId,
    });
  }

  return { actions, duplicateCanonical, multiTeamNbaIds };
}

export function compare2026VsOpen2025(args: {
  results: ResolveResult[];
  open2025ByPlayer: Map<string, Open2025Stint>;
  lastPgl2025ByPlayer: Map<string, LastPglTeam>;
}): OffseasonCompareRow[] {
  const rows: OffseasonCompareRow[] = [];
  const nbaMulti = new Map<string, Set<string>>();
  for (const r of args.results) {
    const s = nbaMulti.get(r.nbaPlayerId) ?? new Set();
    s.add(r.teamAbbr);
    nbaMulti.set(r.nbaPlayerId, s);
  }

  for (const r of args.results) {
    if (nbaMulti.get(r.nbaPlayerId)!.size > 1) {
      rows.push({
        nbaPlayerId: r.nbaPlayerId,
        fullName: r.fullName,
        team2026: r.teamAbbr,
        analyticsPlayerId: r.analyticsPlayerId,
        open2025Team: null,
        lastPgl2025Team: null,
        classification: 'multi_team_2026_collision',
      });
      continue;
    }

    const analyticsId = r.analyticsPlayerId;
    const open = analyticsId
      ? args.open2025ByPlayer.get(analyticsId)
      : undefined;
    const lastPgl = analyticsId
      ? args.lastPgl2025ByPlayer.get(analyticsId)
      : undefined;

    if (!open) {
      rows.push({
        nbaPlayerId: r.nbaPlayerId,
        fullName: r.fullName,
        team2026: r.teamAbbr,
        analyticsPlayerId: analyticsId,
        open2025Team: null,
        lastPgl2025Team: lastPgl?.teamAbbr ?? null,
        classification: 'no_prior_open_stint',
      });
      continue;
    }

    if (open.teamAbbr === r.teamAbbr) {
      const pglDiff =
        lastPgl && lastPgl.teamAbbr !== r.teamAbbr
          ? 'pgl_differs_from_2026'
          : 'returning_same_team';
      rows.push({
        nbaPlayerId: r.nbaPlayerId,
        fullName: r.fullName,
        team2026: r.teamAbbr,
        analyticsPlayerId: analyticsId,
        open2025Team: open.teamAbbr,
        lastPgl2025Team: lastPgl?.teamAbbr ?? null,
        classification: pglDiff,
      });
      continue;
    }

    rows.push({
      nbaPlayerId: r.nbaPlayerId,
      fullName: r.fullName,
      team2026: r.teamAbbr,
      analyticsPlayerId: analyticsId,
      open2025Team: open.teamAbbr,
      lastPgl2025Team: lastPgl?.teamAbbr ?? null,
      classification: 'offseason_team_change',
    });
  }

  return rows;
}

export function summarizeResolution(results: ResolveResult[]): {
  total: number;
  provider_match: number;
  safe_fallback_match: number;
  unresolved: number;
  ambiguous: number;
  resolution_pct: number;
  by_team: Record<
    string,
    {
      total: number;
      resolved: number;
      unresolved: number;
      ambiguous: number;
    }
  >;
} {
  const counts = {
    total: results.length,
    provider_match: 0,
    safe_fallback_match: 0,
    unresolved: 0,
    ambiguous: 0,
    resolution_pct: 0,
    by_team: {} as Record<
      string,
      {
        total: number;
        resolved: number;
        unresolved: number;
        ambiguous: number;
      }
    >,
  };
  for (const r of results) {
    counts[r.status] += 1;
    const t = counts.by_team[r.teamAbbr] ?? {
      total: 0,
      resolved: 0,
      unresolved: 0,
      ambiguous: 0,
    };
    t.total += 1;
    if (r.status === 'provider_match' || r.status === 'safe_fallback_match') {
      t.resolved += 1;
    } else if (r.status === 'unresolved') t.unresolved += 1;
    else if (r.status === 'ambiguous') t.ambiguous += 1;
    counts.by_team[r.teamAbbr] = t;
  }
  const resolved = counts.provider_match + counts.safe_fallback_match;
  counts.resolution_pct =
    counts.total === 0
      ? 0
      : Math.round((resolved / counts.total) * 10000) / 100;
  return counts;
}

/** Dry-run contract: probe helpers never mutate DB. */
export const ROSTER_PROBE_WRITES_STINTS = false as const;
