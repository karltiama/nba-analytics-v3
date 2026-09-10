import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../../..');

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('odds live transform First Observed freeze', () => {
  it('does not overwrite open_* on Current refresh', () => {
    const src = read('lambda/odds-pre-game-snapshot/index.ts');
    expect(src).toMatch(
      /open_total = COALESCE\(analytics\.game_line_movement_summary\.open_total, excluded\.open_total\)/
    );
    expect(src).toMatch(
      /first_seen_at = COALESCE\(analytics\.game_line_movement_summary\.first_seen_at, excluded\.first_seen_at\)/
    );
    expect(src).not.toMatch(/open_total = excluded\.open_total/);
  });

  it('does not write historical Market Movement or Opening Snapshot tables', () => {
    const src = read('lambda/odds-pre-game-snapshot/index.ts');
    expect(src).not.toMatch(/game_odds_market_movement/);
    expect(src).not.toMatch(/opening_game_odds/);
    expect(src).not.toMatch(/player_props/);
  });
});
