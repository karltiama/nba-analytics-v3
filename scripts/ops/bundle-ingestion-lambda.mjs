/**
 * Deterministic esbuild packaging for deployed ingestion Lambdas.
 * Mirrors lambda/game-status-sync/build.mjs: source → .package/dist → stable hash.
 *
 * Usage (repo root):
 *   node scripts/ops/bundle-ingestion-lambda.mjs --all
 *   node scripts/ops/bundle-ingestion-lambda.mjs --lambda=nightly-bdl-updater
 *   npm run build:ingestion-lambdas
 *
 * Does not copy .env or Terraform files. Does not invoke AWS.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');

/** @typedef {{ dir: string, entries: Record<string, string> }} LambdaBundleSpec */

/** @type {Record<string, LambdaBundleSpec>} */
export const INGESTION_LAMBDA_BUNDLES = {
  'nightly-bdl-updater': {
    dir: 'lambda/nightly-bdl-updater',
    entries: { 'dist/index.js': 'index.ts' },
  },
  'odds-pre-game-snapshot': {
    dir: 'lambda/odds-pre-game-snapshot',
    entries: { 'dist/index.js': 'index.ts' },
  },
  'injuries-snapshot': {
    dir: 'lambda/injuries-snapshot',
    entries: { 'dist/index.js': 'index.ts' },
  },
  'player-props-snapshot': {
    dir: 'lambda/player-props-snapshot',
    entries: {
      'dist/controller.js': 'controller.ts',
      'dist/worker.js': 'worker.ts',
    },
  },
  'boxscore-scraper': {
    dir: 'lambda/boxscore-scraper',
    entries: { 'dist/index.js': 'index.ts' },
  },
};

async function resolveEsbuild() {
  const require = createRequire(path.join(root, 'package.json'));
  const searchPaths = [
    root,
    path.join(root, 'node_modules/tsx'),
    path.join(root, 'node_modules/vitest'),
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

export function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

export async function bundleIngestionLambda(name, esbuild = null) {
  const spec = INGESTION_LAMBDA_BUNDLES[name];
  if (!spec) {
    throw new Error(`Unknown ingestion Lambda bundle: ${name}`);
  }
  const engine = esbuild ?? (await resolveEsbuild());
  const lambdaRoot = path.join(root, spec.dir);
  const hashes = {};

  for (const [outRel, entryRel] of Object.entries(spec.entries)) {
    const outfile = path.join(lambdaRoot, '.package', outRel);
    mkdirSync(path.dirname(outfile), { recursive: true });
    await engine.build({
      absWorkingDir: root,
      entryPoints: [path.join(lambdaRoot, entryRel)],
      bundle: true,
      platform: 'node',
      target: 'node22',
      format: 'cjs',
      outfile,
      alias: { '@': root },
      external: ['pg-native'],
      sourcemap: false,
      legalComments: 'none',
      logLevel: 'warning',
    });
    hashes[outRel] = sha256File(outfile);
  }
  return hashes;
}

function parseArgs(argv) {
  const names = [];
  let all = false;
  for (const arg of argv) {
    if (arg === '--all') all = true;
    else if (arg.startsWith('--lambda=')) names.push(arg.slice('--lambda='.length));
  }
  if (all) return Object.keys(INGESTION_LAMBDA_BUNDLES);
  if (names.length === 0) {
    throw new Error('Pass --all or --lambda=<name>');
  }
  return names;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const names = parseArgs(process.argv.slice(2));
  const esbuild = await resolveEsbuild();
  for (const name of names) {
    const hashes = await bundleIngestionLambda(name, esbuild);
    for (const [file, hash] of Object.entries(hashes)) {
      console.log(`${name}/${file} sha256=${hash}`);
    }
  }
}
