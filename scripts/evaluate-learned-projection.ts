/**
 * Honest A/B/C/D evaluation for learned projection r1.
 * 2024 = selection/validation. 2025 = previously inspected historical confirmation.
 *
 *   npx tsx scripts/evaluate-learned-projection.ts
 */
import 'dotenv/config';

import { createReadStream, mkdirSync, writeFileSync } from 'fs';
import { createInterface } from 'readline';
import { join } from 'path';
import {
  LEARNED_BOOTSTRAP_ITERS,
  LEARNED_BOOTSTRAP_SEED,
  LEARNED_EXPERIMENT_VERSION,
  LEARNED_TARGETS,
  bootstrapMaeDifferenceGrouped,
  type LearnedTarget,
} from '../lib/betting/player-projection-learned-features';

type SplitName = 'train' | 'validation' | 'test';

type Row = {
  player_id: string;
  game_id: string;
  split: SplitName;
  basketball_date: string | null;
  common_eligible: boolean;
  minutes_change_bucket: string;
  volume_bucket: string;
  limited_history: number;
  pred_a_points: number | null;
  pred_a_rebounds: number | null;
  pred_a_assists: number | null;
  pred_a_threes: number | null;
  pred_b_points: number | null;
  pred_b_rebounds: number | null;
  pred_b_assists: number | null;
  pred_b_threes: number | null;
  actual_pts: number | null;
  actual_reb: number | null;
  actual_ast: number | null;
  actual_threes: number | null;
  actual_pra: number | null;
  yhat_c_points?: number | null;
  yhat_c_rebounds?: number | null;
  yhat_c_assists?: number | null;
  yhat_c_threes?: number | null;
  yhat_d_points?: number | null;
  yhat_d_rebounds?: number | null;
  yhat_d_assists?: number | null;
  yhat_d_threes?: number | null;
};

const MODELS = ['A', 'B', 'C', 'D'] as const;
type ModelId = (typeof MODELS)[number];

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

async function readJsonl(path: string): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  const rl = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.trim()) rows.push(JSON.parse(line) as Record<string, unknown>);
  }
  return rows;
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function pred(row: Row, model: ModelId, target: LearnedTarget | 'pra'): number | null {
  if (target === 'pra') {
    const p = pred(row, model, 'points');
    const r = pred(row, model, 'rebounds');
    const a = pred(row, model, 'assists');
    if (p == null || r == null || a == null) return null;
    return p + r + a;
  }
  if (model === 'A') {
    if (target === 'points') return num(row.pred_a_points);
    if (target === 'rebounds') return num(row.pred_a_rebounds);
    if (target === 'assists') return num(row.pred_a_assists);
    return num(row.pred_a_threes);
  }
  if (model === 'B') {
    if (target === 'points') return num(row.pred_b_points);
    if (target === 'rebounds') return num(row.pred_b_rebounds);
    if (target === 'assists') return num(row.pred_b_assists);
    return num(row.pred_b_threes);
  }
  const key = `yhat_${model.toLowerCase()}_${target}` as keyof Row;
  return num(row[key]);
}

function actual(row: Row, target: LearnedTarget | 'pra'): number | null {
  if (target === 'pra') return num(row.actual_pra);
  if (target === 'points') return num(row.actual_pts);
  if (target === 'rebounds') return num(row.actual_reb);
  if (target === 'assists') return num(row.actual_ast);
  return num(row.actual_threes);
}

function metrics(
  rows: Row[],
  model: ModelId,
  target: LearnedTarget | 'pra'
): {
  mae: number | null;
  rmse: number | null;
  bias: number | null;
  coverage: number;
  n: number;
  nFinite: number;
} {
  let abs = 0;
  let sq = 0;
  let signed = 0;
  let nFinite = 0;
  for (const row of rows) {
    const y = actual(row, target);
    const p = pred(row, model, target);
    if (y == null || p == null) continue;
    const e = p - y;
    abs += Math.abs(e);
    sq += e * e;
    signed += e;
    nFinite += 1;
  }
  return {
    mae: nFinite ? abs / nFinite : null,
    rmse: nFinite ? Math.sqrt(sq / nFinite) : null,
    bias: nFinite ? signed / nFinite : null,
    coverage: rows.length ? nFinite / rows.length : 0,
    n: rows.length,
    nFinite,
  };
}

function paired(
  rows: Row[],
  left: ModelId,
  right: ModelId,
  target: LearnedTarget | 'pra'
) {
  const errL: number[] = [];
  const errR: number[] = [];
  const groups: string[] = [];
  for (const row of rows) {
    const y = actual(row, target);
    const pL = pred(row, left, target);
    const pR = pred(row, right, target);
    if (y == null || pL == null || pR == null) continue;
    errL.push(pL - y);
    errR.push(pR - y);
    groups.push(row.basketball_date ?? row.game_id);
  }
  const boot = bootstrapMaeDifferenceGrouped(errL, errR, groups, LEARNED_BOOTSTRAP_ITERS, LEARNED_BOOTSTRAP_SEED);
  return {
    ...boot,
    leftMae: errL.length ? errL.reduce((a, b) => a + Math.abs(b), 0) / errL.length : null,
    rightMae: errR.length ? errR.reduce((a, b) => a + Math.abs(b), 0) / errR.length : null,
  };
}

function fmt(n: number | null | undefined, digits = 3): string {
  if (n == null || !Number.isFinite(n)) return 'n/a';
  return n.toFixed(digits);
}

function mdTable(headers: string[], rows: Array<Array<string | number>>): string {
  const head = `| ${headers.join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((r) => `| ${r.map((c) => String(c)).join(' | ')} |`).join('\n');
  return `${head}\n${sep}\n${body}`;
}

function sliceRows(rows: Row[], key: 'minutes_change_bucket' | 'volume_bucket' | 'limited_history', value: string | number) {
  return rows.filter((r) => r[key] === value);
}

async function main() {
  const inDir = argValue('--in-dir') ?? join('reports', 'modeling', 'learned-r1');
  const rowsRaw = await readJsonl(join(inDir, 'rows.jsonl'));
  const predsRaw = await readJsonl(join(inDir, 'predictions.jsonl'));
  const predMap = new Map<string, Record<string, unknown>>();
  for (const p of predsRaw) {
    predMap.set(`${String(p.player_id)}|${String(p.game_id)}`, p);
  }

  const rows: Row[] = [];
  for (const raw of rowsRaw) {
    if (raw.common_eligible !== true) continue;
    const split = String(raw.split) as SplitName;
    if (split !== 'train' && split !== 'validation' && split !== 'test') continue;
    const p = predMap.get(`${String(raw.player_id)}|${String(raw.game_id)}`);
    rows.push({
      ...(raw as unknown as Row),
      split,
      yhat_c_points: num(p?.yhat_c_points),
      yhat_c_rebounds: num(p?.yhat_c_rebounds),
      yhat_c_assists: num(p?.yhat_c_assists),
      yhat_c_threes: num(p?.yhat_c_threes),
      yhat_d_points: num(p?.yhat_d_points),
      yhat_d_rebounds: num(p?.yhat_d_rebounds),
      yhat_d_assists: num(p?.yhat_d_assists),
      yhat_d_threes: num(p?.yhat_d_threes),
    });
  }

  const bySplit = {
    validation: rows.filter((r) => r.split === 'validation'),
    test: rows.filter((r) => r.split === 'test'),
  };

  const targets: Array<LearnedTarget | 'pra'> = [...LEARNED_TARGETS, 'pra'];
  const payload: Record<string, unknown> = {
    version: LEARNED_EXPERIMENT_VERSION,
    n_common: {
      validation: bySplit.validation.length,
      test: bySplit.test.length,
    },
    note: {
      validation: 'Used for early stopping and model selection.',
      test: 'Previously inspected historical confirmation (2025). Not an untouched holdout. Cannot authorize production promotion.',
    },
    results: {} as Record<string, unknown>,
  };

  const md: string[] = [
    '# Player projection learned r1',
    '',
    `Version: \`${LEARNED_EXPERIMENT_VERSION}\`. Research only. Production unchanged.`,
    '',
    'Train 2023, select on 2024, score 2025 as **previously inspected historical confirmation**. No historical period here is an untouched holdout. Prospective 2026–27 shadow is the future holdout.',
    '',
    'A = frozen played-only 70/30. B = frozen conditional EWM minutes (never on 3PM). C = learned production/role/opportunity features. D = C + schedule/team/opponent reconstructed context.',
    '',
    'PRA is ŷ_PTS+ŷ_REB+ŷ_AST. It is a derived target and is not independent evidence.',
    '',
    'Historical validity: reconstructed from completed boxes. Publication timestamps and retrospective corrections are not fully observable.',
    '',
    `Common eligible rows: validation n=${bySplit.validation.length}; 2025 confirmation n=${bySplit.test.length}.`,
    '',
  ];

  for (const split of ['validation', 'test'] as const) {
    const subset = bySplit[split];
    const title = split === 'validation' ? '2024 validation (selection)' : '2025 previously inspected confirmation';
    md.push(`## ${title}`, '');
    const tableRows: Array<Array<string | number>> = [];
    for (const target of targets) {
      const label = target === 'pra' ? 'PRA (derived)' : target.toUpperCase();
      for (const model of MODELS) {
        const m = metrics(subset, model, target);
        tableRows.push([
          label,
          model,
          fmt(m.mae, 4),
          fmt(m.rmse, 4),
          fmt(m.bias, 4),
          fmt(m.coverage, 3),
          m.nFinite,
        ]);
      }
    }
    md.push(
      mdTable(['Target', 'Model', 'MAE', 'RMSE', 'Bias', 'Coverage', 'N'], tableRows),
      ''
    );

    const deltaRows: Array<Array<string | number>> = [];
    for (const target of targets) {
      const vsB = paired(subset, 'B', 'C', target);
      const cd = paired(subset, 'C', 'D', target);
      const dVsB = paired(subset, 'B', 'D', target);
      deltaRows.push([
        target === 'pra' ? 'PRA (derived)' : target.toUpperCase(),
        fmt(vsB.delta, 4),
        `${fmt(vsB.ciLow, 4)}, ${fmt(vsB.ciHigh, 4)}`,
        fmt(cd.delta, 4),
        `${fmt(cd.ciLow, 4)}, ${fmt(cd.ciHigh, 4)}`,
        fmt(dVsB.delta, 4),
        `${fmt(dVsB.ciLow, 4)}, ${fmt(dVsB.ciHigh, 4)}`,
        String(vsB.n),
      ]);
      (payload.results as Record<string, unknown>)[`${split}|${target}`] = {
        metrics: Object.fromEntries(MODELS.map((model) => [model, metrics(subset, model, target)])),
        delta_c_minus_b: vsB,
        delta_d_minus_c: cd,
        delta_d_minus_b: dVsB,
      };
    }
    md.push(
      'Paired ΔMAE with game-date grouped bootstrap (negative = improvement). C−B, D−C, D−B.',
      '',
      mdTable(['Target', 'C−B', 'C−B 95% CI', 'D−C', 'D−C 95% CI', 'D−B', 'D−B 95% CI', 'N'], deltaRows),
      ''
    );
  }

  md.push('## Pregame slices (2024 validation, PTS)', '');
  const val = bySplit.validation;
  const sliceTable: Array<Array<string | number>> = [];
  const slices: Array<{ name: string; rows: Row[] }> = [
    { name: 'minutes stable', rows: sliceRows(val, 'minutes_change_bucket', 'stable') },
    { name: 'minutes moderate', rows: sliceRows(val, 'minutes_change_bucket', 'moderate') },
    { name: 'minutes large', rows: sliceRows(val, 'minutes_change_bucket', 'large') },
    { name: 'volume low', rows: sliceRows(val, 'volume_bucket', 'low') },
    { name: 'volume rotation', rows: sliceRows(val, 'volume_bucket', 'rotation') },
    { name: 'volume high', rows: sliceRows(val, 'volume_bucket', 'high') },
    { name: 'limited history (<5 prior played)', rows: sliceRows(val, 'limited_history', 1) },
    { name: 'not limited history', rows: sliceRows(val, 'limited_history', 0) },
  ];
  for (const slice of slices) {
    const b = metrics(slice.rows, 'B', 'points');
    const c = metrics(slice.rows, 'C', 'points');
    const d = metrics(slice.rows, 'D', 'points');
    const cd = paired(slice.rows, 'C', 'D', 'points');
    sliceTable.push([
      slice.name,
      slice.rows.length,
      fmt(b.mae, 4),
      fmt(c.mae, 4),
      fmt(d.mae, 4),
      fmt(cd.delta, 4),
      `${fmt(cd.ciLow, 4)}, ${fmt(cd.ciHigh, 4)}`,
    ]);
  }
  md.push(
    mdTable(['Slice', 'N', 'B MAE', 'C MAE', 'D MAE', 'D−C', 'D−C 95% CI'], sliceTable),
    '',
    'Slices use pregame information only (minutes-change, season-to-date minutes volume, prior played count). Realized target minutes are not used.',
    ''
  );

  const shadow: string[] = [];
  for (const target of LEARNED_TARGETS) {
    const valCd = paired(bySplit.validation, 'C', 'D', target);
    const valCb = paired(bySplit.validation, 'B', 'C', target);
    const valDb = paired(bySplit.validation, 'B', 'D', target);
    const dAddsContext =
      valCd.delta != null && valCd.ciHigh != null && valCd.delta <= -0.01 && valCd.ciHigh < 0;
    const cHelps =
      valCb.delta != null && valCb.ciHigh != null && valCb.delta <= -0.01 && valCb.ciHigh < 0;
    const dVsB =
      valDb.delta != null && valDb.ciHigh != null && valDb.delta <= -0.01 && valDb.ciHigh < 0;
    let nominee = 'none';
    if (dAddsContext && dVsB) nominee = 'D';
    else if (cHelps) nominee = 'C';
    else if (dVsB) nominee = 'D';
    shadow.push(
      `${target.toUpperCase()}: val C−B Δ=${fmt(valCb.delta, 4)} [${fmt(valCb.ciLow, 4)}, ${fmt(valCb.ciHigh, 4)}]; D−C Δ=${fmt(valCd.delta, 4)} [${fmt(valCd.ciLow, 4)}, ${fmt(valCd.ciHigh, 4)}]; nominee=${nominee}`
    );
  }
  md.push(
    '## Shadow nomination (from 2024 validation only)',
    '',
    'A model may be nominated for 2026–27 prospective shadow if 2024 ΔMAE vs B is ≤ −0.01 with grouped 95% CI entirely below 0. D is nominated over C only when context also clears that bar versus C. 2025 confirmation cannot promote. PRA is ignored for nomination.',
    '',
    ...shadow.map((s) => `- ${s}`),
    '',
    'Activation of collection and production serving are out of scope for this slice.',
    ''
  );

  mkdirSync(inDir, { recursive: true });
  writeFileSync(join(inDir, 'results.json'), JSON.stringify(payload, null, 2) + '\n', 'utf8');
  writeFileSync(join(inDir, 'player-projection-learned-r1-results.md'), md.join('\n'), 'utf8');
  console.log(md.join('\n'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
