import { describe, expect, it } from 'vitest';
import { evaluateMaxDeleteGuard } from '@/lib/prune/max-delete-guard';

describe('evaluateMaxDeleteGuard', () => {
  it('allows normal seasonal prune under caps', () => {
    const d = evaluateMaxDeleteGuard({
      table: 'raw.player_prop_snapshots_v2',
      totalRows: 300_000,
      eligibleRows: 40_000,
      maxPercent: 35,
      maxRows: 200_000,
      allowLargeDelete: false,
    });
    expect(d.allowed).toBe(true);
  });

  it('aborts unexpectedly large percent delete', () => {
    const d = evaluateMaxDeleteGuard({
      table: 'raw.player_prop_snapshots_v2',
      totalRows: 948_233,
      eligibleRows: 948_233,
      maxPercent: 35,
      maxRows: 200_000,
      allowLargeDelete: false,
    });
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/PRUNE_MAX_DELETE_ROWS|PRUNE_MAX_DELETE_PERCENT/);
  });

  it('aborts when row count exceeds max rows even if percent is low', () => {
    const d = evaluateMaxDeleteGuard({
      table: 'raw.player_prop_snapshots_v2',
      totalRows: 2_000_000,
      eligibleRows: 250_000,
      maxPercent: 35,
      maxRows: 200_000,
      allowLargeDelete: false,
    });
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/PRUNE_MAX_DELETE_ROWS/);
  });

  it('allows large delete with explicit override', () => {
    const d = evaluateMaxDeleteGuard({
      table: 'analytics.player_props_current',
      totalRows: 152_790,
      eligibleRows: 152_790,
      maxPercent: 35,
      maxRows: 200_000,
      allowLargeDelete: true,
    });
    expect(d.allowed).toBe(true);
    expect(d.reason).toMatch(/PRUNE_ALLOW_LARGE_DELETE/);
  });

  it('allows zero eligible', () => {
    const d = evaluateMaxDeleteGuard({
      table: 'raw.player_prop_snapshots_v2',
      totalRows: 10,
      eligibleRows: 0,
      maxPercent: 35,
      maxRows: 200_000,
      allowLargeDelete: false,
    });
    expect(d.allowed).toBe(true);
  });
});
