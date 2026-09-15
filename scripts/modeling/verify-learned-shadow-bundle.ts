/**
 * Local restore/scoring check for the frozen PTS C / REB C bundle.
 * Compares Python CatBoost scores on sample_features.jsonl to stored sample predictions.
 *
 *   npx tsx scripts/modeling/verify-learned-shadow-bundle.ts
 */
import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { spawnSync } from 'child_process';
import {
  SHADOW_ARTIFACT_FILES,
  SHADOW_BUNDLE_RELATIVE_DIR,
  SHADOW_FEATURE_ORDER,
} from '../../lib/betting/player-projection-shadow-protocol';

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function main() {
  const bundle = resolve(SHADOW_BUNDLE_RELATIVE_DIR);
  const manifest = JSON.parse(readFileSync(join(bundle, SHADOW_ARTIFACT_FILES.manifest), 'utf8')) as {
    feature_order: string[];
    model_sha256: { points: string; rebounds: string };
  };
  if (manifest.feature_order.length !== SHADOW_FEATURE_ORDER.length ||
      manifest.feature_order.some((name, i) => name !== SHADOW_FEATURE_ORDER[i])) {
    throw new Error('Feature ordering/artifact mismatch vs frozen protocol order');
  }
  const ptsHash = sha256File(join(bundle, SHADOW_ARTIFACT_FILES.pointsModel));
  const rebHash = sha256File(join(bundle, SHADOW_ARTIFACT_FILES.reboundsModel));
  if (ptsHash !== manifest.model_sha256.points || rebHash !== manifest.model_sha256.rebounds) {
    throw new Error('Local model checksums do not match the manifest');
  }
  const tmp = join(bundle, '_verify');
  mkdirSync(tmp, { recursive: true });
  const scoredPath = join(tmp, 'scored.jsonl');
  const py = spawnSync(
    'python',
    [
      'scripts/modeling/score_catboost_shadow.py',
      '--bundle',
      bundle,
      '--in',
      join(bundle, SHADOW_ARTIFACT_FILES.sampleFeatures),
      '--out',
      scoredPath,
    ],
    { encoding: 'utf8' }
  );
  if (py.status !== 0) {
    throw new Error(py.stderr || py.stdout || 'python score failed');
  }
  const stored = readFileSync(join(bundle, SHADOW_ARTIFACT_FILES.samplePredictions), 'utf8')
    .trim()
    .split(/\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const scored = readFileSync(scoredPath, 'utf8')
    .trim()
    .split(/\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  if (scored.length === 0) throw new Error('no scored sample rows');
  let maxAbs = 0;
  for (const row of scored) {
    const hit = stored.find((s) => s.player_id === row.player_id && s.game_id === row.game_id);
    if (!hit) continue;
    const dPts = Math.abs(Number(row.yhat_c_points) - Number(hit.yhat_c_points));
    const dReb = Math.abs(Number(row.yhat_c_rebounds) - Number(hit.yhat_c_rebounds));
    maxAbs = Math.max(maxAbs, dPts, dReb);
  }
  const ok = maxAbs < 1e-6;
  console.log(
    JSON.stringify(
      {
        local_restore: true,
        checksums_ok: true,
        scored: scored.length,
        max_abs_diff_vs_stored: maxAbs,
        scoring_matches_stored_sample: ok,
        sample_file_exists: existsSync(join(bundle, SHADOW_ARTIFACT_FILES.sampleFeatures)),
      },
      null,
      2
    )
  );
  if (!ok) process.exit(1);
}

main();
