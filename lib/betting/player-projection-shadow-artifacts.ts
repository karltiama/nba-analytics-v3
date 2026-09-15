/**
 * Load and verify frozen PTS C / REB C artifacts. Does not retrain.
 */

import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  SHADOW_ARTIFACT_FILES,
  SHADOW_BUNDLE_RELATIVE_DIR,
  SHADOW_FEATURE_ORDER,
  SHADOW_S3_PREFIX,
} from '@/lib/betting/player-projection-shadow-protocol';
import { assertFeatureOrder } from '@/lib/betting/player-projection-shadow-scoring';
import type { ShadowArtifacts } from '@/lib/betting/player-projection-shadow-worker';

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

export type ShadowManifest = {
  feature_order: string[];
  model_sha256: { points: string; rebounds: string };
  s3_prefix?: string;
};

export function verifyManifestAndModels(args: {
  manifest: ShadowManifest;
  pointsModel: Buffer;
  reboundsModel: Buffer;
}): ShadowArtifacts {
  assertFeatureOrder(args.manifest.feature_order, SHADOW_FEATURE_ORDER);
  const points = sha256(args.pointsModel);
  const rebounds = sha256(args.reboundsModel);
  if (points !== args.manifest.model_sha256.points || rebounds !== args.manifest.model_sha256.rebounds) {
    throw new Error(
      `artifact checksum mismatch: points ${points} vs ${args.manifest.model_sha256.points}; rebounds ${rebounds} vs ${args.manifest.model_sha256.rebounds}`
    );
  }
  return {
    featureOrder: args.manifest.feature_order,
    modelChecksums: { points, rebounds },
  };
}

export function loadLocalShadowArtifacts(bundleDir?: string): ShadowArtifacts {
  const dir = bundleDir ?? join(process.cwd(), SHADOW_BUNDLE_RELATIVE_DIR);
  const manifest = JSON.parse(readFileSync(join(dir, SHADOW_ARTIFACT_FILES.manifest), 'utf8')) as ShadowManifest;
  const pointsModel = readFileSync(join(dir, SHADOW_ARTIFACT_FILES.pointsModel));
  const reboundsModel = readFileSync(join(dir, SHADOW_ARTIFACT_FILES.reboundsModel));
  return verifyManifestAndModels({ manifest, pointsModel, reboundsModel });
}

export function localBundleExists(bundleDir?: string): boolean {
  const dir = bundleDir ?? join(process.cwd(), SHADOW_BUNDLE_RELATIVE_DIR);
  return existsSync(join(dir, SHADOW_ARTIFACT_FILES.manifest));
}

export function shadowS3Prefix(env: Record<string, string | undefined> = process.env): string {
  return env.SHADOW_BUNDLE_S3_PREFIX ?? SHADOW_S3_PREFIX;
}
