/**
 * Phase 2.T.2E — Entity-first roster refresh planner.
 *
 * Observation semantics: NBA.com CommonTeamRoster is a membership snapshot,
 * not an exact trade/waiver/signing feed.
 *
 * Diff is keyed by player_entity_id for a single analytics season.
 * Never mutates other seasons. Never fabricates BDL ids.
 */

import { findDuplicateCanonicalAssignments } from './identity-integrity';
import type { EntityResolveResult } from './entity-roster-resolve';

export const ROSTER_REFRESH_SOURCE = 'nba_stats' as const;
export const ROSTER_REFRESH_TOUCHES_OTHER_SEASONS = false as const;

/** Conservative defaults: abort apply if closes exceed both absolute floor and % of open. */
export const DEFAULT_MAX_CLOSE_ABS = 30;
export const DEFAULT_MAX_CLOSE_RATIO = 0.05;

export type FetchSummary = {
  teamsAttempted: number;
  teamsSuccessful: number;
  teamsFailed: Array<{ abbreviation: string; error?: string }>;
  totalObservations: number;
  playersPerTeam: Record<string, number>;
  duplicateNbaPlayerIds: Array<{ nba_player_id: string; teams?: string[] }>;
  minTeamSize: number | null;
};

export type FetchIntegrityResult = {
  ok: boolean;
  failures: string[];
  allowsCloses: boolean;
};

export function evaluateFetchIntegrity(fetch: FetchSummary): FetchIntegrityResult {
  const failures: string[] = [];
  if (fetch.teamsAttempted < 30) {
    failures.push(`teamsAttempted=${fetch.teamsAttempted} expected 30`);
  }
  if (fetch.teamsSuccessful < 30) {
    failures.push(
      `Incomplete fetch: ${fetch.teamsSuccessful}/${fetch.teamsAttempted} teams ok`
    );
  }
  if (fetch.teamsFailed.length > 0) {
    failures.push(
      `Team failures: ${fetch.teamsFailed.map((t) => t.abbreviation).join(',')}`
    );
  }
  if (fetch.totalObservations < 500) {
    failures.push(
      `Implausibly low roster count: ${fetch.totalObservations}`
    );
  }
  const zeroTeams = Object.entries(fetch.playersPerTeam)
    .filter(([, n]) => n === 0)
    .map(([abbr]) => abbr);
  if (zeroTeams.length > 0) {
    failures.push(`Zero-player teams: ${zeroTeams.join(',')}`);
  }
  if (fetch.minTeamSize != null && fetch.minTeamSize < 8) {
    failures.push(`Suspicious min team size: ${fetch.minTeamSize}`);
  }
  if (fetch.duplicateNbaPlayerIds.length > 0) {
    failures.push(
      `Cross-team duplicate NBA ids: ${fetch.duplicateNbaPlayerIds.length}`
    );
  }

  const ok = failures.length === 0;
  return {
    ok,
    failures,
    // Closes require a complete trustworthy fetch.
    allowsCloses: ok,
  };
}

export type EntityObservedMembership = {
  playerEntityId: string;
  playerId: string | null;
  teamId: string;
  teamAbbr: string;
  nbaPlayerId: string;
  fullName: string;
  jersey: string | null;
  position: string | null;
  hasBdl: boolean;
};

export type ExistingEntityOpenStint = {
  stintId: number;
  playerEntityId: string;
  playerId: string | null;
  teamId: string;
  season: string;
  observedFrom: string;
  jersey: string | null;
  position: string | null;
  source: string;
  sourcePlayerId: string | null;
};

export type RefreshMutation =
  | {
      type: 'touch';
      stintId: number;
      playerEntityId: string;
      jersey: string | null;
      position: string | null;
      sourcePlayerId: string | null;
      category: 'unchanged';
    }
  | {
      type: 'open';
      season: string;
      playerEntityId: string;
      playerId: string | null;
      teamId: string;
      teamAbbr: string;
      observedFrom: string;
      source: typeof ROSTER_REFRESH_SOURCE;
      sourcePlayerId: string;
      jersey: string | null;
      position: string | null;
      membershipType: null;
      fullName: string;
      category: 'open_new' | 'team_change_open';
    }
  | {
      type: 'close';
      stintId: number;
      playerEntityId: string;
      observedTo: string;
      category: 'close_missing' | 'team_change_close';
      priorTeamId: string;
    }
  | {
      type: 'skip_ambiguous' | 'skip_unresolved' | 'conflict' | 'protected_no_close';
      nbaPlayerId: string | null;
      playerEntityId: string | null;
      fullName: string;
      teamAbbr: string;
      reason: string;
    };

export type MassCloseGuard = {
  ok: boolean;
  openCount: number;
  proposedCloses: number;
  proposedCloseRatio: number;
  maxCloseAbs: number;
  maxCloseRatio: number;
  reason: string | null;
};

export function evaluateMassCloseGuard(args: {
  openCount: number;
  proposedCloseMissing: number;
  maxCloseAbs?: number;
  maxCloseRatio?: number;
  allowLargeClose?: boolean;
}): MassCloseGuard {
  const maxCloseAbs = args.maxCloseAbs ?? DEFAULT_MAX_CLOSE_ABS;
  const maxCloseRatio = args.maxCloseRatio ?? DEFAULT_MAX_CLOSE_RATIO;
  const ratio =
    args.openCount === 0 ? 0 : args.proposedCloseMissing / args.openCount;
  if (args.allowLargeClose) {
    return {
      ok: true,
      openCount: args.openCount,
      proposedCloses: args.proposedCloseMissing,
      proposedCloseRatio: ratio,
      maxCloseAbs,
      maxCloseRatio,
      reason: 'override --allow-large-close',
    };
  }
  const overAbs = args.proposedCloseMissing > maxCloseAbs;
  const overRatio = ratio > maxCloseRatio;
  // Fail-safe: either threshold exceeded aborts (conservative).
  const ok = !(overAbs || overRatio);
  return {
    ok,
    openCount: args.openCount,
    proposedCloses: args.proposedCloseMissing,
    proposedCloseRatio: ratio,
    maxCloseAbs,
    maxCloseRatio,
    reason: ok
      ? null
      : `Proposed closes ${args.proposedCloseMissing} (${(ratio * 100).toFixed(1)}%) exceed maxAbs=${maxCloseAbs} or maxRatio=${(maxCloseRatio * 100).toFixed(1)}%`,
  };
}

export function planEntityRosterRefresh(args: {
  season: string;
  observedOn: string;
  source?: typeof ROSTER_REFRESH_SOURCE;
  resolvedObservations: EntityObservedMembership[];
  existingOpenStints: ExistingEntityOpenStint[];
  /** Ambiguous / unresolved NBA ids — protect matching open stints from close. */
  protectedNbaPlayerIds: Set<string>;
  allowsCloses: boolean;
}): {
  mutations: RefreshMutation[];
  counts: {
    touch: number;
    open_new: number;
    team_change: number;
    close_missing: number;
    skip_ambiguous: number;
    skip_unresolved: number;
    conflict: number;
    protected_no_close: number;
  };
  duplicateEntities: ReturnType<typeof findDuplicateCanonicalAssignments>;
  multiTeamNbaIds: string[];
} {
  const source = args.source ?? ROSTER_REFRESH_SOURCE;
  const mutations: RefreshMutation[] = [];
  const counts = {
    touch: 0,
    open_new: 0,
    team_change: 0,
    close_missing: 0,
    skip_ambiguous: 0,
    skip_unresolved: 0,
    conflict: 0,
    protected_no_close: 0,
  };

  const nbaTeams = new Map<string, Set<string>>();
  for (const o of args.resolvedObservations) {
    const s = nbaTeams.get(o.nbaPlayerId) ?? new Set();
    s.add(o.teamAbbr);
    nbaTeams.set(o.nbaPlayerId, s);
  }
  const multiTeamNbaIds = [...nbaTeams.entries()]
    .filter(([, t]) => t.size > 1)
    .map(([id]) => id)
    .sort();
  const conflictNba = new Set(multiTeamNbaIds);

  const assignments = args.resolvedObservations.map((o) => ({
    nbaPlayerId: o.nbaPlayerId,
    analyticsPlayerId: o.playerEntityId,
    fullName: o.fullName,
    teamAbbr: o.teamAbbr,
  }));
  const duplicateEntities = findDuplicateCanonicalAssignments(assignments);
  const conflictEntities = new Set(
    duplicateEntities.map((d) => d.analyticsPlayerId)
  );

  const openByEntity = new Map<string, ExistingEntityOpenStint>();
  for (const s of args.existingOpenStints) {
    if (s.season !== args.season) continue;
    openByEntity.set(s.playerEntityId, s);
  }

  const seenEntities = new Set<string>();

  for (const obs of args.resolvedObservations) {
    if (conflictNba.has(obs.nbaPlayerId)) {
      mutations.push({
        type: 'conflict',
        nbaPlayerId: obs.nbaPlayerId,
        playerEntityId: obs.playerEntityId,
        fullName: obs.fullName,
        teamAbbr: obs.teamAbbr,
        reason: `NBA id on multiple teams: ${[...(nbaTeams.get(obs.nbaPlayerId) ?? [])].join(',')}`,
      });
      counts.conflict += 1;
      continue;
    }
    if (conflictEntities.has(obs.playerEntityId)) {
      mutations.push({
        type: 'conflict',
        nbaPlayerId: obs.nbaPlayerId,
        playerEntityId: obs.playerEntityId,
        fullName: obs.fullName,
        teamAbbr: obs.teamAbbr,
        reason: `Duplicate entity assignment ${obs.playerEntityId}`,
      });
      counts.conflict += 1;
      continue;
    }
    if (seenEntities.has(obs.playerEntityId)) continue;
    seenEntities.add(obs.playerEntityId);

    const open = openByEntity.get(obs.playerEntityId);
    if (!open) {
      mutations.push({
        type: 'open',
        season: args.season,
        playerEntityId: obs.playerEntityId,
        playerId: obs.playerId,
        teamId: obs.teamId,
        teamAbbr: obs.teamAbbr,
        observedFrom: args.observedOn,
        source,
        sourcePlayerId: obs.nbaPlayerId,
        jersey: obs.jersey,
        position: obs.position,
        membershipType: null,
        fullName: obs.fullName,
        category: 'open_new',
      });
      counts.open_new += 1;
      continue;
    }

    if (open.teamId === obs.teamId) {
      mutations.push({
        type: 'touch',
        stintId: open.stintId,
        playerEntityId: obs.playerEntityId,
        jersey: obs.jersey,
        position: obs.position,
        sourcePlayerId: obs.nbaPlayerId,
        category: 'unchanged',
      });
      counts.touch += 1;
      continue;
    }

    // Team change
    if (!args.allowsCloses) {
      mutations.push({
        type: 'conflict',
        nbaPlayerId: obs.nbaPlayerId,
        playerEntityId: obs.playerEntityId,
        fullName: obs.fullName,
        teamAbbr: obs.teamAbbr,
        reason: 'Team change deferred: fetch integrity does not allow closes',
      });
      counts.conflict += 1;
      continue;
    }

    const closeOn =
      args.observedOn < open.observedFrom
        ? open.observedFrom
        : args.observedOn;
    mutations.push({
      type: 'close',
      stintId: open.stintId,
      playerEntityId: obs.playerEntityId,
      observedTo: closeOn,
      category: 'team_change_close',
      priorTeamId: open.teamId,
    });
    mutations.push({
      type: 'open',
      season: args.season,
      playerEntityId: obs.playerEntityId,
      playerId: obs.playerId,
      teamId: obs.teamId,
      teamAbbr: obs.teamAbbr,
      observedFrom: args.observedOn,
      source,
      sourcePlayerId: obs.nbaPlayerId,
      jersey: obs.jersey,
      position: obs.position,
      membershipType: null,
      fullName: obs.fullName,
      category: 'team_change_open',
    });
    counts.team_change += 1;
  }

  // Close missing (only when fetch allows closes)
  for (const [entityId, open] of openByEntity) {
    if (seenEntities.has(entityId)) continue;
    if (open.source !== source) continue;

    const nbaId = open.sourcePlayerId;
    if (nbaId && args.protectedNbaPlayerIds.has(nbaId)) {
      mutations.push({
        type: 'protected_no_close',
        nbaPlayerId: nbaId,
        playerEntityId: entityId,
        fullName: '',
        teamAbbr: '',
        reason:
          'Open stint NBA id still appears as ambiguous/unresolved observation — do not treat as waiver',
      });
      counts.protected_no_close += 1;
      continue;
    }

    if (!args.allowsCloses) {
      mutations.push({
        type: 'conflict',
        nbaPlayerId: nbaId,
        playerEntityId: entityId,
        fullName: '',
        teamAbbr: '',
        reason: 'Close deferred: incomplete/suspicious fetch',
      });
      counts.conflict += 1;
      continue;
    }

    const closeOn =
      args.observedOn < open.observedFrom
        ? open.observedFrom
        : args.observedOn;
    mutations.push({
      type: 'close',
      stintId: open.stintId,
      playerEntityId: entityId,
      observedTo: closeOn,
      category: 'close_missing',
      priorTeamId: open.teamId,
    });
    counts.close_missing += 1;
  }

  return { mutations, counts, duplicateEntities, multiTeamNbaIds };
}

/** Convert entity resolve results into memberships + protected NBA ids. */
export function partitionResolveResults(args: {
  results: EntityResolveResult[];
  teamIdByAbbr: Map<string, string>;
  analyticsPlayerIds: Set<string>;
}): {
  resolved: EntityObservedMembership[];
  protectedNbaPlayerIds: Set<string>;
  skipMutations: RefreshMutation[];
  resolutionCounts: {
    resolved_bdl_backed: number;
    resolved_nba_only: number;
    ambiguous: number;
    unresolved: number;
  };
} {
  const resolved: EntityObservedMembership[] = [];
  const protectedNbaPlayerIds = new Set<string>();
  const skipMutations: RefreshMutation[] = [];
  const resolutionCounts = {
    resolved_bdl_backed: 0,
    resolved_nba_only: 0,
    ambiguous: 0,
    unresolved: 0,
  };

  for (const r of args.results) {
    if (r.status === 'ambiguous') {
      protectedNbaPlayerIds.add(r.nbaPlayerId);
      resolutionCounts.ambiguous += 1;
      skipMutations.push({
        type: 'skip_ambiguous',
        nbaPlayerId: r.nbaPlayerId,
        playerEntityId: null,
        fullName: r.fullName,
        teamAbbr: r.teamAbbr,
        reason: r.reason ?? 'ambiguous',
      });
      continue;
    }
    if (r.status === 'unresolved') {
      protectedNbaPlayerIds.add(r.nbaPlayerId);
      resolutionCounts.unresolved += 1;
      skipMutations.push({
        type: 'skip_unresolved',
        nbaPlayerId: r.nbaPlayerId,
        playerEntityId: null,
        fullName: r.fullName,
        teamAbbr: r.teamAbbr,
        reason: r.reason ?? 'unresolved',
      });
      continue;
    }
    if (!r.playerEntityId) continue;
    const teamId = args.teamIdByAbbr.get(r.teamAbbr);
    if (!teamId) {
      protectedNbaPlayerIds.add(r.nbaPlayerId);
      skipMutations.push({
        type: 'skip_unresolved',
        nbaPlayerId: r.nbaPlayerId,
        playerEntityId: r.playerEntityId,
        fullName: r.fullName,
        teamAbbr: r.teamAbbr,
        reason: `Unknown team ${r.teamAbbr}`,
      });
      continue;
    }
    const playerId =
      r.analyticsPlayerId && args.analyticsPlayerIds.has(r.analyticsPlayerId)
        ? r.analyticsPlayerId
        : null;
    const hasBdl = playerId != null;
    if (hasBdl) resolutionCounts.resolved_bdl_backed += 1;
    else resolutionCounts.resolved_nba_only += 1;
    resolved.push({
      playerEntityId: r.playerEntityId,
      playerId,
      teamId,
      teamAbbr: r.teamAbbr,
      nbaPlayerId: r.nbaPlayerId,
      fullName: r.fullName,
      jersey: r.jersey,
      position: r.position,
      hasBdl,
    });
  }

  return { resolved, protectedNbaPlayerIds, skipMutations, resolutionCounts };
}

export function assertSingleOpenPerEntitySeason(
  mutations: RefreshMutation[],
  existingOpenStints: ExistingEntityOpenStint[],
  season: string
): void {
  const open = new Set<string>();
  for (const s of existingOpenStints) {
    if (s.season === season) open.add(s.playerEntityId);
  }
  for (const m of mutations) {
    if (m.type === 'close') open.delete(m.playerEntityId);
    if (m.type === 'open') {
      if (open.has(m.playerEntityId)) {
        throw new Error(
          `Plan would create two open stints for entity ${m.playerEntityId} season ${season}`
        );
      }
      open.add(m.playerEntityId);
    }
  }
}

/** Group team_change close+open pairs for atomic apply. */
export function groupTeamChangePairs(mutations: RefreshMutation[]): Array<{
  close: Extract<RefreshMutation, { type: 'close' }>;
  open: Extract<RefreshMutation, { type: 'open' }>;
}> {
  const pairs: Array<{
    close: Extract<RefreshMutation, { type: 'close' }>;
    open: Extract<RefreshMutation, { type: 'open' }>;
  }> = [];
  for (let i = 0; i < mutations.length - 1; i++) {
    const a = mutations[i]!;
    const b = mutations[i + 1]!;
    if (
      a.type === 'close' &&
      a.category === 'team_change_close' &&
      b.type === 'open' &&
      b.category === 'team_change_open' &&
      a.playerEntityId === b.playerEntityId
    ) {
      pairs.push({ close: a, open: b });
    }
  }
  return pairs;
}
