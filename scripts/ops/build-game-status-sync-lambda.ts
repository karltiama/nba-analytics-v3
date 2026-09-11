/**
 * Reproducible game-status-sync Lambda package.
 * No AWS credentials, BDL key, or Postgres required.
 *
 *   npx tsx scripts/ops/build-game-status-sync-lambda.ts
 *   npm run build:game-status-sync-lambda
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');
const result = spawnSync(process.execPath, ['lambda/game-status-sync/build.mjs'], {
  cwd: root,
  stdio: 'inherit',
});
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
