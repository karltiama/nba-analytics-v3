/**
 * Phase 19 — collection worker fail-closed / isolation (no live DB writes).
 */

import { describe, expect, it } from 'vitest';
import {
  runContextProspectiveScoreCycle,
  runContextProspectiveCycle,
} from '@/lib/context-projection/collection-worker';
import type { SqlQueryable } from '@/lib/db/schema-capability';

const noopDb: SqlQueryable = {
  query: async () => ({ rows: [] }),
};

describe('Phase 19 — collection worker gates', () => {
  it('skips when freeze / dry-run', async () => {
    const r = await runContextProspectiveScoreCycle({
      now: () => new Date('2026-09-18T16:00:00Z'),
      db: noopDb,
      env: { DATA_MODE: 'replay', CONTEXT_PTS_SHADOW_WRITES: '1' },
    });
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe('freeze_or_dry_run');
  });

  it('skips when writes disabled', async () => {
    const r = await runContextProspectiveScoreCycle({
      now: () => new Date('2026-09-18T16:00:00Z'),
      db: noopDb,
      env: {
        DATA_MODE: 'live_api',
        CRON_DRY_RUN: '0',
        OFFSEASON_MODE: '0',
        CONTEXT_PTS_SHADOW_WRITES: '0',
        CONTEXT_MIN_SHADOW_WRITES: '0',
      },
    });
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe('writes_disabled');
  });

  it('cycle isolates score throw from settle path structure', async () => {
    const r = await runContextProspectiveCycle({
      now: () => new Date('2026-09-18T16:00:00Z'),
      db: noopDb,
      env: { DATA_MODE: 'replay' },
    });
    expect(r.score.skipped).toBe(true);
    expect(r.settle.skipped).toBe(true);
  });
});
