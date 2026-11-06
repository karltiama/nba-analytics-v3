import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../..');

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

describe('typography phase 3 matchup historical movement', () => {
  const movement = read('components/betting/market-movement/MarketMovementSection.tsx');

  it('uses card data and metadata on Market Movement without renaming events', () => {
    expect(movement).toContain('type-card-data');
    expect(movement).toContain('type-metadata');
    expect(movement).toContain('type-section-heading');
    expect(movement).toContain('explorerBookDisplayName');
    expect(movement).toContain('MARKET_MOVEMENT_VIEWED');
    expect(movement).toContain('MARKET_MOVEMENT_UPGRADE_CLICKED');
    expect(movement).not.toContain('text-[11px]');
    expect(movement).not.toContain('uppercase');
    expect(movement).not.toContain('#8aa0a3');
  });
});
