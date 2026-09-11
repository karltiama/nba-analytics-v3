/**
 * Frequent /v1/games status-sync Lambda entry.
 * Bundled by build.mjs so @/ aliases and lib/games resolve at runtime.
 * Do not duplicate domain logic here.
 *
 * Use a local import/re-export (not `export { x } from`) so esbuild CJS
 * actually includes lib/games/status-sync-lambda.ts.
 */

import { handler, runLambdaGameStatusSync } from '../../lib/games/status-sync-lambda';
export { handler, runLambdaGameStatusSync };
export type { LambdaGameStatusSyncDeps, LambdaGameStatusSyncResult } from '../../lib/games/status-sync-lambda';
