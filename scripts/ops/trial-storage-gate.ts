/**
 * Read-only trial storage gate. Never prune/vacuum.
 *
 *   npm run ops:trial-storage-gate -- --previous=reports/storage/pre-trial.json --current=reports/storage/after-2024.json --phase=after-2024
 */
import 'dotenv/config';
import fs from 'node:fs';
import {
  evaluateTrialStorageGate,
  parseTrialStoragePhase,
  type StorageCheckpointLike,
} from '@/lib/ops/trial-storage-gate';

function readJson(p: string): StorageCheckpointLike {
  return JSON.parse(fs.readFileSync(p, 'utf8')) as StorageCheckpointLike;
}

function flag(argv: string[], name: string): string | undefined {
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  if (i >= 0) return argv[i + 1];
  return undefined;
}

const argv = process.argv.slice(2);
const phase = parseTrialStoragePhase(flag(argv, 'phase'));
const currentPath = flag(argv, 'current');
if (!currentPath) {
  console.error('Missing --current=<checkpoint.json>');
  process.exit(1);
}
const previousPath = flag(argv, 'previous');
const result = evaluateTrialStorageGate({
  phase,
  previous: previousPath ? readJson(previousPath) : null,
  current: readJson(currentPath),
});
console.log(JSON.stringify(result, null, 2));
if (!result.ok) {
  for (const f of result.failures) console.error(`[gate] ${f}`);
  process.exit(1);
}
