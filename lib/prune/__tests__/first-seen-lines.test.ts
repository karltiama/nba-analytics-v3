import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import {
  MATERIALIZE_CLOSING_LINES_OBSERVED_SQL,
  MATERIALIZE_FIRST_SEEN_LINES_SQL,
  countPendingFirstSeenLinesForPruneEligible,
  materializeFirstSeenLines,
} from '@/lib/prune/closing-lines';

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

function pool(opts: { table: boolean; observed: boolean; inserted?: number; pending?: number }) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('to_regclass')) return { rows: [{ rel: opts.table ? 'research.prop_first_seen_lines' : null }] };
    if (sql.includes('information_schema.columns')) return { rows: opts.observed ? [{ ok: 1 }] : [] };
    if (sql.includes('INSERT INTO research.prop_first_seen_lines')) return { rows: [], rowCount: opts.inserted ?? 0 };
    if (sql.includes('pending_first_seen')) return { rows: [{ count: String(opts.pending ?? 0) }] };
    throw new Error(`unexpected SQL: ${sql.slice(0, 80)}`);
  });
  return { query } as unknown as Pool & { query: typeof query };
}

describe('first-seen lines', () => {
  it('mirrors the closing SQL filter and keeps the earliest pre-tip observation', () => {
    const first = norm(MATERIALIZE_FIRST_SEEN_LINES_SQL);
    const close = norm(MATERIALIZE_CLOSING_LINES_OBSERVED_SQL);
    const where = (s: string) => s.slice(s.indexOf('WHERE g.status'), s.indexOf('AND NOT EXISTS'));
    expect(where(first)).toBe(where(close));
    expect(first).toContain('d.decision_at ASC');
    expect(first).toContain('r.pull_run_id ASC NULLS LAST');
    expect(close).toContain('d.decision_at DESC');
    expect(first).toContain('ON CONFLICT (game_id, player_id, sportsbook, prop_type, side) DO NOTHING');
  });

  it('returns null and writes nothing before the migration is applied', async () => {
    const p = pool({ table: false, observed: true });
    expect(await materializeFirstSeenLines(p)).toBeNull();
    expect(await countPendingFirstSeenLinesForPruneEligible(p)).toBeNull();
    expect(p.query.mock.calls.some(([sql]) => String(sql).includes('INSERT'))).toBe(false);
  });

  it('returns null without the observation-clock columns', async () => {
    const p = pool({ table: true, observed: false });
    expect(await materializeFirstSeenLines(p)).toBeNull();
  });

  it('materializes and counts pending keys once installed', async () => {
    const p = pool({ table: true, observed: true, inserted: 42, pending: 7 });
    expect(await materializeFirstSeenLines(p)).toBe(42);
    expect(await countPendingFirstSeenLinesForPruneEligible(p, 3)).toBe(7);
  });
});
