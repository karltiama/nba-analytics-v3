import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../../..');

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('fail-closed ingestion source guards', () => {
  it('Terraform does not lookup-default DATA_MODE to live_api', () => {
    const tf = read('infra/lambda.tf');
    expect(tf).toMatch(/ingestion_freeze_defaults/);
    expect(tf).toMatch(/DATA_MODE\s*=\s*"replay"/);
    expect(tf).not.toMatch(/lookup\([^)]*DATA_MODE[^)]*live_api/);
    expect(tf).not.toMatch(/lookup\([^)]*OFFSEASON_MODE[^)]*"0"/);
    expect(tf).not.toMatch(/lookup\([^)]*CRON_DRY_RUN[^)]*"0"/);
  });

  it('launch ingestion entrypoints do not default missing DATA_MODE to live_api', () => {
    const files = [
      'lambda/nightly-bdl-updater/index.ts',
      'lambda/odds-pre-game-snapshot/index.ts',
      'lambda/injuries-snapshot/index.ts',
      'lambda/boxscore-scraper/index.ts',
      'lambda/player-props-snapshot/src/env.ts',
      'app/api/cron/paper-settle/route.ts',
    ];
    for (const file of files) {
      const src = read(file);
      expect(src, file).not.toMatch(/DATA_MODE\s*\|\|\s*['"]live_api['"]/);
      expect(src, file).not.toMatch(/process\.env\.DATA_MODE\s*\|\|\s*['"]live_api['"]/);
    }
  });
});
