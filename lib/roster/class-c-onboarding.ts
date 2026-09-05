/**
 * Class C NBA-only entity onboarding + entity-based 2026 seed simulation.
 */

import { createHash } from 'node:crypto';
import {
  PLAYER_ENTITY_NAMESPACE,
  uuidV5,
} from './player-entity-backfill';
import type { EntityResolveResult } from './entity-roster-resolve';
import { findDuplicateCanonicalAssignments } from './identity-integrity';

export const CLASS_C_SOURCE = 'phase2_t2d_1cc_nba_roster';
export const STINT_ENTITY_MIGRATE_WRITES_2026 = false as const;

export function entityIdForNbaPlayer(nbaPlayerId: string): string {
  return uuidV5(PLAYER_ENTITY_NAMESPACE, `nba:${nbaPlayerId}`);
}

export type ClassCCandidate = {
  nbaPlayerId: string;
  fullName: string;
  teamAbbr: string;
  jersey: string | null;
  position: string | null;
  status: string;
  gapCause: string | null;
};

export type ClassCPlanItem = {
  action: 'create_nba_only_entity' | 'reuse_existing' | 'skip_class_d' | 'skip_other';
  nbaPlayerId: string;
  fullName: string;
  teamAbbr: string;
  jersey: string | null;
  position: string | null;
  playerEntityId: string | null;
  createEntity: boolean;
  createNbaMapping: boolean;
  reason: string;
};

export function planClassCOnboarding(args: {
  queue: ClassCCandidate[];
  existingNbaToEntity: Map<string, string>;
}): ClassCPlanItem[] {
  const items: ClassCPlanItem[] = [];
  for (const q of args.queue) {
    if (q.status === 'ambiguous' || q.gapCause === 'conflicting_identities') {
      items.push({
        action: 'skip_class_d',
        nbaPlayerId: q.nbaPlayerId,
        fullName: q.fullName,
        teamAbbr: q.teamAbbr,
        jersey: q.jersey,
        position: q.position,
        playerEntityId: null,
        createEntity: false,
        createNbaMapping: false,
        reason: 'Class D / ambiguous — fail closed',
      });
      continue;
    }

    const existing = args.existingNbaToEntity.get(q.nbaPlayerId);
    if (existing) {
      items.push({
        action: 'reuse_existing',
        nbaPlayerId: q.nbaPlayerId,
        fullName: q.fullName,
        teamAbbr: q.teamAbbr,
        jersey: q.jersey,
        position: q.position,
        playerEntityId: existing,
        createEntity: false,
        createNbaMapping: false,
        reason: 'NBA provider mapping already exists',
      });
      continue;
    }

    if (
      q.status === 'unresolved' ||
      q.gapCause === 'rookie_or_new_player' ||
      q.gapCause === 'analytics_player_absent'
    ) {
      const entityId = entityIdForNbaPlayer(q.nbaPlayerId);
      items.push({
        action: 'create_nba_only_entity',
        nbaPlayerId: q.nbaPlayerId,
        fullName: q.fullName,
        teamAbbr: q.teamAbbr,
        jersey: q.jersey,
        position: q.position,
        playerEntityId: entityId,
        createEntity: true,
        createNbaMapping: true,
        reason: 'Legitimate NBA.com roster player without BDL identity',
      });
      continue;
    }

    items.push({
      action: 'skip_other',
      nbaPlayerId: q.nbaPlayerId,
      fullName: q.fullName,
      teamAbbr: q.teamAbbr,
      jersey: q.jersey,
      position: q.position,
      playerEntityId: null,
      createEntity: false,
      createNbaMapping: false,
      reason: `Unhandled status/gap: ${q.status}/${q.gapCause}`,
    });
  }
  return items;
}

export function splitDisplayName(fullName: string): {
  firstName: string | null;
  lastName: string | null;
} {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: null, lastName: null };
  if (parts.length === 1) return { firstName: parts[0]!, lastName: null };
  return {
    firstName: parts[0]!,
    lastName: parts.slice(1).join(' '),
  };
}

export type EntitySeedAction =
  | {
      action: 'open_new_2026_stint';
      playerEntityId: string;
      analyticsPlayerId: string | null;
      nbaPlayerId: string;
      fullName: string;
      teamAbbr: string;
      teamId: string;
      season: '2026';
      observedFrom: string;
      observedTo: null;
      source: 'nba_stats';
      jersey: string | null;
      position: string | null;
      membershipType: 'standard' | null;
    }
  | {
      action: 'skip_unresolved' | 'skip_ambiguous' | 'conflict';
      playerEntityId: string | null;
      analyticsPlayerId: string | null;
      nbaPlayerId: string;
      fullName: string;
      teamAbbr: string;
      reason: string;
    };

export function planEntity2026SeedDryRun(args: {
  observedOn: string;
  results: EntityResolveResult[];
  teamIdByAbbr: Map<string, string>;
}): {
  actions: EntitySeedAction[];
  duplicateEntities: ReturnType<typeof findDuplicateCanonicalAssignments>;
  multiTeamNbaIds: string[];
} {
  const nbaTeams = new Map<string, Set<string>>();
  for (const r of args.results) {
    const s = nbaTeams.get(r.nbaPlayerId) ?? new Set();
    s.add(r.teamAbbr);
    nbaTeams.set(r.nbaPlayerId, s);
  }
  const multiTeamNbaIds = [...nbaTeams.entries()]
    .filter(([, t]) => t.size > 1)
    .map(([id]) => id)
    .sort();

  const safe = args.results.filter(
    (r) =>
      (r.status === 'entity_provider_match' ||
        r.status === 'entity_safe_fallback') &&
      r.playerEntityId
  );
  const assignments = safe.map((r) => ({
    nbaPlayerId: r.nbaPlayerId,
    analyticsPlayerId: r.playerEntityId!,
    fullName: r.fullName,
    teamAbbr: r.teamAbbr,
  }));
  const duplicateEntities = findDuplicateCanonicalAssignments(assignments);
  const conflictEntities = new Set(
    duplicateEntities.map((d) => d.analyticsPlayerId)
  );
  const conflictNba = new Set(multiTeamNbaIds);

  const actions: EntitySeedAction[] = [];
  for (const r of args.results) {
    if (conflictNba.has(r.nbaPlayerId)) {
      actions.push({
        action: 'conflict',
        playerEntityId: r.playerEntityId,
        analyticsPlayerId: r.analyticsPlayerId,
        nbaPlayerId: r.nbaPlayerId,
        fullName: r.fullName,
        teamAbbr: r.teamAbbr,
        reason: `NBA player on multiple 2026 teams: ${[...(nbaTeams.get(r.nbaPlayerId) ?? [])].join(',')}`,
      });
      continue;
    }
    if (
      r.playerEntityId &&
      conflictEntities.has(r.playerEntityId) &&
      (r.status === 'entity_provider_match' ||
        r.status === 'entity_safe_fallback')
    ) {
      actions.push({
        action: 'conflict',
        playerEntityId: r.playerEntityId,
        analyticsPlayerId: r.analyticsPlayerId,
        nbaPlayerId: r.nbaPlayerId,
        fullName: r.fullName,
        teamAbbr: r.teamAbbr,
        reason: `Duplicate entity assignment ${r.playerEntityId}`,
      });
      continue;
    }
    if (r.status === 'unresolved') {
      actions.push({
        action: 'skip_unresolved',
        playerEntityId: null,
        analyticsPlayerId: null,
        nbaPlayerId: r.nbaPlayerId,
        fullName: r.fullName,
        teamAbbr: r.teamAbbr,
        reason: r.reason ?? 'unresolved',
      });
      continue;
    }
    if (r.status === 'ambiguous') {
      actions.push({
        action: 'skip_ambiguous',
        playerEntityId: null,
        analyticsPlayerId: null,
        nbaPlayerId: r.nbaPlayerId,
        fullName: r.fullName,
        teamAbbr: r.teamAbbr,
        reason: r.reason ?? 'ambiguous',
      });
      continue;
    }

    const teamId = args.teamIdByAbbr.get(r.teamAbbr);
    if (!teamId || !r.playerEntityId) {
      actions.push({
        action: 'skip_unresolved',
        playerEntityId: r.playerEntityId,
        analyticsPlayerId: r.analyticsPlayerId,
        nbaPlayerId: r.nbaPlayerId,
        fullName: r.fullName,
        teamAbbr: r.teamAbbr,
        reason: !teamId ? `Unknown team ${r.teamAbbr}` : 'Missing entity',
      });
      continue;
    }

    actions.push({
      action: 'open_new_2026_stint',
      playerEntityId: r.playerEntityId,
      analyticsPlayerId: r.analyticsPlayerId,
      nbaPlayerId: r.nbaPlayerId,
      fullName: r.fullName,
      teamAbbr: r.teamAbbr,
      teamId,
      season: '2026',
      observedFrom: args.observedOn,
      observedTo: null,
      source: 'nba_stats',
      jersey: r.jersey,
      position: r.position,
      membershipType: 'standard',
    });
  }

  return { actions, duplicateEntities, multiTeamNbaIds };
}

/** Prove uuid helper is available without inventing BDL ids. */
export function assertNoFabricatedBdlInClassC(items: ClassCPlanItem[]): void {
  for (const i of items) {
    if (i.action === 'create_nba_only_entity' && i.playerEntityId) {
      const expected = entityIdForNbaPlayer(i.nbaPlayerId);
      if (i.playerEntityId !== expected) {
        throw new Error(`Non-deterministic NBA entity id for ${i.nbaPlayerId}`);
      }
    }
  }
  void createHash;
}
