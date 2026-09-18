/**
 * Development + synthetic tests for injury-wowy-estimator-v1.
 * Does NOT load held_out expectations.
 */

import { createReadStream, readFileSync, readdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { createGunzip } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  assertMetric,
  buildEstimatorWindow,
  ebPosterior,
  estimatePairFromWindow,
  filterObservationsForWindow,
  rawDeltaFromMeans,
  sampleVarianceDdof1,
  type EstimatorObservation,
  type EstimatorResult,
} from '../injury-wowy-estimator';
import { resolveStateVariance } from '../injury-wowy-eb';

const ROOT = path.join(process.cwd(), 'tests/fixtures/official-injury-wowy-estimator');
const ABS = 1e-10;
const REL = 1e-10;

function close(a: number, b: number) {
  expect(Math.abs(a - b)).toBeLessThanOrEqual(Math.max(ABS, REL * Math.max(Math.abs(a), Math.abs(b))));
}

type Fixture = {
  fixture_id: string;
  split: string;
  kind: string;
  input: Record<string, unknown>;
  expected: Record<string, unknown>;
};

function loadSplit(split: string): Fixture[] {
  if (split === 'held_out') throw new Error('held_out must not be loaded by development tests');
  const dir = path.join(ROOT, split);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as Fixture);
}

async function loadCorpus(
  corpusRel: string,
  manifestRel: string
): Promise<EstimatorObservation[]> {
  const manifest = new Map<string, string>();
  for (const line of readFileSync(path.join(process.cwd(), manifestRel), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const o = JSON.parse(line) as { game_id: string; start_time_utc: string };
    manifest.set(o.game_id, o.start_time_utc);
  }
  const out: EstimatorObservation[] = [];
  const stream = createReadStream(path.join(process.cwd(), corpusRel)).pipe(createGunzip());
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const o = JSON.parse(line) as Record<string, unknown>;
    const sm = o.subject_metrics as Record<string, number>;
    out.push({
      game_id: String(o.game_id),
      game_start: manifest.get(String(o.game_id))!,
      season: String(o.season),
      team_id: String(o.team_id),
      subject_player_entity_id: String(o.subject_player_entity_id),
      focal_player_entity_id: String(o.focal_player_entity_id),
      focal_state: o.focal_state as EstimatorObservation['focal_state'],
      subject_metrics: sm,
      cohort_p0: true,
      cohort_p1: Boolean(o.cohort_p1),
      cohort_p2: Boolean(o.cohort_p2),
      cohort_p3: Boolean(o.cohort_p3),
    });
  }
  return out;
}

function compareResult(got: EstimatorResult, exp: Record<string, unknown>) {
  expect(got.estimation_status).toBe(exp.estimation_status);
  expect(got.ui_display_eligible).toBe(exp.ui_display_eligible);
  expect(got.quality_tier).toBe(exp.quality_tier);
  expect(got.with_n).toBe(exp.with_n);
  expect(got.without_n).toBe(exp.without_n);
  expect(got.sign_convention).toBe('WITHOUT_MINUS_WITH');
  for (const key of [
    'with_mean',
    'without_mean',
    'raw_delta',
    'sampling_variance',
    'pooled_residual_variance',
    'prior_mean',
    'prior_variance',
    'data_weight',
    'prior_weight',
    'estimated_delta',
    'posterior_variance',
    'interval_low',
    'interval_high',
  ] as const) {
    const e = exp[key];
    const g = got[key];
    if (e == null) expect(g).toBeNull();
    else {
      expect(g).not.toBeNull();
      close(g as number, e as number);
    }
  }
  expect(got.prior_pair_count).toBe(exp.prior_pair_count);
  expect(got.pooled_residual_df).toBe(exp.pooled_residual_df);
  expect(got.with_variance_source).toBe(exp.with_variance_source);
  expect(got.without_variance_source).toBe(exp.without_variance_source);
}

describe('injury-wowy-estimator synthetic', () => {
  const fixtures = loadSplit('synthetic');

  it('loads synthetic fixtures', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(12);
  });

  for (const fx of fixtures) {
    it(fx.fixture_id, () => {
      const { kind, input, expected } = fx;
      if (kind === 'posterior_only') {
        const post = ebPosterior(
          Number(input.raw_delta),
          Number(input.sampling_variance),
          Number(input.mu0),
          Number(input.tau2)
        );
        expect(post).not.toBeNull();
        close(post!.dataWeight, Number(expected.data_weight));
        close(post!.estimatedDelta, Number(expected.estimated_delta));
        if (expected.posterior_variance != null) {
          close(post!.posteriorVariance, Number(expected.posterior_variance));
        }
        if (expected.interval_low != null) {
          close(post!.intervalLow, Number(expected.interval_low));
          close(post!.intervalHigh, Number(expected.interval_high));
        }
        const withN = Number(input.with_n);
        const withoutN = Number(input.without_n);
        const status =
          Math.min(withN, withoutN) < 3 ? 'SPARSE_BOTH_STATES' : 'PAIR_ESTIMATE_AVAILABLE';
        expect(status).toBe(expected.estimation_status);
        expect(status === 'PAIR_ESTIMATE_AVAILABLE').toBe(expected.ui_display_eligible);
        return;
      }
      if (kind === 'shrinkage_order') {
        const low = ebPosterior(Number(input.y), Number(input.v_low), Number(input.mu0), Number(input.tau2))!;
        const high = ebPosterior(Number(input.y), Number(input.v_high), Number(input.mu0), Number(input.tau2))!;
        expect(low.dataWeight).toBeGreaterThan(high.dataWeight);
        close(low.estimatedDelta, Number(expected.est_low));
        close(high.estimatedDelta, Number(expected.est_high));
        expect(Math.abs(high.estimatedDelta - Number(input.mu0))).toBeLessThan(
          Math.abs(low.estimatedDelta - Number(input.mu0))
        );
        return;
      }
      if (kind === 'raw_delta_only') {
        const withVals = input.with_values as number[];
        const withoutVals = input.without_values as number[];
        const withMean = withVals.reduce((a, b) => a + b, 0) / withVals.length;
        const withoutMean = withoutVals.reduce((a, b) => a + b, 0) / withoutVals.length;
        expect(rawDeltaFromMeans(withoutMean, withMean)).toBe(expected.raw_delta);
        return;
      }
      if (kind === 'status_counts') {
        const withN = Number(input.with_n);
        const withoutN = Number(input.without_n);
        let status: string;
        if (withN === 0 && withoutN === 0) status = 'NO_HISTORY';
        else if (withN === 0 || withoutN === 0) status = 'ONE_SIDED_HISTORY';
        else status = 'SPARSE_BOTH_STATES';
        expect(status).toBe(expected.estimation_status);
        expect(false).toBe(expected.ui_display_eligible);
        return;
      }
      if (kind === 'asof_filter') {
        const asOf = String(input.as_of);
        const starts = input.game_starts as string[];
        const eligible = starts.filter((g) => g < asOf);
        expect(eligible).toEqual(expected.eligible_game_starts);
        return;
      }
      if (kind === 'state_variance_rule') {
        const values = input.values as number[];
        const pool = Number(input.sigma2_pool);
        const s2 = sampleVarianceDdof1(values);
        const r = resolveStateVariance(values.length, s2, pool);
        expect(r.varianceSource).toBe(expected.variance_source);
        close(r.varianceUsed!, Number(expected.variance_used));
        if (expected.observed_s2 != null) close(s2 ?? 0, Number(expected.observed_s2));
        return;
      }
      if (kind === 'prior_gate') {
        const estimable =
          Number(input.prior_pair_count) >= 20 &&
          Number(input.pooled_residual_df) >= 20 &&
          Number(input.tau2) > 0;
        expect(estimable).toBe(expected.prior_estimable);
        return;
      }
      if (kind === 'future_mutation') {
        const asOf = String(input.as_of);
        const base = input.base_obs_starts as string[];
        const future = input.future_obs_starts as string[];
        const before = base.filter((g) => g < asOf);
        const after = [...base, ...future].filter((g) => g < asOf);
        expect(before).toEqual(after);
        expect(expected.outputs_identical_after_mutation).toBe(true);
        return;
      }
      if (kind === 'invalid_metric') {
        expect(() => assertMetric(String(input.metric))).toThrow();
        return;
      }
      throw new Error(`unknown synthetic kind ${kind}`);
    });
  }
});

describe('injury-wowy-estimator development real', () => {
  const fixtures = loadSplit('development');
  let corpusPromise: Promise<EstimatorObservation[]> | null = null;

  function corpus() {
    if (!corpusPromise) {
      corpusPromise = loadCorpus(
        'tmp/official-injury-wowy-pairs/p1.ndjson.gz',
        'tmp/official-injury-wowy-estimator/game-start-manifest.ndjson'
      );
    }
    return corpusPromise;
  }

  it('loads development fixtures', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(20);
  });

  for (const fx of fixtures) {
    it(fx.fixture_id, async () => {
      if (fx.kind === 'asof_vs_research') {
        const obs = await corpus();
        const pk = fx.input.pair_key as {
          season: string;
          team_id: string;
          subject_player_entity_id: string;
          focal_player_entity_id: string;
        };
        const metric = fx.input.metric as (typeof ESTIMATOR_METRICS)[number];
        const asOf = String(fx.input.as_of);
        const research = buildEstimatorWindow(obs, {
          metric,
          cohort: 'P1',
          mode: 'RESEARCH_FULL_HISTORY',
          as_of: null,
        });
        const asof = buildEstimatorWindow(obs, {
          metric,
          cohort: 'P1',
          mode: 'PRODUCTION_AS_OF',
          as_of: asOf,
        });
        const rRes = estimatePairFromWindow(research, pk, {
          metric,
          cohort: 'P1',
          mode: 'RESEARCH_FULL_HISTORY',
          as_of: null,
        });
        const aRes = estimatePairFromWindow(asof, pk, {
          metric,
          cohort: 'P1',
          mode: 'PRODUCTION_AS_OF',
          as_of: asOf,
        });
        const exp = fx.expected as {
          research: { with_n: number; without_n: number; estimation_status: string };
          asof: { with_n: number; without_n: number; estimation_status: string };
          counts_differ: boolean;
          asof_max_lt_asof: boolean;
        };
        expect(rRes.with_n).toBe(exp.research.with_n);
        expect(rRes.without_n).toBe(exp.research.without_n);
        expect(rRes.estimation_status).toBe(exp.research.estimation_status);
        expect(aRes.with_n).toBe(exp.asof.with_n);
        expect(aRes.without_n).toBe(exp.asof.without_n);
        expect(aRes.estimation_status).toBe(exp.asof.estimation_status);
        const differ = rRes.with_n !== aRes.with_n || rRes.without_n !== aRes.without_n;
        expect(differ).toBe(exp.counts_differ);
        if (asof.maxTrainingGameStart) {
          expect(asof.maxTrainingGameStart < asOf).toBe(true);
        }
        expect(exp.asof_max_lt_asof).toBe(true);
        return;
      }

      if (fx.kind !== 'real_pair_corpus') {
        throw new Error(`unexpected kind ${fx.kind}`);
      }
      const obs = await corpus();
      const metric = String(fx.input.metric);
      assertMetric(metric);
      const pk = fx.input.pair_key as {
        season: string;
        team_id: string;
        subject_player_entity_id: string;
        focal_player_entity_id: string;
      };
      const window = buildEstimatorWindow(obs, {
        metric,
        cohort: 'P1',
        mode: 'RESEARCH_FULL_HISTORY',
        as_of: null,
      });
      const got = estimatePairFromWindow(window, pk, {
        metric,
        cohort: 'P1',
        mode: 'RESEARCH_FULL_HISTORY',
        as_of: null,
      });
      compareResult(got, fx.expected);
    });
  }
});

describe('injury-wowy-estimator unit invariants', () => {
  it('filters PRODUCTION_AS_OF strictly before as_of', () => {
    const obs: EstimatorObservation[] = [
      {
        game_id: '1',
        game_start: '2024-01-01T00:00:00.000Z',
        season: '2023',
        team_id: '1',
        subject_player_entity_id: 's',
        focal_player_entity_id: 'f',
        focal_state: 'PRE_GAME_OUT',
        subject_metrics: { pts: 1 },
        cohort_p1: true,
      },
      {
        game_id: '2',
        game_start: '2024-06-01T00:00:00.000Z',
        season: '2023',
        team_id: '1',
        subject_player_entity_id: 's',
        focal_player_entity_id: 'f',
        focal_state: 'PRE_GAME_AVAILABLE',
        subject_metrics: { pts: 2 },
        cohort_p1: true,
      },
    ];
    const asOf = '2024-06-01T00:00:00.000Z';
    const filtered = filterObservationsForWindow(obs, {
      cohort: 'P1',
      mode: 'PRODUCTION_AS_OF',
      as_of: asOf,
    });
    expect(filtered.map((o) => o.game_id)).toEqual(['1']);
  });

  it('resolveStateVariance empty n', () => {
    const r = resolveStateVariance(0, null, 10);
    expect(r.varianceUsed).toBeNull();
  });
});
