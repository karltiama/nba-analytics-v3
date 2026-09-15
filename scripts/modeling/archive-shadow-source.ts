/**
 * Checksummed source snapshot for frozen PTS C / REB C shadow deployment.
 * Excludes credentials, large datasets, and model binaries (already hashed in the manifest).
 *
 *   npx tsx scripts/modeling/archive-shadow-source.ts
 */
import { createHash } from 'crypto';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const OUT_DIR = join(ROOT, 'reports/modeling/shadow-pts-reb-c-r1/source');

const PATHS = [
  'lib/betting/player-projection-learned-features.ts',
  'lib/betting/player-projection-shadow-protocol.ts',
  'lib/betting/player-projection-shadow-scoring.ts',
  'lib/betting/player-projection-shadow-timing.ts',
  'lib/betting/player-projection-shadow-store.ts',
  'lib/betting/player-projection-shadow-worker.ts',
  'lib/betting/player-projection-shadow-artifacts.ts',
  'lib/betting/player-projection-shadow-health.ts',
  'lib/betting/minutes-projection-eval.ts',
  'lib/context/collection-asof.ts',
  'lib/db/schema-capability.ts',
  'lib/injuries/collector-persist.ts',
  'lib/injuries/ingest-plan.ts',
  'lib/postgame/starters-stage.ts',
  'lib/aws/s3.ts',
  'lib/ops/ingestion-observability.ts',
  'lib/ops/ingestion-cadence.ts',
  'lib/ops/platform-health.ts',
  'lib/ops/provider-capability.ts',
  'lib/ops/aws-ingestion-resources.ts',
  'lambda/injuries-snapshot/index.ts',
  'lambda/injuries-snapshot/ingest-plan.ts',
  'lambda/injuries-snapshot/collector-persist.ts',
  'lambda/injuries-snapshot/schema-capability.ts',
  'lambda/shadow-projection/index.ts',
  'lambda/shadow-projection-scorer/handler.py',
  'lambda/shadow-projection-scorer/requirements.txt',
  'scripts/export-learned-projection-rows.ts',
  'scripts/evaluate-learned-projection.ts',
  'scripts/modeling/train_catboost_projection.py',
  'scripts/modeling/score_catboost_shadow.py',
  'scripts/modeling/freeze-learned-shadow-bundle.ts',
  'scripts/modeling/verify-learned-shadow-bundle.ts',
  'scripts/modeling/upload-learned-shadow-bundle.ts',
  'scripts/modeling/archive-shadow-source.ts',
  'scripts/modeling/verify-shadow-schema-local.ts',
  'scripts/injuries/validate-asof-replay-2026.ts',
  'db/schemas/MIGRATION_context_collection_snapshots.sql',
  'infra/shadow-projection.tf',
  'infra/lambda.tf',
  'infra/variables.tf',
  'infra/monitoring.tf',
  'infra/terraform.tfvars.example',
  'reports/modeling/shadow-pts-reb-c-r1/player-projection-shadow-protocol-r1.md',
  'reports/modeling/shadow-pts-reb-c-r1/deployment-package-r1.1.md',
  'package.json',
];

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const files: Array<{ path: string; sha256: string; bytes: number }> = [];
  const parts: Buffer[] = [];
  for (const rel of PATHS) {
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) continue;
    const buf = readFileSync(abs);
    files.push({ path: rel.replace(/\\/g, '/'), sha256: sha256(buf), bytes: buf.length });
    parts.push(Buffer.from(`\n----- FILE ${rel} -----\n`), buf);
  }
  const archive = Buffer.concat(parts);
  const archivePath = join(OUT_DIR, 'shadow-source-r1.1.txt');
  writeFileSync(archivePath, archive);
  let gitHead = 'unknown';
  let dirty = true;
  try {
    gitHead = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    dirty = execSync('git status --porcelain', { encoding: 'utf8' }).trim().length > 0;
  } catch {
    /* ignore */
  }
  const inventory = {
    created_at: new Date().toISOString(),
    git_head_at_archive: gitHead,
    working_tree_dirty: dirty,
    archive: 'shadow-source-r1.1.txt',
    archive_sha256: sha256(archive),
    excluded: [
      '.env',
      'infra/terraform.tfvars',
      'reports/modeling/learned-r1/rows.jsonl',
      'reports/modeling/learned-r1/predictions.jsonl',
      '*.cbm',
    ],
    files,
  };
  writeFileSync(join(OUT_DIR, 'inventory.json'), JSON.stringify(inventory, null, 2));
  console.log(JSON.stringify({ archive_sha256: inventory.archive_sha256, files: files.length, gitHead, dirty }, null, 2));
}

main();
