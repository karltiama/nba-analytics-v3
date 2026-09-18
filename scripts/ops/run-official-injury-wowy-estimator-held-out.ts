/**
 * Blind held-out first-run for injury-wowy-estimator-v1.
 * Run exactly once after development freeze.
 *
 *   npx tsx scripts/ops/run-official-injury-wowy-estimator-held-out.ts
 */

import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { createGunzip } from 'node:zlib';
import {
  assertMetric,
  buildEstimatorWindow,
  estimatePairFromWindow,
  type EstimatorObservation,
  type EstimatorResult,
} from '../../lib/injuries/official/injury-wowy-estimator';

const ROOT = process.cwd();
const ABS = 1e-10;
const REL = 1e-10;

function close(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(ABS, REL * Math.max(Math.abs(a), Math.abs(b)));
}

function sha256File(rel: string): string {
  return createHash('sha256').update(readFileSync(path.join(ROOT, rel))).digest('hex');
}

async function loadCorpus(): Promise<EstimatorObservation[]> {
  const manifest = new Map<string, string>();
  for (const line of readFileSync(
    path.join(ROOT, 'tmp/official-injury-wowy-estimator/game-start-manifest.ndjson'),
    'utf8'
  ).split('\n')) {
    if (!line.trim()) continue;
    const o = JSON.parse(line) as { game_id: string; start_time_utc: string };
    manifest.set(o.game_id, o.start_time_utc);
  }
  const out: EstimatorObservation[] = [];
  const stream = createReadStream(
    path.join(ROOT, 'tmp/official-injury-wowy-pairs/p1.ndjson.gz')
  ).pipe(createGunzip());
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const o = JSON.parse(line) as Record<string, unknown>;
    out.push({
      game_id: String(o.game_id),
      game_start: manifest.get(String(o.game_id))!,
      season: String(o.season),
      team_id: String(o.team_id),
      subject_player_entity_id: String(o.subject_player_entity_id),
      focal_player_entity_id: String(o.focal_player_entity_id),
      focal_state: o.focal_state as EstimatorObservation['focal_state'],
      subject_metrics: o.subject_metrics as Record<string, number>,
      cohort_p0: true,
      cohort_p1: Boolean(o.cohort_p1),
      cohort_p2: Boolean(o.cohort_p2),
      cohort_p3: Boolean(o.cohort_p3),
    });
  }
  return out;
}

function compare(got: EstimatorResult, exp: Record<string, unknown>): string[] {
  const errs: string[] = [];
  for (const k of [
    'estimation_status',
    'ui_display_eligible',
    'quality_tier',
    'with_n',
    'without_n',
    'prior_pair_count',
    'pooled_residual_df',
    'with_variance_source',
    'without_variance_source',
  ] as const) {
    if (got[k] !== exp[k]) errs.push(`${k}: got ${String(got[k])} expected ${String(exp[k])}`);
  }
  for (const k of [
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
    const e = exp[k];
    const g = got[k];
    if (e == null) {
      if (g != null) errs.push(`${k}: expected null`);
    } else if (g == null || !close(g as number, e as number)) {
      errs.push(`${k}: got ${String(g)} expected ${String(e)}`);
    }
  }
  return errs;
}

async function main() {
  const dir = path.join(ROOT, 'tests/fixtures/official-injury-wowy-estimator/held_out');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  const obs = await loadCorpus();
  const results: Array<{ fixture_id: string; ok: boolean; errors: string[] }> = [];
  let exact = 0;
  for (const f of files) {
    const fx = JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as {
      fixture_id: string;
      kind: string;
      input: Record<string, unknown>;
      expected: Record<string, unknown>;
    };
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
    const errors = compare(got, fx.expected);
    const ok = errors.length === 0;
    if (ok) exact += 1;
    results.push({ fixture_id: fx.fixture_id, ok, errors });
  }

  const fingerprints = {
    'lib/injuries/official/injury-wowy-estimator.ts': sha256File(
      'lib/injuries/official/injury-wowy-estimator.ts'
    ),
    'lib/injuries/official/injury-wowy-eb.ts': sha256File('lib/injuries/official/injury-wowy-eb.ts'),
    'lib/injuries/official/__tests__/injury-wowy-estimator.test.ts': sha256File(
      'lib/injuries/official/__tests__/injury-wowy-estimator.test.ts'
    ),
    'scripts/ops/_injury_wowy_estimator_ref.py': sha256File(
      'scripts/ops/_injury_wowy_estimator_ref.py'
    ),
    'tmp/official-injury-wowy-estimator/game-start-manifest.ndjson': sha256File(
      'tmp/official-injury-wowy-estimator/game-start-manifest.ndjson'
    ),
  };

  const report = {
    generated_at: new Date().toISOString(),
    phase: '6D',
    immutable_first_run: true,
    exact,
    total: files.length,
    all_pass: exact === files.length,
    fingerprints,
    results,
  };

  const outDir = path.join(ROOT, 'reports/operations');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    path.join(outDir, 'official-injury-wowy-estimator-held-out-first-run.json'),
    JSON.stringify(report, null, 2) + '\n',
    'utf8'
  );
  const md = `# Injury WOWY estimator held-out first run

Generated: **${report.generated_at}**

\`\`\`text
immutable_first_run = true
exact = ${exact} / ${files.length}
\`\`\`

${results.map((r) => `- ${r.fixture_id}: ${r.ok ? 'PASS' : 'FAIL ' + r.errors.join('; ')}`).join('\n')}
`;
  writeFileSync(path.join(outDir, 'official-injury-wowy-estimator-held-out-first-run.md'), md, 'utf8');
  console.log(JSON.stringify({ exact, total: files.length, all_pass: report.all_pass }, null, 2));
  if (!report.all_pass) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
