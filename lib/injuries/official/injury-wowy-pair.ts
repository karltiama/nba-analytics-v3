/**
 * Injury-conditioned WOWY pair builder v1 (Phase 6B).
 *
 * Pure deterministic construction of P0 pair observations + cohort flags.
 * Does NOT calculate performance effects. Does NOT redefine pregame focal state
 * from realized participation.
 *
 * Contamination / cohort semantics match approved Phase 6A design audit:
 * - other_health_without = other teammates with status Out + HEALTH_RELATED
 * - other_health_with = other teammates with status Available + HEALTH_RELATED
 * - other_eligible_* = other WITH_CANDIDATE / WITHOUT_CANDIDATE (canonical)
 * - P1: other_health_without_count === 0
 * - P2: other_eligible_with_count === 0 && other_eligible_without_count === 0
 * - P3: other_health_without_count === 0 && other_non_health_out_count === 0
 */

import { createHash } from 'node:crypto';

export const INJURY_WOWY_PAIR_POLICY_VERSION = 'injury-wowy-pair-policy-v1' as const;

export type FocalState = 'PRE_GAME_AVAILABLE' | 'PRE_GAME_OUT';
export type FocalRealizedParticipation = 'PLAYED' | 'DNP_00' | 'NO_PGL_ROW';

export type TeamMateState = {
  player_entity_id: string | null;
  status_raw: string | null;
  health_relation: string | null;
  injury_wowy_eligibility: string | null;
  canonical_model_eligible?: boolean | null;
};

export type SubjectMetrics = {
  minutes: number | null;
  pts: number | null;
  reb: number | null;
  ast: number | null;
  tpm: number | null;
  fga: number | null;
  tpa: number | null;
  fta: number | null;
};

export type ContaminationCounters = {
  other_health_without_count: number;
  other_health_with_count: number;
  other_non_health_out_count: number;
  other_nonbinary_health_count: number;
  other_eligible_with_count: number;
  other_eligible_without_count: number;
};

export type CohortFlags = {
  cohort_p0: true;
  cohort_p1: boolean;
  cohort_p2: boolean;
  cohort_p3: boolean;
};

export type PairObservation = {
  pair_policy_version: typeof INJURY_WOWY_PAIR_POLICY_VERSION;
  observation_id: string;
  game_id: string;
  team_id: string;
  season: string;
  subject_player_entity_id: string;
  subject_serving_player_id: string;
  focal_player_entity_id: string;
  focal_serving_player_id: string | null;
  focal_state: FocalState;
  focal_eligibility: 'WITH_CANDIDATE' | 'WITHOUT_CANDIDATE';
  t60_report_published_at: string | null;
  other_health_without_count: number;
  other_health_with_count: number;
  other_non_health_out_count: number;
  other_nonbinary_health_count: number;
  other_eligible_with_count: number;
  other_eligible_without_count: number;
  cohort_p0: true;
  cohort_p1: boolean;
  cohort_p2: boolean;
  cohort_p3: boolean;
  focal_realized_participation: FocalRealizedParticipation;
  subject_metrics: SubjectMetrics;
  source_versions: {
    identity: 'official-injury-player-identity-v1';
    asof: 'official-injury-asof-t60-v1';
    reason: 'official-injury-reason-policy-v1';
    eligibility: 'injury-wowy-eligibility-v1';
  };
};

export function mapEligibilityToFocalState(
  eligibility: 'WITH_CANDIDATE' | 'WITHOUT_CANDIDATE'
): FocalState {
  return eligibility === 'WITH_CANDIDATE' ? 'PRE_GAME_AVAILABLE' : 'PRE_GAME_OUT';
}

export function makePairObservationId(
  gameId: string,
  teamId: string,
  subjectEntityId: string,
  focalEntityId: string,
  pairPolicyVersion: string = INJURY_WOWY_PAIR_POLICY_VERSION
): string {
  const raw = `${pairPolicyVersion}|${gameId}|${teamId}|${subjectEntityId}|${focalEntityId}`;
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

/**
 * Contamination counters relative to a focal entity on a team-game.
 * Phase 6A semantics (Out+HEALTH_RELATED etc.), focal excluded.
 */
export function computeContaminationCounters(
  teammates: TeamMateState[],
  focalPlayerEntityId: string
): ContaminationCounters {
  let other_health_without_count = 0;
  let other_health_with_count = 0;
  let other_non_health_out_count = 0;
  let other_nonbinary_health_count = 0;
  let other_eligible_with_count = 0;
  let other_eligible_without_count = 0;

  for (const p of teammates) {
    const eid = p.player_entity_id == null ? '' : String(p.player_entity_id);
    if (eid && eid === focalPlayerEntityId) continue;

    const status = p.status_raw;
    const health = p.health_relation;
    const elig = p.injury_wowy_eligibility;

    if (status === 'Out' && health === 'HEALTH_RELATED') other_health_without_count += 1;
    if (status === 'Available' && health === 'HEALTH_RELATED') other_health_with_count += 1;
    if (status === 'Out' && health === 'NON_HEALTH_RELATED') other_non_health_out_count += 1;
    if (
      (status === 'Questionable' || status === 'Doubtful' || status === 'Probable') &&
      health === 'HEALTH_RELATED'
    ) {
      other_nonbinary_health_count += 1;
    }
    if (elig === 'WITH_CANDIDATE' && p.canonical_model_eligible) other_eligible_with_count += 1;
    if (elig === 'WITHOUT_CANDIDATE' && p.canonical_model_eligible) {
      other_eligible_without_count += 1;
    }
  }

  return {
    other_health_without_count,
    other_health_with_count,
    other_non_health_out_count,
    other_nonbinary_health_count,
    other_eligible_with_count,
    other_eligible_without_count,
  };
}

export function deriveCohortFlags(counters: ContaminationCounters): CohortFlags {
  const cohort_p1 = counters.other_health_without_count === 0;
  const cohort_p2 =
    counters.other_eligible_with_count === 0 && counters.other_eligible_without_count === 0;
  const cohort_p3 =
    counters.other_health_without_count === 0 && counters.other_non_health_out_count === 0;
  return { cohort_p0: true, cohort_p1, cohort_p2, cohort_p3 };
}

export type BuildPairInput = {
  game_id: string;
  team_id: string;
  season: string;
  subject_player_entity_id: string | null | undefined;
  subject_serving_player_id: string;
  focal_player_entity_id: string;
  focal_serving_player_id?: string | null;
  focal_eligibility: 'WITH_CANDIDATE' | 'WITHOUT_CANDIDATE';
  t60_report_published_at?: string | null;
  teammates?: TeamMateState[];
  /** Precomputed counters (when teammates not supplied). */
  counters?: ContaminationCounters;
  focal_realized_participation: FocalRealizedParticipation;
  subject_metrics: SubjectMetrics;
};

export type BuildPairResult =
  | { emitted: true; observation: PairObservation }
  | { emitted: false; reason: 'SELF_PAIR_REMOVED' | 'SUBJECT_IDENTITY_UNRESOLVED' };

/**
 * Build one P0 pair observation (or exclude with reason).
 */
export function buildInjuryWowyPairObservation(input: BuildPairInput): BuildPairResult {
  const subjectEntity =
    input.subject_player_entity_id == null || String(input.subject_player_entity_id).trim() === ''
      ? null
      : String(input.subject_player_entity_id);
  if (!subjectEntity) {
    return { emitted: false, reason: 'SUBJECT_IDENTITY_UNRESOLVED' };
  }
  const focalEntity = String(input.focal_player_entity_id);
  if (subjectEntity === focalEntity) {
    return { emitted: false, reason: 'SELF_PAIR_REMOVED' };
  }

  const counters =
    input.counters ??
    computeContaminationCounters(input.teammates ?? [], focalEntity);
  const flags = deriveCohortFlags(counters);
  const focalState = mapEligibilityToFocalState(input.focal_eligibility);

  const observation: PairObservation = {
    pair_policy_version: INJURY_WOWY_PAIR_POLICY_VERSION,
    observation_id: makePairObservationId(
      String(input.game_id),
      String(input.team_id),
      subjectEntity,
      focalEntity
    ),
    game_id: String(input.game_id),
    team_id: String(input.team_id),
    season: String(input.season),
    subject_player_entity_id: subjectEntity,
    subject_serving_player_id: String(input.subject_serving_player_id),
    focal_player_entity_id: focalEntity,
    focal_serving_player_id:
      input.focal_serving_player_id == null || input.focal_serving_player_id === ''
        ? null
        : String(input.focal_serving_player_id),
    focal_state: focalState,
    focal_eligibility: input.focal_eligibility,
    t60_report_published_at: input.t60_report_published_at ?? null,
    ...counters,
    ...flags,
    focal_realized_participation: input.focal_realized_participation,
    subject_metrics: { ...input.subject_metrics },
    source_versions: {
      identity: 'official-injury-player-identity-v1',
      asof: 'official-injury-asof-t60-v1',
      reason: 'official-injury-reason-policy-v1',
      eligibility: 'injury-wowy-eligibility-v1',
    },
  };
  return { emitted: true, observation };
}

export type FocalCandidate = {
  game_id: string;
  team_id: string;
  player_entity_id: string;
  injury_wowy_eligibility: 'WITH_CANDIDATE' | 'WITHOUT_CANDIDATE';
};

/**
 * Detect conflicting WITH/WITHOUT for same game/team/focal.
 * Returns conflict keys; empty means OK.
 */
export function findFocalStateConflicts(focals: FocalCandidate[]): string[] {
  const map = new Map<string, Set<string>>();
  for (const f of focals) {
    const k = `${f.game_id}|${f.team_id}|${f.player_entity_id}`;
    if (!map.has(k)) map.set(k, new Set());
    map.get(k)!.add(f.injury_wowy_eligibility);
  }
  const conflicts: string[] = [];
  for (const [k, set] of map) {
    if (set.size > 1) conflicts.push(k);
  }
  return conflicts;
}

export function findDuplicateSubjectEntities(
  subjects: Array<{ game_id: string; team_id: string; player_entity_id: string }>
): string[] {
  const map = new Map<string, number>();
  for (const s of subjects) {
    const k = `${s.game_id}|${s.team_id}|${s.player_entity_id}`;
    map.set(k, (map.get(k) || 0) + 1);
  }
  return [...map.entries()].filter(([, n]) => n > 1).map(([k]) => k);
}
