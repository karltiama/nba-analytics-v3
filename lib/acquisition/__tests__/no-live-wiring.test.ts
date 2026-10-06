import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');
const SCAN_DIRS = ['lambda', 'lib', 'app', 'scripts', 'infra'];
const SKIP = new Set(['node_modules', '.next', 'dist', 'build', '.terraform', '__tests__']);
const ACQ_DIR = path.join(ROOT, 'lib', 'acquisition');
const IMPORT_PATTERN = /lib\/acquisition|from ['"]\.{1,2}\/(?:\.\.\/)*acquisition/;

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP.has(name)) continue;
    const full = path.join(dir, name);
    if (full.startsWith(ACQ_DIR)) continue;
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mts|js|mjs|cjs)$/.test(name)) out.push(full);
  }
}

/** DATA2E.1 wires game-status-sync only. Props / odds / injuries collectors stay unwired. */
const ALLOWED_IMPORTERS = new Set([
  'lib/games/status-sync-acquisition.ts',
  'lib/games/status-sync-lambda.ts',
]);

describe('acquisition primitive wiring is limited to game-status-sync', () => {
  it('no source outside lib/acquisition imports it except the allowlisted game-status-sync files', () => {
    const files: string[] = [];
    for (const d of SCAN_DIRS) walk(path.join(ROOT, d), files);
    expect(files.length).toBeGreaterThan(50);
    const importers = files
      .filter((f) => IMPORT_PATTERN.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(ROOT, f).replace(/\\/g, '/'));
    expect(importers.filter((f) => !ALLOWED_IMPORTERS.has(f))).toEqual([]);
    expect([...ALLOWED_IMPORTERS].every((f) => importers.includes(f))).toBe(true);
  });
});
