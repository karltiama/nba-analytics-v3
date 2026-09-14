import { describe, expect, it } from 'vitest';
import {
  formatPropArchiveReconcileReport,
  parseReconcileArgs,
  summarizePropArchiveReconciliation,
} from '@/lib/archive/reconcile-prop-archive';

describe('prop archive reconciliation', () => {
  it('parses --date and range flags', () => {
    expect(parseReconcileArgs(['--date', '2026-10-21'])).toEqual({
      from: '2026-10-21',
      to: '2026-10-21',
      checkS3: false,
    });
    expect(parseReconcileArgs(['--from', '2026-10-21', '--to', '2026-10-22', '--s3'])).toEqual({
      from: '2026-10-21',
      to: '2026-10-22',
      checkS3: true,
    });
  });

  it('counts missing tapes when rows were stored without archive', () => {
    const report = summarizePropArchiveReconciliation(
      [
        {
          pullRunId: 1,
          gameId: 'a',
          startedAt: '2026-10-21T18:00:00.000Z',
          rowsStored: 182442,
          rowsArchived: 182442,
          archiveObjectCount: 1,
          archiveStatus: 'archived',
          archiveKey: 'raw/source=balldontlie/...json.gz',
        },
        {
          pullRunId: 2,
          gameId: 'b',
          startedAt: '2026-10-21T18:00:00.000Z',
          rowsStored: 10,
          rowsArchived: 0,
          archiveObjectCount: 0,
          archiveStatus: 'failed',
          archiveKey: null,
        },
      ],
      { from: '2026-10-21', to: '2026-10-21' }
    );
    expect(report.gameRuns).toBe(2);
    expect(report.missingArchives).toBe(1);
    expect(report.failedArchives).toBe(1);
    expect(formatPropArchiveReconcileReport(report)).toContain('missing archives:   1');
  });
});
