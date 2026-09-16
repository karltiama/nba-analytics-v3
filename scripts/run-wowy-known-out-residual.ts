/**
 * Fit/evaluate the declared known-Out ridge residual experiment once.
 * Reads the frozen cohort. Does not retune eligibility or features after eval.
 *
 *   npx tsx scripts/run-wowy-known-out-residual.ts
 */
import 'dotenv/config';

import { createReadStream, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { createInterface } from 'readline';
import { createHash } from 'crypto';
import { join } from 'path';
import {
  LEARNED_BOOTSTRAP_ITERS,
  LEARNED_BOOTSTRAP_SEED,
  bootstrapMaeDifferenceGrouped,
} from '../lib/betting/player-projection-learned-features';
import { fitRidge, mae, predictRidge, type RidgeModel } from '../lib/wowy/ridge';
import {
  KNOWN_OUT_EXPERIMENT_VERSION,
  KNOWN_OUT_FEATURE_SPEC_VERSION,
  KNOWN_OUT_FIXED_LAMBDA,
  KNOWN_OUT_INNER_VAL_DATE_FRACTION,
  KNOWN_OUT_MIN_INNER_VAL_N,
  KNOWN_OUT_RIDGE_LAMBDAS,
  allFeatures,
  roleFeatures,
  wowyFeatures,
  type KnownOutTarget,
} from '../lib/wowy/known-out-residual-spec';

const DIR = 'reports/modeling/wowy-known-out-r1';
const LEARNED = 'reports/modeling/learned-r1';

type CohortRow = Record<string, unknown> & {
  player_id: string;
  game_id: string;
  split: 'train' | 'eval';
  basketball_date_et: string;
  support_tier: string;
  teammate_ultimately_played: boolean;
  actual_pts: number | null;
  actual_reb: number | null;
};

async function readJsonl(path: string): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.trim()) rows.push(JSON.parse(line) as Record<string, unknown>);
  }
  return rows;
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function metrics(actual: number[], pred: number[]) {
  const n = actual.length;
  let ae = 0;
  let se = 0;
  let bias = 0;
  for (let i = 0; i < n; i += 1) {
    const e = pred[i] - actual[i];
    ae += Math.abs(e);
    se += e * e;
    bias += e;
  }
  return {
    mae: n ? ae / n : null,
    rmse: n ? Math.sqrt(se / n) : null,
    bias: n ? bias / n : null,
    coverage: 1,
    n,
    nFinite: n,
  };
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function imputeMatrix(rows: Array<Record<string, unknown>>, names: readonly string[], medians: number[]): number[][] {
  return rows.map((row) => names.map((name, j) => num(row[name]) ?? medians[j] ?? 0));
}

function trainMedians(rows: Array<Record<string, unknown>>, names: readonly string[]): number[] {
  return names.map((name) => {
    const vals = rows.map((r) => num(r[name])).filter((v): v is number => v != null);
    return median(vals);
  });
}

function selectLambda(args: {
  train: CohortRow[];
  names: readonly string[];
  residual: number[];
  dates: string[];
}): { lambda: number; innerN: number; selected: boolean; innerMaeByLambda: Record<string, number> } {
  const sortedDates = [...args.dates].sort();
  const cut = Math.max(1, Math.floor(sortedDates.length * (1 - KNOWN_OUT_INNER_VAL_DATE_FRACTION)));
  const innerTrainDates = new Set(sortedDates.slice(0, cut));
  const innerTrainIdx: number[] = [];
  const innerValIdx: number[] = [];
  args.train.forEach((row, i) => {
    if (innerTrainDates.has(row.basketball_date_et)) innerTrainIdx.push(i);
    else innerValIdx.push(i);
  });
  const innerMaeByLambda: Record<string, number> = {};
  if (innerValIdx.length < KNOWN_OUT_MIN_INNER_VAL_N || innerTrainIdx.length < 10) {
    return { lambda: KNOWN_OUT_FIXED_LAMBDA, innerN: innerValIdx.length, selected: false, innerMaeByLambda };
  }
  const innerTrainRows = innerTrainIdx.map((i) => args.train[i]);
  const innerValRows = innerValIdx.map((i) => args.train[i]);
  const med = trainMedians(innerTrainRows, args.names);
  const Xtr = imputeMatrix(innerTrainRows, args.names, med);
  const ytr = innerTrainIdx.map((i) => args.residual[i]);
  const Xva = imputeMatrix(innerValRows, args.names, med);
  const yva = innerValIdx.map((i) => args.residual[i]);
  let best = KNOWN_OUT_FIXED_LAMBDA;
  let bestMae = Infinity;
  for (const lam of KNOWN_OUT_RIDGE_LAMBDAS) {
    const model = fitRidge({ X: Xtr, y: ytr, lambda: lam, featureNames: [...args.names] });
    const pred = predictRidge(model, Xva);
    const m = mae(yva, pred);
    innerMaeByLambda[String(lam)] = m;
    if (m < bestMae) {
      bestMae = m;
      best = lam;
    }
  }
  return { lambda: best, innerN: innerValIdx.length, selected: true, innerMaeByLambda };
}

function fitAndApply(
  train: CohortRow[],
  evalRows: CohortRow[],
  names: readonly string[],
  yTrainResidual: number[],
  lambda: number
): { model: RidgeModel; trainAdj: number[]; evalAdj: number[]; medians: number[] } {
  const medians = trainMedians(train, names);
  const Xtr = imputeMatrix(train, names, medians);
  const model = fitRidge({ X: Xtr, y: yTrainResidual, lambda, featureNames: [...names] });
  const trainAdj = predictRidge(model, Xtr);
  const evalAdj = predictRidge(model, imputeMatrix(evalRows, names, medians));
  return { model, trainAdj, evalAdj, medians };
}

function conclusion(ptsCb: { delta: number | null; ciLow: number | null; ciHigh: number | null }, rebCb: { delta: number | null; ciLow: number | null; ciHigh: number | null }): {
  label: 'promising for prospective testing' | 'inconclusive' | 'no demonstrated incremental benefit';
  note: string;
} {
  const clears = (d: { delta: number | null; ciLow: number | null; ciHigh: number | null }) =>
    d.delta != null && d.ciHigh != null && d.delta <= -0.01 && d.ciHigh < 0;
  const worse = (d: { delta: number | null; ciLow: number | null; ciHigh: number | null }) =>
    d.delta != null && d.ciLow != null && d.delta >= 0.01 && d.ciLow > 0;
  const ptsGood = clears(ptsCb);
  const rebGood = clears(rebCb);
  const ptsBad = worse(ptsCb);
  const rebBad = worse(rebCb);
  if ((ptsGood || rebGood) && !ptsBad && !rebBad) {
    return {
      label: 'promising for prospective testing',
      note: 'C vs B paired ΔMAE cleared the predeclared bar on at least one target without the other getting worse. Development evidence only; ~12 eval dates.',
    };
  }
  if (ptsBad && rebBad) {
    return {
      label: 'no demonstrated incremental benefit',
      note: 'C vs B MAE increased on both targets with intervals excluding zero.',
    };
  }
  return {
    label: 'inconclusive',
    note: 'C vs B did not clear the predeclared paired bar on this small, previously inspected known-Out window. ~12 evaluation dates provide limited uncertainty evidence.',
  };
}

async function main() {
  const freeze = JSON.parse(readFileSync(join(DIR, 'freeze.json'), 'utf8')) as {
    cohort_sha256: string;
    eligible: { eval_et_dates: string[]; train_et_dates: string[] };
  };
  const cohort = (await readJsonl(join(DIR, 'cohort.jsonl'))) as CohortRow[];
  const wanted = new Set(cohort.map((r) => `${r.player_id}|${r.game_id}`));

  const preds = new Map<string, { pts: number | null; reb: number | null }>();
  const feats = new Map<string, Record<string, number | null>>();

  const predRl = createInterface({
    input: createReadStream(join(LEARNED, 'predictions.jsonl'), { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of predRl) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as Record<string, unknown>;
    const key = `${row.player_id}|${row.game_id}`;
    if (!wanted.has(key)) continue;
    preds.set(key, { pts: num(row.yhat_c_points), reb: num(row.yhat_c_rebounds) });
  }

  const featRl = createInterface({
    input: createReadStream(join(LEARNED, 'rows.jsonl'), { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of featRl) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as Record<string, unknown>;
    const key = `${row.player_id}|${row.game_id}`;
    if (!wanted.has(key)) continue;
    const fc = (row.features_c ?? {}) as Record<string, unknown>;
    const out: Record<string, number | null> = {};
    for (const name of [
      ...ROLE_FEATURES_NEED,
    ]) {
      out[name] = num(fc[name]);
    }
    feats.set(key, out);
  }

  const joined: CohortRow[] = [];
  let droppedNoC = 0;
  for (const row of cohort) {
    const key = `${row.player_id}|${row.game_id}`;
    const p = preds.get(key);
    const f = feats.get(key);
    if (!p || p.pts == null || p.reb == null || !f) {
      droppedNoC += 1;
      continue;
    }
    joined.push({
      ...row,
      ...f,
      yhat_c_points: p.pts,
      yhat_c_rebounds: p.reb,
    });
  }

  const train = joined.filter((r) => r.split === 'train');
  const evalRows = joined.filter((r) => r.split === 'eval');
  const trainDates = freeze.eligible.train_et_dates;

  const targets: KnownOutTarget[] = ['points', 'rebounds'];
  const perTarget: Record<string, unknown> = {};
  const predOut: Array<Record<string, unknown>> = [];

  for (const target of targets) {
    const actualKey = target === 'points' ? 'actual_pts' : 'actual_reb';
    const cKey = target === 'points' ? 'yhat_c_points' : 'yhat_c_rebounds';
    const usableTrain = train.filter((r) => num(r[actualKey]) != null);
    const usableEval = evalRows.filter((r) => num(r[actualKey]) != null);
    const yTrain = usableTrain.map((r) => num(r[actualKey]) as number);
    const cTrain = usableTrain.map((r) => num(r[cKey]) as number);
    const residTrain = yTrain.map((y, i) => y - cTrain[i]);
    const yEval = usableEval.map((r) => num(r[actualKey]) as number);
    const cEval = usableEval.map((r) => num(r[cKey]) as number);

    const namesB = roleFeatures(target);
    const namesC = allFeatures(target);
    const selB = selectLambda({ train: usableTrain, names: namesB, residual: residTrain, dates: trainDates });
    const selC = selectLambda({ train: usableTrain, names: namesC, residual: residTrain, dates: trainDates });
    const fitB = fitAndApply(usableTrain, usableEval, namesB, residTrain, selB.lambda);
    const fitC = fitAndApply(usableTrain, usableEval, namesC, residTrain, selC.lambda);
    const predB = cEval.map((c, i) => c + fitB.evalAdj[i]);
    const predC = cEval.map((c, i) => c + fitC.evalAdj[i]);
    const errA = yEval.map((y, i) => cEval[i] - y);
    const errB = yEval.map((y, i) => predB[i] - y);
    const errC = yEval.map((y, i) => predC[i] - y);
    const groups = usableEval.map((r) => r.basketball_date_et);
    const pairedBA = bootstrapMaeDifferenceGrouped(errA, errB, groups);
    const pairedCA = bootstrapMaeDifferenceGrouped(errA, errC, groups);
    const pairedCB = bootstrapMaeDifferenceGrouped(errB, errC, groups);

    const byDate: Array<Record<string, unknown>> = [];
    const dates = [...new Set(groups)].sort();
    for (const d of dates) {
      const idx = usableEval.map((r, i) => (r.basketball_date_et === d ? i : -1)).filter((i) => i >= 0);
      const ya = idx.map((i) => yEval[i]);
      byDate.push({
        date: d,
        n: idx.length,
        mae_a: mae(ya, idx.map((i) => cEval[i])),
        mae_b: mae(ya, idx.map((i) => predB[i])),
        mae_c: mae(ya, idx.map((i) => predC[i])),
      });
    }

    const sliceSupport = ['low_support', 'adequate'].flatMap((tier) => {
      const idx = usableEval.map((r, i) => (r.support_tier === tier ? i : -1)).filter((i) => i >= 0);
      if (idx.length < 20) return [];
      const ya = idx.map((i) => yEval[i]);
      const g = idx.map((i) => groups[i]);
      return [
        {
          id: `${target}_${tier}`,
          family: 'wowy_support',
          label: `${target} · ${tier}`,
          splitId: 'historical_confirmation',
          targetId: target,
          n: idx.length,
          metricsByModel: {
            frozen_c: { mae: mae(ya, idx.map((i) => cEval[i])), n: idx.length },
            residual_role: { mae: mae(ya, idx.map((i) => predB[i])), n: idx.length },
            residual_wowy: { mae: mae(ya, idx.map((i) => predC[i])), n: idx.length },
          },
          pairedDelta: {
            leftModelId: 'residual_role',
            rightModelId: 'residual_wowy',
            ...bootstrapMaeDifferenceGrouped(
              idx.map((i) => errB[i]),
              idx.map((i) => errC[i]),
              g
            ),
            source: 'paired_observations',
          },
        },
      ];
    });

    perTarget[target] = {
      lambda_b: selB,
      lambda_c: selC,
      metrics: {
        frozen_c: metrics(yEval, cEval),
        residual_role: metrics(yEval, predB),
        residual_wowy: metrics(yEval, predC),
      },
      paired: {
        b_minus_a: pairedBA,
        c_minus_a: pairedCA,
        c_minus_b: pairedCB,
      },
      by_date: byDate,
      slices: sliceSupport,
    };

    usableEval.forEach((row, i) => {
      predOut.push({
        player_id: row.player_id,
        game_id: row.game_id,
        target,
        split: 'eval',
        basketball_date_et: row.basketball_date_et,
        actual: yEval[i],
        pred_frozen_c: cEval[i],
        pred_residual_role: predB[i],
        pred_residual_wowy: predC[i],
        support_tier: row.support_tier,
        teammate_ultimately_played: row.teammate_ultimately_played,
      });
    });
  }

  const ptsCb = (perTarget.points as { paired: { c_minus_b: { delta: number | null; ciLow: number | null; ciHigh: number | null } } })
    .paired.c_minus_b;
  const rebCb = (perTarget.rebounds as { paired: { c_minus_b: { delta: number | null; ciLow: number | null; ciHigh: number | null } } })
    .paired.c_minus_b;
  const decision = conclusion(ptsCb, rebCb);

  mkdirSync(DIR, { recursive: true });
  writeFileSync(join(DIR, 'predictions.jsonl'), `${predOut.map((r) => JSON.stringify(r)).join('\n')}\n`);

  const results = {
    version: KNOWN_OUT_EXPERIMENT_VERSION,
    feature_spec_version: KNOWN_OUT_FEATURE_SPEC_VERSION,
    dataset_sha256: freeze.cohort_sha256,
    historical_validity_class: 'reconstructed_historical',
    predictive_evaluation: 'complete',
    eligibility:
      'Frozen known-Out subset: primary teammate last-observed Out/Out For Season before T−60 on a unique team-night, subject played, WOWY support not insufficient. Previously inspected 2025 window.',
    periods: {
      train: '2026-03-10 to 2026-04-06 ET (frozen)',
      validation: null,
      test: '2026-04-07 to 2026-05-05 ET (frozen eval, once)',
      prospective: null,
    },
    n: { train: train.length, validation: 0, test: evalRows.length },
    n_dropped_missing_frozen_c: droppedNoC,
    targets: [
      { id: 'points', label: 'Points', units: 'points', derived: false },
      { id: 'rebounds', label: 'Rebounds', units: 'rebounds', derived: false },
    ],
    feature_groups: [
      { id: 'frozen_c', label: 'Frozen C', description: 'Unchanged learned-r1 C prediction.' },
      { id: 'residual_role', label: 'Ridge residual on role/history', description: 'A plus ridge(actual−A) on declared role features.' },
      { id: 'residual_wowy', label: 'Ridge residual + WOWY', description: 'Same procedure plus declared primary-teammate WOWY features.' },
    ],
    models: [
      { id: 'frozen_c', label: 'Frozen C', feature_group_id: 'frozen_c', role: 'frozen_shadow' },
      { id: 'residual_role', label: 'Residual role', feature_group_id: 'residual_role', role: 'baseline' },
      { id: 'residual_wowy', label: 'Residual + WOWY', feature_group_id: 'residual_wowy', role: 'candidate' },
    ],
    note: {
      validation: 'Lambda selected on chronological inner holdout of training ET dates only.',
      test: 'Frozen evaluation dates used once. Previously inspected development period. About 12 eval dates: limited uncertainty evidence.',
      ui_verification: 'Model Lab adapter tests can load this artifact. Browser verification of /admin/model-lab is separate and was not claimed.',
    },
    results: {
      'test|points': {
        metrics: (perTarget.points as { metrics: unknown }).metrics,
        paired_deltas: [
          packDelta('frozen_c', 'residual_role', (perTarget.points as { paired: { b_minus_a: ReturnType<typeof bootstrapMaeDifferenceGrouped> } }).paired.b_minus_a),
          packDelta('frozen_c', 'residual_wowy', (perTarget.points as { paired: { c_minus_a: ReturnType<typeof bootstrapMaeDifferenceGrouped> } }).paired.c_minus_a),
          packDelta('residual_role', 'residual_wowy', (perTarget.points as { paired: { c_minus_b: ReturnType<typeof bootstrapMaeDifferenceGrouped> } }).paired.c_minus_b),
        ],
      },
      'test|rebounds': {
        metrics: (perTarget.rebounds as { metrics: unknown }).metrics,
        paired_deltas: [
          packDelta('frozen_c', 'residual_role', (perTarget.rebounds as { paired: { b_minus_a: ReturnType<typeof bootstrapMaeDifferenceGrouped> } }).paired.b_minus_a),
          packDelta('frozen_c', 'residual_wowy', (perTarget.rebounds as { paired: { c_minus_a: ReturnType<typeof bootstrapMaeDifferenceGrouped> } }).paired.c_minus_a),
          packDelta('residual_role', 'residual_wowy', (perTarget.rebounds as { paired: { c_minus_b: ReturnType<typeof bootstrapMaeDifferenceGrouped> } }).paired.c_minus_b),
        ],
      },
    },
    per_target: perTarget,
    decision,
  };

  const slices = {
    slices: [
      ...(((perTarget.points as { slices: unknown[] }).slices) ?? []),
      ...(((perTarget.rebounds as { slices: unknown[] }).slices) ?? []),
    ],
  };

  writeFileSync(join(DIR, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
  writeFileSync(join(DIR, 'slices.json'), `${JSON.stringify(slices, null, 2)}\n`);
  writeFileSync(
    join(DIR, 'selection.json'),
    `${JSON.stringify(
      {
        seed: LEARNED_BOOTSTRAP_SEED,
        lambdas: KNOWN_OUT_RIDGE_LAMBDAS,
        points: (perTarget.points as { lambda_b: unknown; lambda_c: unknown }),
        rebounds: (perTarget.rebounds as { lambda_b: unknown; lambda_c: unknown }),
        bootstrap_iters: LEARNED_BOOTSTRAP_ITERS,
      },
      null,
      2
    )}\n`
  );

  const reconHash = createHash('sha256');
  reconHash.update(JSON.stringify({ freeze: freeze.cohort_sha256, droppedNoC, train: train.length, eval: evalRows.length }));
  writeFileSync(
    join(DIR, 'reconciliation.json'),
    `${JSON.stringify(
      {
        dataset_sha256: freeze.cohort_sha256,
        n_cohort: cohort.length,
        n_dropped_missing_frozen_c: droppedNoC,
        n_modeled: joined.length,
        n_train: train.length,
        n_eval: evalRows.length,
        teammate_ultimately_played: joined.filter((r) => r.teammate_ultimately_played).length,
        eval_et_dates: freeze.eligible.eval_et_dates,
        decision: decision.label,
      },
      null,
      2
    )}\n`
  );

  console.log(JSON.stringify({ decision: decision.label, droppedNoC, train: train.length, eval: evalRows.length, ptsCb, rebCb }));
}

const ROLE_FEATURES_NEED = [
  'min_l10',
  'min_season',
  'pts_l10',
  'pts_per_min_l10',
  'reb_l10',
  'reb_per_min_l10',
  'opportunity_matched_l10',
  'prior_played_count',
] as const;

function packDelta(
  left: string,
  right: string,
  d: { delta: number | null; ciLow: number | null; ciHigh: number | null; n: number; nGroups: number; iterations: number }
) {
  return {
    left_model_id: left,
    right_model_id: right,
    delta: d.delta,
    ci_low: d.ciLow,
    ci_high: d.ciHigh,
    n: d.n,
    n_groups: d.nGroups,
    iterations: d.iterations,
    source: 'paired_observations' as const,
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
