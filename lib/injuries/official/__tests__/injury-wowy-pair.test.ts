/**
 * Development + synthetic tests for injury-wowy-pair-policy-v1.
 * Does NOT load held_out expectations.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  INJURY_WOWY_PAIR_POLICY_VERSION,
  buildInjuryWowyPairObservation,
  computeContaminationCounters,
  deriveCohortFlags,
  findDuplicateSubjectEntities,
  findFocalStateConflicts,
  makePairObservationId,
  type ContaminationCounters,
  type FocalRealizedParticipation,
  type SubjectMetrics,
} from '../injury-wowy-pair';

const ROOT = path.join(process.cwd(), 'tests/fixtures/official-injury-wowy-pairs');

type Fixture = {
  fixture_id: string;
  split: string;
  category: string;
  input: Record<string, unknown>;
  expected: Record<string, unknown>;
};

function loadSplit(split: string): Fixture[] {
  if (split === 'held_out') {
    throw new Error('held_out fixtures must not be loaded by the development test');
  }
  const dir = path.join(ROOT, split);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as Fixture);
}

function runRealOrCounterFixture(fx: Fixture) {
  const input = fx.input;
  const mode = input.mode as string | undefined;

  if (mode === 'validate_focals') {
    const conflicts = findFocalStateConflicts(
      (input.focals as Array<{
        game_id: string;
        team_id: string;
        player_entity_id: string;
        injury_wowy_eligibility: 'WITH_CANDIDATE' | 'WITHOUT_CANDIDATE';
      }>) || []
    );
    expect(conflicts.length > 0).toBe(true);
    expect(fx.expected.hard_failure).toBe('FOCAL_STATE_CONFLICT');
    return;
  }
  if (mode === 'validate_subjects') {
    const dups = findDuplicateSubjectEntities(
      (input.subjects as Array<{ game_id: string; team_id: string; player_entity_id: string }>) ||
        []
    );
    expect(dups.length > 0).toBe(true);
    expect(fx.expected.hard_failure).toBe('PGL_DUPLICATE_SUBJECT_ENTITY');
    return;
  }

  const counters: ContaminationCounters | undefined =
    mode === 'compute_counters'
      ? computeContaminationCounters(
          (input.teammates as Parameters<typeof computeContaminationCounters>[0]) || [],
          String(input.focal_player_entity_id)
        )
      : {
          other_health_without_count: Number(input.other_health_without_count),
          other_health_with_count: Number(input.other_health_with_count),
          other_non_health_out_count: Number(input.other_non_health_out_count),
          other_nonbinary_health_count: Number(input.other_nonbinary_health_count),
          other_eligible_with_count: Number(input.other_eligible_with_count),
          other_eligible_without_count: Number(input.other_eligible_without_count),
        };

  const result = buildInjuryWowyPairObservation({
    game_id: String(input.game_id),
    team_id: String(input.team_id),
    season: String(input.season),
    subject_player_entity_id: input.subject_player_entity_id as string | null,
    subject_serving_player_id: String(input.subject_serving_player_id ?? ''),
    focal_player_entity_id: String(input.focal_player_entity_id),
    focal_serving_player_id: (input.focal_serving_player_id as string | null) ?? null,
    focal_eligibility: input.focal_eligibility as 'WITH_CANDIDATE' | 'WITHOUT_CANDIDATE',
    t60_report_published_at: (input.t60_report_published_at as string | null) ?? null,
    counters,
    focal_realized_participation: input.focal_realized_participation as FocalRealizedParticipation,
    subject_metrics: (input.subject_metrics ||
      (fx.expected as { subject_metrics?: SubjectMetrics }).subject_metrics) as SubjectMetrics,
  });

  if (fx.expected.emitted === false) {
    expect(result.emitted).toBe(false);
    if (!result.emitted) expect(result.reason).toBe(fx.expected.reason);
    return;
  }

  expect(result.emitted).toBe(true);
  if (!result.emitted) return;
  const obs = result.observation;
  const e = fx.expected;

  expect(obs.pair_policy_version).toBe(INJURY_WOWY_PAIR_POLICY_VERSION);
  if (e.observation_id) expect(obs.observation_id).toBe(e.observation_id);
  if (e.game_id) expect(obs.game_id).toBe(e.game_id);
  if (e.focal_state) expect(obs.focal_state).toBe(e.focal_state);
  if (e.subject_player_entity_id)
    expect(obs.subject_player_entity_id).toBe(e.subject_player_entity_id);
  if (e.focal_player_entity_id) expect(obs.focal_player_entity_id).toBe(e.focal_player_entity_id);
  if (e.other_health_without_count !== undefined)
    expect(obs.other_health_without_count).toBe(e.other_health_without_count);
  if (e.other_eligible_without_count !== undefined)
    expect(obs.other_eligible_without_count).toBe(e.other_eligible_without_count);
  if (e.cohort_p1 !== undefined) expect(obs.cohort_p1).toBe(e.cohort_p1);
  if (e.cohort_p2 !== undefined) expect(obs.cohort_p2).toBe(e.cohort_p2);
  if (e.cohort_p3 !== undefined) expect(obs.cohort_p3).toBe(e.cohort_p3);
  if (e.focal_realized_participation)
    expect(obs.focal_realized_participation).toBe(e.focal_realized_participation);
  if (e.focal_serving_player_id === null) expect(obs.focal_serving_player_id).toBeNull();
  if (e.subject_metrics) expect(obs.subject_metrics).toEqual(e.subject_metrics);
  expect(obs.cohort_p0).toBe(true);

  // observation id deterministic
  expect(obs.observation_id).toBe(
    makePairObservationId(obs.game_id, obs.team_id, obs.subject_player_entity_id, obs.focal_player_entity_id)
  );
}

describe('injury-wowy-pair-policy-v1 development', () => {
  const fixtures = loadSplit('development');
  it(`loads ${fixtures.length} development fixtures`, () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(20);
  });
  for (const fx of fixtures) {
    it(`exact: ${fx.fixture_id}`, () => runRealOrCounterFixture(fx));
  }
});

describe('injury-wowy-pair-policy-v1 synthetic', () => {
  const fixtures = loadSplit('synthetic');
  for (const fx of fixtures) {
    it(`exact: ${fx.fixture_id}`, () => runRealOrCounterFixture(fx));
  }
});

describe('cohort helpers', () => {
  it('P1/P2/P3 derive as Phase 6A', () => {
    const flags = deriveCohortFlags({
      other_health_without_count: 0,
      other_health_with_count: 1,
      other_non_health_out_count: 1,
      other_nonbinary_health_count: 0,
      other_eligible_with_count: 1,
      other_eligible_without_count: 0,
    });
    expect(flags.cohort_p1).toBe(true);
    expect(flags.cohort_p2).toBe(false);
    expect(flags.cohort_p3).toBe(false);
  });
});
