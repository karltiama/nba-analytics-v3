import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../../..');
const bundler = path.join(root, 'scripts/ops/bundle-ingestion-lambda.mjs');

function runBundleAll(): Record<string, string> {
  const result = spawnSync(process.execPath, [bundler, '--all'], {
    cwd: root,
    encoding: 'utf8',
  });
  expect(result.status, result.stderr).toBe(0);
  const hashes: Record<string, string> = {};
  for (const line of (result.stdout ?? '').split(/\r?\n/)) {
    const match = line.match(/^(\S+) sha256=([0-9a-f]{64})$/);
    if (match) hashes[match[1]] = match[2];
  }
  return hashes;
}

describe('ingestion Lambda bundle stability', () => {
  it('produces identical content hashes across two builds from unchanged source', () => {
    const first = runBundleAll();
    const second = runBundleAll();
    expect(Object.keys(first).length).toBeGreaterThanOrEqual(6);
    expect(second).toEqual(first);
  }, 120_000);

  it('hashes the written nightly artifact the same way twice on disk', () => {
    runBundleAll();
    const file = path.join(root, 'lambda/nightly-bdl-updater/.package/dist/index.js');
    const a = createHash('sha256').update(readFileSync(file)).digest('hex');
    const b = createHash('sha256').update(readFileSync(file)).digest('hex');
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  }, 120_000);
});
