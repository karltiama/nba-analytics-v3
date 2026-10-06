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

describe('DATA2A: shared acquisition primitive is not wired into any collector', () => {
  it('no source outside lib/acquisition imports it', () => {
    const files: string[] = [];
    for (const d of SCAN_DIRS) walk(path.join(ROOT, d), files);
    expect(files.length).toBeGreaterThan(50);
    const offenders = files.filter((f) => IMPORT_PATTERN.test(readFileSync(f, 'utf8'))).map((f) => path.relative(ROOT, f));
    expect(offenders).toEqual([]);
  });
});
