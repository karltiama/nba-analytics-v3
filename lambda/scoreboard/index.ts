/**
 * Display-only scoreboard collector Lambda entry.
 * Bundled by build.mjs so @/ aliases and lib/scoreboard resolve at runtime.
 * Do not duplicate domain logic here.
 *
 * Use a local import/re-export (not `export { x } from`) so esbuild CJS
 * actually includes lib/scoreboard/lambda.ts.
 */

import { handler, runLambdaScoreboard } from '../../lib/scoreboard/lambda';
export { handler, runLambdaScoreboard };
export type { ScoreboardLambdaDeps } from '../../lib/scoreboard/lambda';
