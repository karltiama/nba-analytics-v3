import { describe, expect, it, vi } from 'vitest';
import { evaluateInjuryTransitionCoverage } from '@/lib/prune/injury-coverage-gate';

type QueryHandler = (
  sql: string,
  params?: unknown[]
) => Promise<{ rows: Array<Record<string, unknown>> }>;

function makeDb(handler: QueryHandler) {
  return { query: vi.fn(handler) };
}

describe('evaluateInjuryTransitionCoverage', () => {
  it('blocks prune when leave-report transitions are unresolved', async () => {
    const db = makeDb(async (sql) => {
      const s = sql.replace(/\s+/g, ' ').toLowerCase();
      if (s.includes("h.status = 'removedfromreport'")) {
        if (s.includes('having count(*) > 1')) {
          return { rows: [{ n: 0 }] };
        }
        return { rows: [{ n: 230 }] };
      }
      if (s.includes('count(*)::int as n from (') && s.includes('next_pulled_at')) {
        return { rows: [{ n: 789 }] };
      }
      if (s.includes('first_pull')) {
        return { rows: [{ n: 0 }] };
      }
      if (s.includes('provider_team_id is distinct from')) {
        return { rows: [{ n: 0 }] };
      }
      if (s.includes('having count(*) > 1')) {
        return { rows: [{ n: 0 }] };
      }
      throw new Error(`unexpected sql: ${sql}`);
    });

    const r = await evaluateInjuryTransitionCoverage(db);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/unresolved leave-report/);
    expect(r.unresolvedLeaveReports).toBe(230);
  });

  it('allows future prune when first/change/leave-report coverage is complete', async () => {
    const db = makeDb(async () => ({ rows: [{ n: 0 }] }));
    const r = await evaluateInjuryTransitionCoverage(db);
    expect(r.ok).toBe(true);
    expect(r.unresolvedLeaveReports).toBe(0);
    expect(r.missingFirstSeen).toBe(0);
    expect(r.missingChanges).toBe(0);
  });
});
