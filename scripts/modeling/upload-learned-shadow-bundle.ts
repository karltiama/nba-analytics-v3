/**
 * Upload / restore the frozen shadow bundle using S3 skip-if-exists.
 * Packaging locally is not persistence. The JSON result.remote records what actually happened.
 *
 *   npx tsx scripts/modeling/upload-learned-shadow-bundle.ts
 *   npx tsx scripts/modeling/upload-learned-shadow-bundle.ts --restore --dest reports/modeling/shadow-pts-reb-c-r1-restored
 */
import 'dotenv/config';

import { createHash } from 'crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { S3Storage } from '../../lib/aws/s3';
import {
  SHADOW_ARTIFACT_FILES,
  SHADOW_BUNDLE_RELATIVE_DIR,
  SHADOW_S3_PREFIX,
} from '../../lib/betting/player-projection-shadow-protocol';

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

const BUNDLE_FILES = [
  SHADOW_ARTIFACT_FILES.manifest,
  SHADOW_ARTIFACT_FILES.featureOrder,
  SHADOW_ARTIFACT_FILES.pointsModel,
  SHADOW_ARTIFACT_FILES.reboundsModel,
  SHADOW_ARTIFACT_FILES.sampleFeatures,
  SHADOW_ARTIFACT_FILES.samplePredictions,
] as const;

async function main() {
  const restore = process.argv.includes('--restore');
  const destArg = process.argv.indexOf('--dest');
  const dest = destArg >= 0 ? process.argv[destArg + 1] : SHADOW_BUNDLE_RELATIVE_DIR;
  const bucket = process.env.NBA_DATA_BUCKET;
  const src = resolve(SHADOW_BUNDLE_RELATIVE_DIR);
  if (!bucket) {
    console.log(
      JSON.stringify(
        {
          remote: { attempted: false, succeeded: false, reason: 'NBA_DATA_BUCKET unset' },
          local_bundle: src,
        },
        null,
        2
      )
    );
    return;
  }
  const s3 = new S3Storage({ bucket });
  if (restore) {
    mkdirSync(resolve(dest), { recursive: true });
    const restored: Record<string, unknown> = {};
    for (const file of BUNDLE_FILES) {
      const key = `${SHADOW_S3_PREFIX}/${file}`;
      if (file.endsWith('.cbm')) {
        const bytes = await s3.getBytes(key);
        restored[file] = bytes
          ? (writeFileSync(join(dest, file), Buffer.from(bytes)), { restored: true, bytes: bytes.byteLength })
          : { restored: false, reason: 'missing' };
      } else {
        const text = await s3.getText(key);
        restored[file] = text
          ? (writeFileSync(join(dest, file), text, 'utf8'), { restored: true, bytes: text.length })
          : { restored: false, reason: 'missing' };
      }
    }
    console.log(JSON.stringify({ remote: { attempted: true, action: 'restore', dest, files: restored } }, null, 2));
    return;
  }

  const results: Record<string, unknown> = {};
  for (const file of BUNDLE_FILES) {
    const path = join(src, file);
    const key = `${SHADOW_S3_PREFIX}/${file}`;
    if (file.endsWith('.cbm')) {
      results[file] = {
        ...(await s3.putBytes(key, readFileSync(path))),
        sha256: sha256File(path),
        key,
      };
    } else {
      results[file] = {
        ...(await s3.putText(key, readFileSync(path, 'utf8'), {
          contentType: file.endsWith('.jsonl') ? 'application/x-ndjson' : 'application/json',
        })),
        sha256: sha256File(path),
        key,
      };
    }
  }
  console.log(
    JSON.stringify(
      {
        remote: { attempted: true, succeeded: true, bucket, prefix: SHADOW_S3_PREFIX, skip_if_exists: true, files: results },
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  console.log(
    JSON.stringify(
      { remote: { attempted: true, succeeded: false, reason: err instanceof Error ? err.message : String(err) } },
      null,
      2
    )
  );
  process.exit(1);
});
