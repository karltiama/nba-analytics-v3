import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../../..');

describe('player-prop snapshot archive copy drift', () => {
  it('Lambda copy matches lib/archive/player-prop-snapshot-archive.ts', () => {
    const canonical = fs.readFileSync(
      path.join(root, 'lib/archive/player-prop-snapshot-archive.ts'),
      'utf8'
    ).replace(/\r\n/g, '\n');
    const copy = fs.readFileSync(
      path.join(root, 'lambda/player-props-snapshot/src/player-prop-snapshot-archive.ts'),
      'utf8'
    ).replace(/\r\n/g, '\n');
    expect(copy).toBe(canonical);
  });
});
