/**
 * Freeze PTS C / REB C artifacts into a reproducible shadow bundle.
 * Does not refit. Does not overwrite if checksummed files already exist unless --overwrite.
 *
 *   npx tsx scripts/modeling/freeze-learned-shadow-bundle.ts
 */
import { createHash } from 'crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { execSync } from 'child_process';
import {
  LEARNED_R1_CANONICAL_RELATIVE_DIR,
  SHADOW_ARTIFACT_FILES,
  SHADOW_BUNDLE_RELATIVE_DIR,
  SHADOW_FEATURE_ORDER,
  SHADOW_FEATURE_SPEC_VERSION,
  SHADOW_MODEL_VERSION,
  SHADOW_PROTOCOL_VERSION,
  SHADOW_S3_PREFIX,
} from '../../lib/betting/player-projection-shadow-protocol';

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function sha256Text(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function gitHead(): { commit: string; dirty: boolean } {
  try {
    const commit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    const dirty = execSync('git status --porcelain', { encoding: 'utf8' }).trim().length > 0;
    return { commit, dirty };
  } catch {
    return { commit: 'unknown', dirty: true };
  }
}

function takeSample(rowsPath: string, predPath: string, n = 8): { features: string[]; preds: string[] } {
  const features: string[] = [];
  const preds: string[] = [];
  if (!existsSync(rowsPath) || !existsSync(predPath)) return { features, preds };
  const predMap = new Map<string, string>();
  for (const line of readFileSync(predPath, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as { player_id: string; game_id: string };
    predMap.set(`${row.player_id}|${row.game_id}`, line);
  }
  for (const line of readFileSync(rowsPath, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as {
      common_eligible?: boolean;
      split?: string;
      player_id: string;
      game_id: string;
      features_c: Record<string, number | null>;
      pred_a_points: number | null;
      pred_a_rebounds: number | null;
      pred_b_points: number | null;
      pred_b_rebounds: number | null;
      actual_pts: number | null;
      actual_reb: number | null;
    };
    if (row.common_eligible !== true || row.split !== 'validation') continue;
    const pred = predMap.get(`${row.player_id}|${row.game_id}`);
    if (!pred) continue;
    features.push(
      JSON.stringify({
        player_id: row.player_id,
        game_id: row.game_id,
        feature_order: SHADOW_FEATURE_ORDER,
        features_c: row.features_c,
        pred_a_points: row.pred_a_points,
        pred_a_rebounds: row.pred_a_rebounds,
        pred_b_points: row.pred_b_points,
        pred_b_rebounds: row.pred_b_rebounds,
        actual_pts: row.actual_pts,
        actual_reb: row.actual_reb,
      })
    );
    preds.push(pred);
    if (features.length >= n) break;
  }
  return { features, preds };
}

function main() {
  const overwrite = process.argv.includes('--overwrite');
  const srcDir = resolve(LEARNED_R1_CANONICAL_RELATIVE_DIR);
  const outDir = resolve(SHADOW_BUNDLE_RELATIVE_DIR);
  mkdirSync(outDir, { recursive: true });

  const srcPoints = join(srcDir, 'artifacts', SHADOW_ARTIFACT_FILES.pointsModel);
  const srcReb = join(srcDir, 'artifacts', SHADOW_ARTIFACT_FILES.reboundsModel);
  if (!existsSync(srcPoints) || !existsSync(srcReb)) {
    throw new Error(`Missing frozen CatBoost artifacts at ${srcDir}/artifacts`);
  }
  const destPoints = join(outDir, SHADOW_ARTIFACT_FILES.pointsModel);
  const destReb = join(outDir, SHADOW_ARTIFACT_FILES.reboundsModel);
  if (!overwrite && existsSync(destPoints) && existsSync(destReb)) {
    console.log('Bundle models already exist; leaving them in place (pass --overwrite to replace).');
  } else {
    copyFileSync(srcPoints, destPoints);
    copyFileSync(srcReb, destReb);
  }

  const selection = JSON.parse(readFileSync(join(srcDir, 'selection.json'), 'utf8')) as {
    seed: number;
    loss: string;
    dataset_sha256: string;
    feature_spec_version: string;
    catboost_version: string;
    pandas_version: string;
    numpy_version: string;
    models: Record<string, { selected: unknown }>;
  };
  const spec = readFileSync(join(srcDir, 'feature_spec.json'), 'utf8');
  const recon = JSON.parse(readFileSync(join(srcDir, 'reconciliation.json'), 'utf8')) as {
    dataset_sha256: string;
  };
  const featureOrderText = JSON.stringify({ feature_order: SHADOW_FEATURE_ORDER }, null, 2) + '\n';
  writeFileSync(join(outDir, SHADOW_ARTIFACT_FILES.featureOrder), featureOrderText, 'utf8');

  const sample = takeSample(join(srcDir, 'rows.jsonl'), join(srcDir, 'predictions.jsonl'));
  writeFileSync(join(outDir, SHADOW_ARTIFACT_FILES.sampleFeatures), sample.features.join('\n') + (sample.features.length ? '\n' : ''), 'utf8');
  writeFileSync(join(outDir, SHADOW_ARTIFACT_FILES.samplePredictions), sample.preds.join('\n') + (sample.preds.length ? '\n' : ''), 'utf8');

  const git = gitHead();
  const manifest = {
    protocol_version: SHADOW_PROTOCOL_VERSION,
    model_version: SHADOW_MODEL_VERSION,
    feature_spec_version: SHADOW_FEATURE_SPEC_VERSION,
    frozen_targets: ['points', 'rebounds'],
    feature_set: 'C',
    feature_order: SHADOW_FEATURE_ORDER,
    code_commit: git.commit,
    working_tree_dirty: git.dirty,
    dataset_sha256: recon.dataset_sha256 || selection.dataset_sha256,
    feature_spec_sha256: sha256Text(spec),
    feature_order_sha256: sha256File(join(outDir, SHADOW_ARTIFACT_FILES.featureOrder)),
    model_sha256: {
      points: sha256File(destPoints),
      rebounds: sha256File(destReb),
    },
    training: {
      seed: selection.seed,
      loss: selection.loss,
      catboost_version: selection.catboost_version,
      pandas_version: selection.pandas_version,
      numpy_version: selection.numpy_version,
      selected: {
        c_points: selection.models.c_points?.selected,
        c_rebounds: selection.models.c_rebounds?.selected,
      },
      note: '2024 validation only. 2025 was not used to refit or reselect.',
    },
    s3_prefix: SHADOW_S3_PREFIX,
    skip_if_exists: true,
    created_at: new Date().toISOString(),
  };
  const manifestPath = join(outDir, SHADOW_ARTIFACT_FILES.manifest);
  if (!overwrite && existsSync(manifestPath)) {
    console.log('Manifest already exists; not overwriting.');
  } else {
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  }
  writeFileSync(join(outDir, '.gitignore'), '*.cbm\n', 'utf8');
  console.log(JSON.stringify({ outDir, model_sha256: manifest.model_sha256, code_commit: git.commit }, null, 2));
}

main();
