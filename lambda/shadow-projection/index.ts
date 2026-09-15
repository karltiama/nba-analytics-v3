/**
 * Deployable shadow scoring + settlement Lambda.
 * Disabled by default: freeze env + EventBridge state DISABLED.
 *
 * Event: { action?: 'score' | 'settle' }
 */

import { spawnSync } from 'child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Pool } from 'pg';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { S3Storage } from '@/lib/aws/s3';
import {
  loadLocalShadowArtifacts,
  localBundleExists,
  shadowS3Prefix,
  verifyManifestAndModels,
  type ShadowManifest,
} from '@/lib/betting/player-projection-shadow-artifacts';
import { SHADOW_ARTIFACT_FILES, SHADOW_BUNDLE_RELATIVE_DIR } from '@/lib/betting/player-projection-shadow-protocol';
import {
  runShadowScoreCycle,
  runShadowSettleCycle,
  type ShadowScorerResult,
  type ShadowScorerRow,
} from '@/lib/betting/player-projection-shadow-worker';

const pool = new Pool({
  connectionString: (process.env.SUPABASE_DB_URL || '').trim(),
  connectionTimeoutMillis: 15000,
  idleTimeoutMillis: 30000,
  max: 1,
  ssl: { rejectUnauthorized: false },
});

async function loadArtifacts() {
  const bundleDir = process.env.SHADOW_BUNDLE_DIR;
  if (bundleDir && localBundleExists(bundleDir)) return loadLocalShadowArtifacts(bundleDir);
  if (localBundleExists()) return loadLocalShadowArtifacts();
  const bucket = process.env.NBA_DATA_BUCKET;
  if (!bucket) throw new Error('NBA_DATA_BUCKET or SHADOW_BUNDLE_DIR required to load frozen artifacts');
  const prefix = shadowS3Prefix();
  const s3 = new S3Storage({ bucket });
  const manifestBytes = await s3.getBytes(`${prefix}/${SHADOW_ARTIFACT_FILES.manifest}`);
  const points = await s3.getBytes(`${prefix}/${SHADOW_ARTIFACT_FILES.pointsModel}`);
  const rebounds = await s3.getBytes(`${prefix}/${SHADOW_ARTIFACT_FILES.reboundsModel}`);
  if (!manifestBytes || !points || !rebounds) {
    throw new Error(`frozen shadow artifacts missing from s3://${bucket}/${prefix}`);
  }
  const manifest = JSON.parse(Buffer.from(manifestBytes).toString('utf8')) as ShadowManifest;
  return verifyManifestAndModels({
    manifest,
    pointsModel: Buffer.from(points),
    reboundsModel: Buffer.from(rebounds),
  });
}

async function scoreViaLambda(rows: ShadowScorerRow[]): Promise<ShadowScorerResult[]> {
  const fn = process.env.SHADOW_SCORER_LAMBDA;
  if (!fn) throw new Error('SHADOW_SCORER_LAMBDA is not set');
  const client = new LambdaClient({});
  const res = await client.send(
    new InvokeCommand({
      FunctionName: fn,
      Payload: Buffer.from(
        JSON.stringify({
          rows,
          bucket: process.env.NBA_DATA_BUCKET,
          prefix: shadowS3Prefix(),
        })
      ),
    })
  );
  const payload = res.Payload ? Buffer.from(res.Payload).toString('utf8') : '{}';
  const parsed = JSON.parse(payload) as { predictions?: ShadowScorerResult[]; errorMessage?: string };
  if (res.FunctionError) throw new Error(parsed.errorMessage || payload);
  return parsed.predictions ?? [];
}

function scoreViaPython(rows: ShadowScorerRow[]): ShadowScorerResult[] {
  const dir = mkdtempSync(join(tmpdir(), 'shadow-score-'));
  const inPath = join(dir, 'features.jsonl');
  const outPath = join(dir, 'predictions.jsonl');
  writeFileSync(inPath, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  const bundle = process.env.SHADOW_BUNDLE_DIR || SHADOW_BUNDLE_RELATIVE_DIR;
  const py = process.env.SHADOW_PYTHON || 'python';
  const r = spawnSync(
    py,
    ['scripts/modeling/score_catboost_shadow.py', '--bundle', bundle, '--in', inPath, '--out', outPath],
    { encoding: 'utf8' }
  );
  if (r.status !== 0) {
    throw new Error(r.stderr || r.stdout || `python scorer exited ${r.status}`);
  }
  return readFileSync(outPath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ShadowScorerResult);
}

async function scoreRows(rows: ShadowScorerRow[]): Promise<ShadowScorerResult[]> {
  if (rows.length === 0) return [];
  if (process.env.SHADOW_SCORER_LAMBDA) return scoreViaLambda(rows);
  return scoreViaPython(rows);
}

export async function handler(event: { action?: string } = {}): Promise<{
  statusCode: number;
  body: string;
}> {
  if (!process.env.SUPABASE_DB_URL) {
    return { statusCode: 500, body: JSON.stringify({ error: 'missing SUPABASE_DB_URL' }) };
  }
  const action = event.action === 'settle' ? 'settle' : event.action === 'score' ? 'score' : 'cycle';
  const ports = {
    now: () => new Date(),
    db: pool,
    scorer: scoreRows,
    loadArtifacts,
  };
  try {
    if (action === 'settle') {
      const result = await runShadowSettleCycle(ports);
      console.log(JSON.stringify({ shadow_run: result }));
      return { statusCode: result.status === 'preflight_failed' ? 412 : 200, body: JSON.stringify(result) };
    }
    if (action === 'score') {
      const result = await runShadowScoreCycle(ports);
      console.log(JSON.stringify({ shadow_run: result }));
      return { statusCode: result.status === 'preflight_failed' ? 412 : 200, body: JSON.stringify(result) };
    }
    const scored = await runShadowScoreCycle(ports);
    const settled = await runShadowSettleCycle(ports);
    const combined = { scored, settled };
    console.log(JSON.stringify({ shadow_run: combined }));
    const failed = scored.status === 'preflight_failed' || settled.status === 'preflight_failed';
    return { statusCode: failed ? 412 : 200, body: JSON.stringify(combined) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ shadow_run_error: message }));
    return { statusCode: 500, body: JSON.stringify({ error: message }) };
  }
}
