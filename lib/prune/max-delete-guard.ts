/**
 * Caps mass deletes so a misconfigured retention window cannot wipe a whole table.
 *
 * Defaults (overridable via env, see env-gate):
 * - PRUNE_MAX_DELETE_PERCENT=35
 * - PRUNE_MAX_DELETE_ROWS=200000
 * - PRUNE_ALLOW_LARGE_DELETE=1 bypasses both caps for intentional cleanups
 */

export type MaxDeleteInput = {
  table: string;
  totalRows: number;
  eligibleRows: number;
  maxPercent: number;
  maxRows: number;
  allowLargeDelete: boolean;
};

export type MaxDeleteDecision = {
  allowed: boolean;
  reason: string;
  eligiblePercent: number;
  table: string;
  totalRows: number;
  eligibleRows: number;
};

export function evaluateMaxDeleteGuard(input: MaxDeleteInput): MaxDeleteDecision {
  const {
    table,
    totalRows,
    eligibleRows,
    maxPercent,
    maxRows,
    allowLargeDelete,
  } = input;

  const eligiblePercent =
    totalRows <= 0 ? (eligibleRows > 0 ? 100 : 0) : (eligibleRows / totalRows) * 100;

  if (eligibleRows <= 0) {
    return {
      allowed: true,
      reason: 'no eligible rows',
      eligiblePercent,
      table,
      totalRows,
      eligibleRows,
    };
  }

  if (allowLargeDelete) {
    return {
      allowed: true,
      reason: 'PRUNE_ALLOW_LARGE_DELETE=1 override',
      eligiblePercent,
      table,
      totalRows,
      eligibleRows,
    };
  }

  if (eligibleRows > maxRows) {
    return {
      allowed: false,
      reason: `${table}: eligible ${eligibleRows} exceeds PRUNE_MAX_DELETE_ROWS=${maxRows}`,
      eligiblePercent,
      table,
      totalRows,
      eligibleRows,
    };
  }

  if (eligiblePercent > maxPercent) {
    return {
      allowed: false,
      reason: `${table}: eligible ${eligiblePercent.toFixed(1)}% exceeds PRUNE_MAX_DELETE_PERCENT=${maxPercent}`,
      eligiblePercent,
      table,
      totalRows,
      eligibleRows,
    };
  }

  return {
    allowed: true,
    reason: 'within max-delete caps',
    eligiblePercent,
    table,
    totalRows,
    eligibleRows,
  };
}
