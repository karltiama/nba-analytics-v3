import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { evaluateOddsCompactCoverage } from '@/lib/prune/odds-coverage-gate';

type QueryHandler = (
  sql: string,
  params?: unknown[]
) => Promise<{ rows: Array<Record<string, unknown>> }>;

function makeDb(handler: QueryHandler) {
  return { query: vi.fn(handler) } as unknown as Pool;
}

describe('evaluateOddsCompactCoverage', () => {
  it('blocks prune when eligible raw games lack history', async () => {
    const db = makeDb(async (sql) => {
      const s = sql.replace(/\s+/g, ' ').toLowerCase();
      if (s.includes('count(distinct r.game_id)')) {
        return { rows: [{ n: 12 }] };
      }
      if (s.includes('game_odds_history')) {
        return { rows: [{ game_id: '21681577' }, { game_id: '21681584' }] };
      }
      if (s.includes('game_odds_current')) {
        return { rows: [{ game_id: '21681577' }] };
      }
      throw new Error(`unexpected sql: ${sql}`);
    });

    const r = await evaluateOddsCompactCoverage(db, { olderThanDays: 14 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/missing game_odds_history/);
    expect(r.missingHistory).toEqual(['21681577', '21681584']);
    expect(r.requireCurrent).toBe(true);
  });

  it('blocks prune when history exists but current is missing', async () => {
    const db = makeDb(async (sql) => {
      const s = sql.replace(/\s+/g, ' ').toLowerCase();
      if (s.includes('count(distinct r.game_id)')) {
        return { rows: [{ n: 2 }] };
      }
      if (s.includes('game_odds_history')) {
        return { rows: [] };
      }
      if (s.includes('game_odds_current')) {
        return { rows: [{ game_id: '21708301' }] };
      }
      throw new Error(`unexpected sql: ${sql}`);
    });

    const r = await evaluateOddsCompactCoverage(db);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/missing game_odds_current/);
    expect(r.missingHistory).toEqual([]);
    expect(r.missingCurrent).toEqual(['21708301']);
  });

  it('allows future prune when every eligible raw game has history and current', async () => {
    const db = makeDb(async (sql) => {
      const s = sql.replace(/\s+/g, ' ').toLowerCase();
      if (s.includes('count(distinct r.game_id)')) {
        return { rows: [{ n: 334 }] };
      }
      if (s.includes('game_odds_history') || s.includes('game_odds_current')) {
        return { rows: [] };
      }
      throw new Error(`unexpected sql: ${sql}`);
    });

    const r = await evaluateOddsCompactCoverage(db, { olderThanDays: 90 });
    expect(r.ok).toBe(true);
    expect(r.rawGames).toBe(334);
    expect(r.missingHistory).toEqual([]);
    expect(r.missingCurrent).toEqual([]);
  });
});
