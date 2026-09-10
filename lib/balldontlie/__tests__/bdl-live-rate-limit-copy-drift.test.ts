import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../../..');

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
}

const COPIES = [
  'lambda/nightly-bdl-updater/bdl-live-rate-limit.ts',
  'lambda/odds-pre-game-snapshot/bdl-live-rate-limit.ts',
  'lambda/injuries-snapshot/bdl-live-rate-limit.ts',
  'lambda/player-props-snapshot/src/bdl-live-rate-limit.ts',
];

const DYNAMO_COPIES = [
  'lambda/nightly-bdl-updater/bdl-live-rate-limit-dynamo.ts',
  'lambda/odds-pre-game-snapshot/bdl-live-rate-limit-dynamo.ts',
  'lambda/injuries-snapshot/bdl-live-rate-limit-dynamo.ts',
  'lambda/player-props-snapshot/src/bdl-live-rate-limit-dynamo.ts',
];

describe('live BDL limiter copy drift', () => {
  it('Lambda copies match lambda/shared/bdl-live-rate-limit.ts', () => {
    const canonical = read('lambda/shared/bdl-live-rate-limit.ts');
    for (const file of COPIES) {
      expect(read(file), file).toBe(canonical);
    }
  });

  it('Lambda Dynamo copies match lambda/shared/bdl-live-rate-limit-dynamo.ts', () => {
    const canonical = read('lambda/shared/bdl-live-rate-limit-dynamo.ts');
    for (const file of DYNAMO_COPIES) {
      expect(read(file), file).toBe(canonical);
    }
  });

  it('archive client does not import the live limiter', () => {
    const archive = read('lib/balldontlie/archive-client.ts');
    const trial = read('lib/balldontlie/trial-limiter.ts');
    expect(archive).not.toMatch(/live-rate-limit/);
    expect(trial).not.toMatch(/live-rate-limit/);
    expect(archive).not.toMatch(/fetchBdlLive/);
  });
});
