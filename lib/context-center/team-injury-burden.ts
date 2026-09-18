/**
 * Team Injury Burden V2 — pure calculation from typed inputs.
 * No I/O. No predictive claims. No composite scores.
 */

import {
  CONTEXT_COMPLETENESS,
  REGULATION_TEAM_MINUTES,
  ROTATION_PLAYER_MIN_MPG,
  TEAM_INJURY_CONTEXT_VERSION,
  isSourceUnknownTeamState,
  type ContextCompleteness,
} from './types';
import { isRotationPlayer, type PlayerRoleEstimate } from './role-expectation';

export type HealthOutContributor = {
  /** Stable source row key (e.g. raw name + index). */
  sourceKey: string;
  playerEntityId: string | null;
  canonical: boolean;
  roleEstimate: PlayerRoleEstimate | null;
};

export type TeamInjuryBurdenInput = {
  gameId: string;
  teamId: string;
  season: string;
  gameStart: string;
  asOf: string;
  injuryReportPublishedAt: string | null;
  /** Upstream team_state from asof-t60. */
  teamState: string;
  healthOutContributors: readonly HealthOutContributor[];
  healthQuestionableCount: number;
  healthDoubtfulCount: number;
  healthProbableCount: number;
  nonHealthOutCount: number;
};

export type AvailabilityCounts = {
  healthOutSourceCount: number | null;
  healthOutCanonicalCount: number | null;
  healthOutUnresolvedCount: number | null;
  healthQuestionableCount: number | null;
  healthDoubtfulCount: number | null;
  healthProbableCount: number | null;
  nonHealthOutCount: number | null;
  /** Alias of healthOutCanonicalCount */
  healthOutCount: number | null;
};

export type InjuryBurdenValues = {
  expectedMissingMinutes: number | null;
  expectedMissingFga: number | null;
  expectedMissingPoints: number | null;
  missingRotationShare: number | null;
  maxMissingPriorMpg: number | null;
  rotationPlayersOutCount: number | null;
};

export type CompletenessBlock = {
  status: ContextCompleteness;
  roleRequiredCount: number;
  roleEstimatedCount: number;
  coverageRate: number | null;
};

export type TeamInjuryProvenance = {
  injuryTapeVersion: 'official-injury-asof-t60-v1';
  reasonPolicyVersion: 'official-injury-reason-policy-v1';
  identityVersion: 'official-injury-player-identity-v1';
  roleExpectationVersion: 'player-role-expectation-v1';
  contextVersion: typeof TEAM_INJURY_CONTEXT_VERSION;
  rotationDefinitionVersion: 'rotation-player-definition-v1';
};

export type TeamGameAvailabilitySnapshot = {
  grain: 'TEAM_GAME';
  gameId: string;
  teamId: string;
  season: string;
  gameStart: string;
  asOf: string;
  injuryReportPublishedAt: string | null;
  teamState: string;
  contextVersion: typeof TEAM_INJURY_CONTEXT_VERSION;
  availability: AvailabilityCounts;
  injuryBurden: InjuryBurdenValues;
  completeness: CompletenessBlock;
  provenance: TeamInjuryProvenance;
  duplicateBurdenContributions: number;
  predictiveStatus: 'NOT_TESTED';
  displayStatus: 'RESEARCH' | 'DISPLAYABLE';
};

function assertNonNegFinite(name: string, v: number): void {
  if (!Number.isFinite(v) || v < 0) {
    throw new Error(`Invalid numeric context ${name}=${v}`);
  }
}

const PROVENANCE: TeamInjuryProvenance = {
  injuryTapeVersion: 'official-injury-asof-t60-v1',
  reasonPolicyVersion: 'official-injury-reason-policy-v1',
  identityVersion: 'official-injury-player-identity-v1',
  roleExpectationVersion: 'player-role-expectation-v1',
  contextVersion: TEAM_INJURY_CONTEXT_VERSION,
  rotationDefinitionVersion: 'rotation-player-definition-v1',
};

function sourceUnknownSnapshot(
  input: TeamInjuryBurdenInput,
  displayStatus: 'RESEARCH' | 'DISPLAYABLE'
): TeamGameAvailabilitySnapshot {
  return {
    grain: 'TEAM_GAME',
    gameId: input.gameId,
    teamId: input.teamId,
    season: input.season,
    gameStart: input.gameStart,
    asOf: input.asOf,
    injuryReportPublishedAt: input.injuryReportPublishedAt,
    teamState: input.teamState,
    contextVersion: TEAM_INJURY_CONTEXT_VERSION,
    availability: {
      healthOutSourceCount: null,
      healthOutCanonicalCount: null,
      healthOutUnresolvedCount: null,
      healthQuestionableCount: null,
      healthDoubtfulCount: null,
      healthProbableCount: null,
      nonHealthOutCount: null,
      healthOutCount: null,
    },
    injuryBurden: {
      expectedMissingMinutes: null,
      expectedMissingFga: null,
      expectedMissingPoints: null,
      missingRotationShare: null,
      maxMissingPriorMpg: null,
      rotationPlayersOutCount: null,
    },
    completeness: {
      status: CONTEXT_COMPLETENESS.SOURCE_UNKNOWN,
      roleRequiredCount: 0,
      roleEstimatedCount: 0,
      coverageRate: null,
    },
    provenance: PROVENANCE,
    duplicateBurdenContributions: 0,
    predictiveStatus: 'NOT_TESTED',
    displayStatus,
  };
}

/**
 * Deduplicate canonical contributors by playerEntityId (first wins).
 * Source count includes all source rows; unresolved = source − unique canonical.
 */
export function computeTeamGameAvailability(
  input: TeamInjuryBurdenInput,
  options?: { displayStatus?: 'RESEARCH' | 'DISPLAYABLE' }
): TeamGameAvailabilitySnapshot {
  const displayStatus = options?.displayStatus ?? 'RESEARCH';

  if (isSourceUnknownTeamState(input.teamState)) {
    return sourceUnknownSnapshot(input, displayStatus);
  }

  const sourceCount = input.healthOutContributors.length;

  // Dedup canonical entity ids
  const seen = new Set<string>();
  let duplicateBurdenContributions = 0;
  const uniqueCanonical: HealthOutContributor[] = [];
  let unresolved = 0;

  for (const c of input.healthOutContributors) {
    if (!c.canonical || !c.playerEntityId) {
      unresolved += 1;
      continue;
    }
    if (seen.has(c.playerEntityId)) {
      duplicateBurdenContributions += 1;
      continue;
    }
    seen.add(c.playerEntityId);
    uniqueCanonical.push(c);
  }

  const canonicalCount = uniqueCanonical.length;
  // source = unique canonical contributing source rows + unresolved (+ duplicates counted in source)
  // Invariant for non-duplicate inputs: sourceCount === canonicalCount + unresolved
  // With duplicates: sourceCount === canonicalCount + unresolved + duplicateBurdenContributions

  assertNonNegFinite('healthQuestionableCount', input.healthQuestionableCount);
  assertNonNegFinite('healthDoubtfulCount', input.healthDoubtfulCount);
  assertNonNegFinite('healthProbableCount', input.healthProbableCount);
  assertNonNegFinite('nonHealthOutCount', input.nonHealthOutCount);

  const availability: AvailabilityCounts = {
    healthOutSourceCount: sourceCount,
    healthOutCanonicalCount: canonicalCount,
    healthOutUnresolvedCount: unresolved + duplicateBurdenContributions > 0
      ? unresolved
      : unresolved,
    // Unresolved excludes duplicates (duplicates are canonical identity collisions).
    // Expose unresolved as non-canonical rows only:
    healthQuestionableCount: input.healthQuestionableCount,
    healthDoubtfulCount: input.healthDoubtfulCount,
    healthProbableCount: input.healthProbableCount,
    nonHealthOutCount: input.nonHealthOutCount,
    healthOutCount: canonicalCount,
  };
  // Fix unresolved to be exactly non-canonical source rows
  availability.healthOutUnresolvedCount = unresolved;

  const roleRequiredCount = canonicalCount;
  const estimates = uniqueCanonical
    .map((c) => c.roleEstimate)
    .filter((e): e is PlayerRoleEstimate => e != null);
  const roleEstimatedCount = estimates.length;

  let expectedMissingMinutes: number | null = null;
  let expectedMissingFga: number | null = null;
  let expectedMissingPoints: number | null = null;
  let missingRotationShare: number | null = null;
  let maxMissingPriorMpg: number | null = null;
  let rotationPlayersOutCount: number | null = null;

  let status: ContextCompleteness;

  if (canonicalCount === 0 && unresolved === 0) {
    // Known zero health-Out state
    expectedMissingMinutes = 0;
    expectedMissingFga = 0;
    expectedMissingPoints = 0;
    missingRotationShare = 0;
    maxMissingPriorMpg = null;
    rotationPlayersOutCount = 0;
    status = CONTEXT_COMPLETENESS.COMPLETE;
  } else if (roleEstimatedCount === 0) {
    // Source known, no usable role estimates
    expectedMissingMinutes = null;
    expectedMissingFga = null;
    expectedMissingPoints = null;
    missingRotationShare = null;
    maxMissingPriorMpg = null;
    rotationPlayersOutCount = null;
    status = CONTEXT_COMPLETENESS.SOURCE_ONLY;
  } else if (roleEstimatedCount < roleRequiredCount || unresolved > 0) {
    // Partial: some estimates available; at least one required input missing
    // (unresolved identity OR missing role among canonical)
    let sumMin = 0;
    let sumFga = 0;
    let sumPts = 0;
    let maxMpg = -Infinity;
    let rot = 0;
    for (const e of estimates) {
      assertNonNegFinite('expectedMinutes', e.expectedMinutes);
      assertNonNegFinite('expectedFga', e.expectedFga);
      assertNonNegFinite('expectedPoints', e.expectedPoints);
      sumMin += e.expectedMinutes;
      sumFga += e.expectedFga;
      sumPts += e.expectedPoints;
      if (e.expectedMinutes > maxMpg) maxMpg = e.expectedMinutes;
      if (isRotationPlayer(e.expectedMinutes)) rot += 1;
    }
    expectedMissingMinutes = sumMin;
    expectedMissingFga = sumFga;
    expectedMissingPoints = sumPts;
    missingRotationShare = sumMin / REGULATION_TEAM_MINUTES;
    maxMissingPriorMpg = maxMpg;
    rotationPlayersOutCount = rot;
    status = CONTEXT_COMPLETENESS.PARTIAL;
  } else {
    // COMPLETE: all canonical have estimates; no unresolved
    let sumMin = 0;
    let sumFga = 0;
    let sumPts = 0;
    let maxMpg = -Infinity;
    let rot = 0;
    for (const e of estimates) {
      assertNonNegFinite('expectedMinutes', e.expectedMinutes);
      assertNonNegFinite('expectedFga', e.expectedFga);
      assertNonNegFinite('expectedPoints', e.expectedPoints);
      sumMin += e.expectedMinutes;
      sumFga += e.expectedFga;
      sumPts += e.expectedPoints;
      if (e.expectedMinutes > maxMpg) maxMpg = e.expectedMinutes;
      if (isRotationPlayer(e.expectedMinutes)) rot += 1;
    }
    expectedMissingMinutes = sumMin;
    expectedMissingFga = sumFga;
    expectedMissingPoints = sumPts;
    missingRotationShare = sumMin / REGULATION_TEAM_MINUTES;
    maxMissingPriorMpg = maxMpg;
    rotationPlayersOutCount = rot;
    status = CONTEXT_COMPLETENESS.COMPLETE;
  }

  // Design COMPLETE: "all relevant health-Out source players resolved sufficiently"
  // If unresolved > 0 but all canonical have estimates → PARTIAL (already handled).
  // If unresolved > 0 and roleEstimatedCount === 0 and canonicalCount === 0 → SOURCE_ONLY
  //   (source rows exist but none canonical) — handled by roleEstimatedCount === 0 branch.

  const coverageRate =
    roleRequiredCount === 0 ? 1 : roleEstimatedCount / roleRequiredCount;

  return {
    grain: 'TEAM_GAME',
    gameId: input.gameId,
    teamId: input.teamId,
    season: input.season,
    gameStart: input.gameStart,
    asOf: input.asOf,
    injuryReportPublishedAt: input.injuryReportPublishedAt,
    teamState: input.teamState,
    contextVersion: TEAM_INJURY_CONTEXT_VERSION,
    availability,
    injuryBurden: {
      expectedMissingMinutes,
      expectedMissingFga,
      expectedMissingPoints,
      missingRotationShare,
      maxMissingPriorMpg,
      rotationPlayersOutCount,
    },
    completeness: {
      status,
      roleRequiredCount,
      roleEstimatedCount,
      coverageRate,
    },
    provenance: PROVENANCE,
    duplicateBurdenContributions,
    predictiveStatus: 'NOT_TESTED',
    displayStatus,
  };
}

export function assertCompletenessInvariants(snap: TeamGameAvailabilitySnapshot): void {
  const a = snap.availability;
  const c = snap.completeness;

  if (c.status === CONTEXT_COMPLETENESS.SOURCE_UNKNOWN) {
    if (snap.injuryBurden.expectedMissingMinutes != null) {
      throw new Error('SOURCE_UNKNOWN must not fabricate burden');
    }
    return;
  }

  if (a.healthOutSourceCount == null || a.healthOutCanonicalCount == null) {
    throw new Error('submitted team missing source counts');
  }

  if (c.roleEstimatedCount > a.healthOutCanonicalCount) {
    throw new Error('roleEstimatedCount > canonical');
  }
  if (a.healthOutCanonicalCount > a.healthOutSourceCount) {
    throw new Error('canonical > source');
  }

  // source = canonical + unresolved + duplicates (duplicates are extra source rows)
  const unresolved = a.healthOutUnresolvedCount ?? 0;
  const expectedSource =
    a.healthOutCanonicalCount + unresolved + snap.duplicateBurdenContributions;
  if (a.healthOutSourceCount !== expectedSource) {
    throw new Error(
      `source identity invariant: source=${a.healthOutSourceCount} != canonical(${a.healthOutCanonicalCount})+unresolved(${unresolved})+dupes(${snap.duplicateBurdenContributions})`
    );
  }

  if (c.status === CONTEXT_COMPLETENESS.COMPLETE) {
    if (c.roleRequiredCount > 0 && c.roleEstimatedCount !== c.roleRequiredCount) {
      throw new Error('COMPLETE requires all role estimates');
    }
    if (unresolved !== 0) {
      throw new Error('COMPLETE requires unresolved=0');
    }
  }
}

export { ROTATION_PLAYER_MIN_MPG, REGULATION_TEAM_MINUTES };
