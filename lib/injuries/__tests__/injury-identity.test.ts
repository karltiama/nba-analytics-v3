import { describe, expect, it } from 'vitest';
import { entityIdForNbaPlayer } from '@/lib/roster/class-c-onboarding';
import { WILSON_BDL_ID } from '@/lib/roster/identity-integrity';
import { entityIdForBdlPlayer } from '@/lib/roster/player-entity-backfill';
import { buildPlayerIdentityIndex } from '@/lib/identity/player-identity-resolve';
import {
  gateInjuryProviderIds,
  selectInjuryRowsForAnalytics,
} from '../injury-identity';
import type { InjuryPullRow } from '../ingest-plan';

function row(playerId: string): InjuryPullRow {
  return {
    playerId,
    teamId: '1',
    status: 'Out',
    description: null,
    returnDateRaw: null,
    snapshotAt: '2026-09-10T00:00:00.000Z',
  };
}

describe('injury identity adapter', () => {
  const index = buildPlayerIdentityIndex({
    bridges: [
      {
        playerEntityId: entityIdForBdlPlayer(WILSON_BDL_ID),
        provider: 'balldontlie',
        providerPlayerId: WILSON_BDL_ID,
      },
      {
        playerEntityId: entityIdForNbaPlayer('1643412'),
        provider: 'nba',
        providerPlayerId: '1643412',
      },
    ],
    projections: [
      {
        playerEntityId: entityIdForBdlPlayer(WILSON_BDL_ID),
        analyticsPlayerId: WILSON_BDL_ID,
      },
    ],
  });

  it('keeps serving BDL injuries and skips Class C / unknown without failing the board', () => {
    const rows = [row(WILSON_BDL_ID), row(WILSON_BDL_ID), row('1643412'), row('999999')];
    const gate = gateInjuryProviderIds({
      providerPlayerIds: rows.map((r) => r.playerId),
      index,
      observedAt: '2026-09-10T00:00:00.000Z',
    });
    const { keep, skipped } = selectInjuryRowsForAnalytics(rows, gate);
    expect(keep.map((r) => r.playerId)).toEqual([WILSON_BDL_ID, WILSON_BDL_ID]);
    expect(skipped).toHaveLength(2);
    expect(gate.accounting.serving).toBe(1);
    expect(gate.accounting.skipped).toBeGreaterThan(0);
  });
});
