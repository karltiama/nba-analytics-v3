import { describe, expect, it } from 'vitest';
import { simulatePlayerPropArchivePipeline } from '@/lib/archive/simulate-player-prop-archive';

describe('simulate player-prop archive pipeline', () => {
  it('round-trips fixture rows without touching existing_ingestion', async () => {
    const demo = await simulatePlayerPropArchivePipeline();
    expect(demo.key).toContain('source=balldontlie');
    expect(demo.key).toContain('entity=player_prop_snapshots');
    expect(demo.rowCount).toBe(2);
    expect(demo.timing).toBe('pregame');
    expect(demo.pregameRowCount).toBe(2);
    expect(demo.pruneWithoutArchive).toBe(false);
    expect(demo.pruneWithArchive).toBe(true);
    expect(demo.protectedPrefixUntouched).toBe(true);
  });
});
