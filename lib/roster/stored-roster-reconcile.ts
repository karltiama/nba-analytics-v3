/**
 * Season-2026 reconciliation plan from a stored roster batch.
 *
 * Read-only. Absence from the batch is not a departure. A close is prepared
 * only when the same player entity is positively on a different team.
 * Season 2025 and earlier are never inputs to a mutation.
 */

import { evaluateMassCloseGuard, type MassCloseGuard } from './entity-roster-refresh';

export const STORED_ROSTER_RECONCILE_SEASON = '2026';
export const STORED_ROSTER_SOURCE = 'balldontlie';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export type StoredBatchMember = {
  providerPlayerId: string;
  teamAbbr: string;
};

export type RosterIdentityCandidate = {
  providerPlayerId: string;
  playerEntityId: string;
  playerId: string | null;
  fullName: string | null;
};

export type OpenRosterStint = {
  stintId: number;
  playerEntityId: string;
  playerId: string | null;
  teamId: string;
  season: string;
  observedFrom: string;
};

export type CanonicalTeam = {
  teamId: string;
  abbreviation: string;
};

export type PreparedTeamChange = {
  stintId: number;
  playerEntityId: string;
  playerId: string | null;
  fullName: string | null;
  providerPlayerId: string;
  fromTeamId: string;
  toTeamId: string;
  toTeamAbbr: string;
  closeObservedTo: string;
  openObservedFrom: string;
  source: typeof STORED_ROSTER_SOURCE;
};

export type PreparedOpen = {
  playerEntityId: string;
  playerId: string | null;
  fullName: string | null;
  providerPlayerId: string;
  teamId: string;
  teamAbbr: string;
  observedFrom: string;
  source: typeof STORED_ROSTER_SOURCE;
};

export type ReconcileExclusion = {
  kind:
    | 'unresolved'
    | 'ambiguous_identity'
    | 'conflicting_membership'
    | 'unknown_team'
    | 'missing_from_batch';
  providerPlayerId: string | null;
  playerEntityId: string | null;
  fullName: string | null;
  detail: string;
};

export type StoredRosterPlan = {
  season: typeof STORED_ROSTER_RECONCILE_SEASON;
  observedOn: string;
  source: typeof STORED_ROSTER_SOURCE;
  unchanged: number;
  teamChanges: PreparedTeamChange[];
  opens: PreparedOpen[];
  exclusions: ReconcileExclusion[];
  /** Closes that would be implied by absence. Always zero in the prepared writes. */
  preparedAbsenceCloses: 0;
  massCloseIfAbsenceWereApplied: MassCloseGuard;
};

function observedTo(observedOn: string, observedFrom: string): string {
  return observedOn < observedFrom ? observedFrom : observedOn;
}

/**
 * Plan writes for one stored batch. Throws if the season is not 2026.
 * Does not close stints that are merely absent from the batch.
 */
export function planStoredRosterReconcile(args: {
  season: string;
  observedOn: string;
  members: readonly StoredBatchMember[];
  identities: readonly RosterIdentityCandidate[];
  openStints: readonly OpenRosterStint[];
  teams: readonly CanonicalTeam[];
}): StoredRosterPlan {
  if (args.season !== STORED_ROSTER_RECONCILE_SEASON) {
    throw new Error(`Stored roster reconcile is season 2026 only, got ${args.season}`);
  }
  if (!YMD.test(args.observedOn)) {
    throw new Error(`observedOn must be YYYY-MM-DD, got ${args.observedOn}`);
  }

  const teamByAbbr = new Map<string, string>();
  const duplicateAbbr = new Set<string>();
  for (const team of args.teams) {
    const abbr = team.abbreviation.trim();
    const existing = teamByAbbr.get(abbr);
    if (existing && existing !== team.teamId) duplicateAbbr.add(abbr);
    else teamByAbbr.set(abbr, team.teamId);
  }

  const identitiesByProvider = new Map<string, RosterIdentityCandidate[]>();
  for (const row of args.identities) {
    const list = identitiesByProvider.get(row.providerPlayerId) ?? [];
    list.push(row);
    identitiesByProvider.set(row.providerPlayerId, list);
  }

  const membersByProvider = new Map<string, Set<string>>();
  for (const member of args.members) {
    const id = member.providerPlayerId.trim();
    const abbr = member.teamAbbr.trim();
    if (!id || !abbr) continue;
    const teams = membersByProvider.get(id) ?? new Set();
    teams.add(abbr);
    membersByProvider.set(id, teams);
  }

  const exclusions: ReconcileExclusion[] = [];
  const confident = new Map<
    string,
    { entityId: string; playerId: string | null; fullName: string | null; providerPlayerId: string; teamId: string; teamAbbr: string }
  >();

  for (const [providerPlayerId, abbrs] of membersByProvider) {
    const candidates = identitiesByProvider.get(providerPlayerId) ?? [];
    const entityIds = [...new Set(candidates.map((c) => c.playerEntityId))];
    const fullName = candidates.find((c) => c.fullName)?.fullName ?? null;
    if (abbrs.size !== 1) {
      exclusions.push({
        kind: 'conflicting_membership',
        providerPlayerId,
        playerEntityId: entityIds.length === 1 ? entityIds[0]! : null,
        fullName,
        detail: `Batch lists ${[...abbrs].sort().join(', ')}`,
      });
      continue;
    }
    const teamAbbr = [...abbrs][0]!;
    if (duplicateAbbr.has(teamAbbr) || !teamByAbbr.has(teamAbbr)) {
      exclusions.push({
        kind: 'unknown_team',
        providerPlayerId,
        playerEntityId: entityIds.length === 1 ? entityIds[0]! : null,
        fullName,
        detail: teamAbbr,
      });
      continue;
    }
    if (entityIds.length === 0) {
      exclusions.push({
        kind: 'unresolved',
        providerPlayerId,
        playerEntityId: null,
        fullName: null,
        detail: 'No canonical player entity for this provider id',
      });
      continue;
    }
    if (entityIds.length > 1) {
      exclusions.push({
        kind: 'ambiguous_identity',
        providerPlayerId,
        playerEntityId: null,
        fullName,
        detail: entityIds.join(','),
      });
      continue;
    }
    const entityId = entityIds[0]!;
    const playerIds = [
      ...new Set(
        candidates
          .map((c) => c.playerId)
          .filter((id): id is string => id != null && id !== '')
      ),
    ];
    confident.set(providerPlayerId, {
      entityId,
      playerId: playerIds.length === 1 ? playerIds[0]! : null,
      fullName,
      providerPlayerId,
      teamId: teamByAbbr.get(teamAbbr)!,
      teamAbbr,
    });
  }

  const byEntity = new Map<string, typeof confident extends Map<string, infer V> ? V[] : never>();
  for (const row of confident.values()) {
    const list = byEntity.get(row.entityId) ?? [];
    list.push(row);
    byEntity.set(row.entityId, list);
  }
  for (const [entityId, rows] of byEntity) {
    const teams = new Set(rows.map((r) => r.teamId));
    if (teams.size <= 1) continue;
    for (const row of rows) {
      confident.delete(row.providerPlayerId);
      exclusions.push({
        kind: 'conflicting_membership',
        providerPlayerId: row.providerPlayerId,
        playerEntityId: entityId,
        fullName: row.fullName,
        detail: 'One player entity is on more than one team in the batch',
      });
    }
  }

  const openThisSeason = args.openStints.filter((s) => s.season === args.season);
  const openByEntity = new Map<string, OpenRosterStint>();
  for (const stint of openThisSeason) {
    const existing = openByEntity.get(stint.playerEntityId);
    if (existing) {
      throw new Error(
        `Two open stints for entity ${stint.playerEntityId} in season ${args.season}`
      );
    }
    openByEntity.set(stint.playerEntityId, stint);
  }

  const teamChanges: PreparedTeamChange[] = [];
  const opens: PreparedOpen[] = [];
  const seenEntities = new Set<string>();
  let unchanged = 0;

  for (const row of confident.values()) {
    if (seenEntities.has(row.entityId)) continue;
    seenEntities.add(row.entityId);
    const open = openByEntity.get(row.entityId);
    if (!open) {
      opens.push({
        playerEntityId: row.entityId,
        playerId: row.playerId,
        fullName: row.fullName,
        providerPlayerId: row.providerPlayerId,
        teamId: row.teamId,
        teamAbbr: row.teamAbbr,
        observedFrom: args.observedOn,
        source: STORED_ROSTER_SOURCE,
      });
      continue;
    }
    if (open.teamId === row.teamId) {
      unchanged += 1;
      continue;
    }
    teamChanges.push({
      stintId: open.stintId,
      playerEntityId: row.entityId,
      playerId: row.playerId ?? open.playerId,
      fullName: row.fullName,
      providerPlayerId: row.providerPlayerId,
      fromTeamId: open.teamId,
      toTeamId: row.teamId,
      toTeamAbbr: row.teamAbbr,
      closeObservedTo: observedTo(args.observedOn, open.observedFrom),
      openObservedFrom: args.observedOn,
      source: STORED_ROSTER_SOURCE,
    });
  }

  const missing: ReconcileExclusion[] = [];
  for (const stint of openThisSeason) {
    if (seenEntities.has(stint.playerEntityId)) continue;
    missing.push({
      kind: 'missing_from_batch',
      providerPlayerId: null,
      playerEntityId: stint.playerEntityId,
      fullName: null,
      detail: `Open stint ${stint.stintId} on team ${stint.teamId} is not a positive batch membership`,
    });
  }

  const openAfter = new Set(openThisSeason.map((s) => s.playerEntityId));
  for (const change of teamChanges) {
    openAfter.delete(change.playerEntityId);
  }
  for (const row of [...teamChanges.map((c) => c.playerEntityId), ...opens.map((o) => o.playerEntityId)]) {
    if (openAfter.has(row) && !teamChanges.some((c) => c.playerEntityId === row)) {
      throw new Error(`Plan would leave two open stints for entity ${row}`);
    }
    openAfter.add(row);
  }

  return {
    season: STORED_ROSTER_RECONCILE_SEASON,
    observedOn: args.observedOn,
    source: STORED_ROSTER_SOURCE,
    unchanged,
    teamChanges,
    opens,
    exclusions: [...exclusions, ...missing],
    preparedAbsenceCloses: 0,
    massCloseIfAbsenceWereApplied: evaluateMassCloseGuard({
      openCount: openThisSeason.length,
      proposedCloseMissing: missing.length,
      allowLargeClose: false,
    }),
  };
}
