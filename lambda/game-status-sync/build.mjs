/**
 * Bundle lib/games status-sync + shared BDL limiter into a Lambda-safe CJS artifact.
 * Resolves @/* to the repo root. Does not copy .env or Terraform files.
 *
 * Usage (from repo root): npm run build:game-status-sync-lambda
 * Or: node lambda/game-status-sync/build.mjs
 */

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const outfile = path.join(here, '.package/dist/index.js');

async function resolveEsbuild() {
  const require = createRequire(path.join(root, 'package.json'));
  const searchPaths = [
    root,
    path.join(root, 'node_modules/tsx'),
    path.join(root, 'node_modules/vitest'),
    here,
  ];
  for (const p of searchPaths) {
    try {
      const resolved = require.resolve('esbuild', { paths: [p] });
      return await import(pathToFileURL(resolved).href);
    } catch {
      /* next */
    }
  }
  throw new Error(
    'esbuild not found. Install it (already a tsx/vitest transitive dep) or run npm install.'
  );
}

const esbuild = await resolveEsbuild();
mkdirSync(path.dirname(outfile), { recursive: true });

await esbuild.build({
  absWorkingDir: root,
  entryPoints: [path.join(here, 'index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile,
  alias: { '@': root },
  external: ['pg-native'],
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
});

console.log(`game-status-sync bundle written: ${path.relative(root, outfile)}`);
