import { describe, expect, it } from 'vitest';
import {
  COMPLETE_PULL_FRACTION_OF_PREVIOUS,
  MIN_COMPLETE_INJURY_ROW_COUNT,
  REMOVED_FROM_REPORT_STATUS,
  areConsecutiveInjuryPullIds,
  completeInjuryRowFloor,
  detectRemovedPlayerIds,
  evaluateInjuryPullCompleteness,
  isActiveReportedInjuryStatus,
  isRemovedFromReportStatus,
} from '@/lib/injuries/leave-report';

describe('leave-report semantics', () => {
  it('uses RemovedFromReport rather than Available', () => {
    expect(REMOVED_FROM_REPORT_STATUS).toBe('RemovedFromReport');
    expect(isRemovedFromReportStatus('RemovedFromReport')).toBe(true);
    expect(isActiveReportedInjuryStatus('RemovedFromReport')).toBe(false);
    expect(isActiveReportedInjuryStatus('Available')).toBe(false);
    expect(isActiveReportedInjuryStatus('Cleared')).toBe(false);
    expect(isActiveReportedInjuryStatus('Out')).toBe(true);
    expect(isActiveReportedInjuryStatus('Questionable')).toBe(true);
  });

  it('orders consecutive pulls as adjacent pull_run_id only', () => {
    expect(areConsecutiveInjuryPullIds(10, 11)).toBe(true);
    expect(areConsecutiveInjuryPullIds(10, 12)).toBe(false);
    expect(areConsecutiveInjuryPullIds(11, 10)).toBe(false);
  });

  it('rejects failed, incomplete, mismatched, empty, and abnormally small pulls', () => {
    const prev = 128;
    expect(
      evaluateInjuryPullCompleteness({
        status: 'error',
        completed: true,
        rowsStored: 128,
        rowsReturned: 128,
        previousRowsStored: prev,
      }).complete
    ).toBe(false);
    expect(
      evaluateInjuryPullCompleteness({
        status: 'success',
        completed: false,
        rowsStored: 128,
        rowsReturned: 128,
        previousRowsStored: prev,
      }).complete
    ).toBe(false);
    expect(
      evaluateInjuryPullCompleteness({
        status: 'success',
        completed: true,
        rowsStored: 100,
        rowsReturned: 128,
        previousRowsStored: prev,
      }).complete
    ).toBe(false);
    expect(
      evaluateInjuryPullCompleteness({
        status: 'success',
        completed: true,
        rowsStored: 0,
        rowsReturned: 0,
        previousRowsStored: prev,
      }).complete
    ).toBe(false);
    expect(
      evaluateInjuryPullCompleteness({
        status: 'success',
        completed: true,
        rowsStored: 10,
        rowsReturned: 10,
        previousRowsStored: prev,
      }).complete
    ).toBe(false);
  });

  it('accepts a successful pull at or above the previous-fraction floor', () => {
    const prev = 128;
    const floor = completeInjuryRowFloor(prev);
    expect(floor).toBe(
      Math.max(MIN_COMPLETE_INJURY_ROW_COUNT, Math.ceil(prev * COMPLETE_PULL_FRACTION_OF_PREVIOUS))
    );
    expect(
      evaluateInjuryPullCompleteness({
        status: 'success',
        completed: true,
        rowsStored: 110,
        rowsReturned: 110,
        previousRowsStored: prev,
      }).complete
    ).toBe(true);
  });

  it('detects presence on N and absence on N+1', () => {
    expect(detectRemovedPlayerIds(['a', 'b', 'c'], ['a', 'c'])).toEqual(['b']);
    expect(detectRemovedPlayerIds(['a'], ['a', 'b'])).toEqual([]);
  });
});
