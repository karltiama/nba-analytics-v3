import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../../..');

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
}

const COPIES = [
  'lambda/nightly-bdl-updater/season-eligibility.ts',
  'lambda/player-props-snapshot/src/season-eligibility.ts',
];

describe('season eligibility copy drift', () => {
  it('Lambda copies match lambda/shared/season-eligibility.ts', () => {
    const canonical = read('lambda/shared/season-eligibility.ts');
    for (const file of COPIES) {
      expect(read(file), file).toBe(canonical);
    }
  });

  it('canonical module has no imports, so copies stay standalone', () => {
    expect(read('lambda/shared/season-eligibility.ts')).not.toMatch(/^import /m);
  });

  it('lib re-exports the canonical module instead of re-implementing it', () => {
    expect(read('lib/games/season-eligibility.ts').trim()).toBe(
      "export * from '../../lambda/shared/season-eligibility';"
    );
  });

  it('opening-night and postseason maps are defined only in the canonical module', () => {
    expect(read('lib/context-projection/game-universe.ts')).not.toMatch(/REGULAR_SEASON_OPEN_ET[^=\n]*=\s*\{/);
    expect(read('lib/wowy/calendar.ts')).not.toMatch(/WOWY_POSTSEASON_START_ET[^=\n]*=\s*\{/);
  });
});
