/**
 * Phase 2.T.2D.2 — Entity-based 2026–27 roster seed planner.
 *
 * Opens season-scoped stints for safely resolved entities only.
 * Never closes 2025 rows. Never fabricates BDL / analytics.players.
 */

import {
  findDuplicateCanonicalAssignments,
  PIPPEN_BDL_ID,
  PIPPEN_NBA_ID,
  WILSON_BDL_ID,
  WILSON_NBA_ID,
} from './identity-integrity';
import type { EntityResolveResult } from './entity-roster-resolve';

export const SEED_2026_SEASON = '2026' as const;
export const SEED_2026_SOURCE = 'nba_stats' as const;
export const SEED_2026_WRITES_2025 = false as const;

/** Expected Class D / ambiguous NBA ids from 1cC (fail-closed). */
export const EXPECTED_CLASS_D_2026: ReadonlyArray<{
  nbaPlayerId: string;
  name: string;
  team: string;
}> = [
  { nbaPlayerId: '1630811', name: 'Keaton Wallace', team: 'ATL' },
  { nbaPlayerId: '1630314', name: 'Brandon Williams', team: 'GSW' },
  { nbaPlayerId: '1630696', name: 'Dru Smith', team: 'MIA' },
  { nbaPlayerId: '1629018', name: 'Gary Trent Jr.', team: 'MIL' },
  { nbaPlayerId: '1631119', name: 'Jaylin Williams', team: 'OKC' },
  { nbaPlayerId: '1642392', name: 'Jameer Nelson Jr.', team: 'PHI' },
  { nbaPlayerId: '1630695', name: 'Micah Potter', team: 'POR' },
];

export type ExistingOpenStint2026 = {
  stintId: number;
  playerEntityId: string;
  playerId: string | null;
  teamId: string;
  observedFrom: string;
  sourcePlayerId: string | null;
  jersey: string | null;
  position: string | null;
};

export type SeedMutation =
  | {
      type: 'open';
      season: '2026';
      playerEntityId: string;
      playerId: string | null;
      teamId: string;
      teamAbbr: string;
      observedFrom: string;
      source: 'nba_stats';
      sourcePlayerId: string;
      jersey: string | null;
      position: string | null;
      membershipType: null;
      fullName: string;
      hasBdl: boolean;
    }
  | {
      type: 'touch';
      stintId: number;
      playerEntityId: string;
      teamAbbr: string;
      jersey: string | null;
      position: string | null;
      fullName: string;
      hasBdl: boolean;
    }
  | {
      type: 'skip_ambiguous' | 'skip_unresolved' | 'conflict';
      nbaPlayerId: string;
      fullName: string;
      teamAbbr: string;
      reason: string;
      playerEntityId: string | null;
      candidates?: Array<{ playerEntityId: string; displayName: string }>;
    };

export type IntegrityGate = {
  ok: boolean;
  total: number;
  resolved: number;
  ambiguous: number;
  unresolved: number;
  duplicateEntities: number;
  multiTeamNbaIds: number;
  stints2026Before: number;
  classDMatch: boolean;
  classDActual: Array<{ nbaPlayerId: string; fullName: string; teamAbbr: string }>;
  failures: string[];
};

export function assertIntegrityGate(args: {
  results: EntityResolveResult[];
  stints2026Before: number;
  duplicateEntityCount: number;
  multiTeamNbaIds: string[];
}): IntegrityGate {
  const total = args.results.length;
  const resolved = args.results.filter(
    (r) =>
      r.status === 'entity_provider_match' ||
      r.status === 'entity_safe_fallback'
  ).length;
  const ambiguous = args.results.filter((r) => r.status === 'ambiguous').length;
  const unresolved = args.results.filter((r) => r.status === 'unresolved').length;
  const classDActual = args.results
    .filter((r) => r.status === 'ambiguous')
    .map((r) => ({
      nbaPlayerId: r.nbaPlayerId,
      fullName: r.fullName,
      teamAbbr: r.teamAbbr,
    }))
    .sort((a, b) => a.nbaPlayerId.localeCompare(b.nbaPlayerId));

  const expectedIds = new Set(EXPECTED_CLASS_D_2026.map((c) => c.nbaPlayerId));
  const actualIds = new Set(classDActual.map((c) => c.nbaPlayerId));
  const classDMatch =
    expectedIds.size === actualIds.size &&
    [...expectedIds].every((id) => actualIds.has(id));

  const failures: string[] = [];
  if (total !== 585) failures.push(`total=${total} expected 585`);
  if (resolved !== 578) failures.push(`resolved=${resolved} expected 578`);
  if (ambiguous !== 7) failures.push(`ambiguous=${ambiguous} expected 7`);
  if (unresolved !== 0) failures.push(`unresolved=${unresolved} expected 0`);
  if (args.duplicateEntityCount !== 0)
    failures.push(`duplicateEntities=${args.duplicateEntityCount}`);
  if (args.multiTeamNbaIds.length !== 0)
    failures.push(`multiTeamNbaIds=${args.multiTeamNbaIds.join(',')}`);
  if (args.stints2026Before !== 0 && args.stints2026Before !== 578) {
    // First apply requires 0; rerun allows exactly 578 already seeded
    if (args.stints2026Before !== 578) {
      failures.push(
        `stints2026Before=${args.stints2026Before} (expected 0 first apply or 578 rerun)`
      );
    }
  }
  if (!classDMatch) {
    failures.push(
      `Class D queue mismatch: expected [${[...expectedIds].sort().join(',')}] got [${[...actualIds].sort().join(',')}]`
    );
  }

  // For first apply gate, stints must be 0 — caller passes allowRerun
  return {
    ok: failures.length === 0,
    total,
    resolved,
    ambiguous,
    unresolved,
    duplicateEntities: args.duplicateEntityCount,
    multiTeamNbaIds: args.multiTeamNbaIds.length,
    stints2026Before: args.stints2026Before,
    classDMatch,
    classDActual,
    failures,
  };
}

export function assertIntegrityGateFirstApply(gate: IntegrityGate): IntegrityGate {
  const failures = [...gate.failures];
  if (gate.stints2026Before !== 0) {
    failures.push(
      `first apply requires stints2026=0, got ${gate.stints2026Before}`
    );
  }
  return { ...gate, ok: failures.length === 0, failures };
}

export function planEntity2026SeedMutations(args: {
  observedOn: string;
  results: EntityResolveResult[];
  teamIdByAbbr: Map<string, string>;
  existingOpen2026: ExistingOpenStint2026[];
  /** Only set player_id when this BDL id exists in analytics.players */
  analyticsPlayerIds: Set<string>;
}): {
  mutations: SeedMutation[];
  duplicateEntities: ReturnType<typeof findDuplicateCanonicalAssignments>;
  multiTeamNbaIds: string[];
  counts: {
    open: number;
    touch: number;
    skip_ambiguous: number;
    skip_unresolved: number;
    conflict: number;
    open_bdl: number;
    open_nba_only: number;
  };
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

  const existingByEntity = new Map(
    args.existingOpen2026.map((s) => [s.playerEntityId, s])
  );

  const mutations: SeedMutation[] = [];
  const counts = {
    open: 0,
    touch: 0,
    skip_ambiguous: 0,
    skip_unresolved: 0,
    conflict: 0,
    open_bdl: 0,
    open_nba_only: 0,
  };

  for (const r of args.results) {
    if (conflictNba.has(r.nbaPlayerId)) {
      mutations.push({
        type: 'conflict',
        nbaPlayerId: r.nbaPlayerId,
        fullName: r.fullName,
        teamAbbr: r.teamAbbr,
        reason: `NBA player on multiple 2026 teams: ${[...(nbaTeams.get(r.nbaPlayerId) ?? [])].join(',')}`,
        playerEntityId: r.playerEntityId,
      });
      counts.conflict += 1;
      continue;
    }
    if (
      r.playerEntityId &&
      conflictEntities.has(r.playerEntityId) &&
      (r.status === 'entity_provider_match' ||
        r.status === 'entity_safe_fallback')
    ) {
      mutations.push({
        type: 'conflict',
        nbaPlayerId: r.nbaPlayerId,
        fullName: r.fullName,
        teamAbbr: r.teamAbbr,
        reason: `Duplicate entity assignment ${r.playerEntityId}`,
        playerEntityId: r.playerEntityId,
      });
      counts.conflict += 1;
      continue;
    }
    if (r.status === 'unresolved') {
      mutations.push({
        type: 'skip_unresolved',
        nbaPlayerId: r.nbaPlayerId,
        fullName: r.fullName,
        teamAbbr: r.teamAbbr,
        reason: r.reason ?? 'unresolved',
        playerEntityId: null,
      });
      counts.skip_unresolved += 1;
      continue;
    }
    if (r.status === 'ambiguous') {
      mutations.push({
        type: 'skip_ambiguous',
        nbaPlayerId: r.nbaPlayerId,
        fullName: r.fullName,
        teamAbbr: r.teamAbbr,
        reason: r.reason ?? 'ambiguous / Class D',
        playerEntityId: null,
        candidates: r.candidates,
      });
      counts.skip_ambiguous += 1;
      continue;
    }

    const teamId = args.teamIdByAbbr.get(r.teamAbbr);
    if (!teamId || !r.playerEntityId) {
      mutations.push({
        type: 'skip_unresolved',
        nbaPlayerId: r.nbaPlayerId,
        fullName: r.fullName,
        teamAbbr: r.teamAbbr,
        reason: !teamId ? `Unknown team ${r.teamAbbr}` : 'Missing entity',
        playerEntityId: r.playerEntityId,
      });
      counts.skip_unresolved += 1;
      continue;
    }

    const playerId =
      r.analyticsPlayerId && args.analyticsPlayerIds.has(r.analyticsPlayerId)
        ? r.analyticsPlayerId
        : null;
    const hasBdl = playerId != null;
    const existing = existingByEntity.get(r.playerEntityId);

    if (existing) {
      if (existing.teamId !== teamId) {
        mutations.push({
          type: 'conflict',
          nbaPlayerId: r.nbaPlayerId,
          fullName: r.fullName,
          teamAbbr: r.teamAbbr,
          reason: `Existing open 2026 stint on different team_id=${existing.teamId}`,
          playerEntityId: r.playerEntityId,
        });
        counts.conflict += 1;
        continue;
      }
      mutations.push({
        type: 'touch',
        stintId: existing.stintId,
        playerEntityId: r.playerEntityId,
        teamAbbr: r.teamAbbr,
        jersey: r.jersey,
        position: r.position,
        fullName: r.fullName,
        hasBdl,
      });
      counts.touch += 1;
      continue;
    }

    mutations.push({
      type: 'open',
      season: SEED_2026_SEASON,
      playerEntityId: r.playerEntityId,
      playerId,
      teamId,
      teamAbbr: r.teamAbbr,
      observedFrom: args.observedOn,
      source: SEED_2026_SOURCE,
      sourcePlayerId: r.nbaPlayerId,
      jersey: r.jersey,
      position: r.position,
      membershipType: null,
      fullName: r.fullName,
      hasBdl,
    });
    counts.open += 1;
    if (hasBdl) counts.open_bdl += 1;
    else counts.open_nba_only += 1;
  }

  return { mutations, duplicateEntities, multiTeamNbaIds, counts };
}

export function classifyCrossSeason(args: {
  open2025: Array<{ playerEntityId: string; teamId: string }>;
  open2026: Array<{ playerEntityId: string; teamId: string }>;
}): {
  returning_same_team: number;
  offseason_team_change: number;
  no_prior_2025_open_stint: number;
} {
  const map2025 = new Map(args.open2025.map((r) => [r.playerEntityId, r.teamId]));
  let returning_same_team = 0;
  let offseason_team_change = 0;
  let no_prior_2025_open_stint = 0;
  for (const r of args.open2026) {
    const prior = map2025.get(r.playerEntityId);
    if (!prior) no_prior_2025_open_stint += 1;
    else if (prior === r.teamId) returning_same_team += 1;
    else offseason_team_change += 1;
  }
  return { returning_same_team, offseason_team_change, no_prior_2025_open_stint };
}

export function wilsonPippenSeedExpectations() {
  return {
    wilson: { nbaId: WILSON_NBA_ID, bdlId: WILSON_BDL_ID },
    pippen: { nbaId: PIPPEN_NBA_ID, bdlId: PIPPEN_BDL_ID },
  };
}
