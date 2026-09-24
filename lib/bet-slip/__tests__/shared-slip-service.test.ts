import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

import { queryOne } from '@/lib/db';
import { adaptPropsExplorerOffer } from '@/lib/parlay/adapt-props-explorer-offer';
import { canonicalBetLegFromParlayOffer } from '../adapt-parlay-leg';
import {
  createSharedBetSlip,
  getSharedBetSlipByShareId,
  parseCanonicalBetLeg,
  parseLegsSnapshot,
} from '../shared-slip-service';
import type { CanonicalBetLeg } from '../types';

const mockQueryOne = queryOne as ReturnType<typeof vi.fn>;

function tatumLeg(overrides?: Partial<CanonicalBetLeg>): CanonicalBetLeg {
  const adapted = adaptPropsExplorerOffer({
    playerId: 1628369,
    playerName: 'Jayson Tatum',
    gameId: 'game-bos-mia-2026-03-17',
    propType: 'points',
    side: 'over',
    lineValue: 28.5,
    sportsbook: 'DraftKings',
    oddsAmerican: -110,
    marketContext: 'live',
    sourceTable: 'analytics.player_props_current',
    snapshotAt: '2026-03-17T18:00:00.000Z',
  });
  expect(adapted.ok).toBe(true);
  if (!adapted.ok) throw new Error(adapted.code);
  return { ...canonicalBetLegFromParlayOffer(adapted.offer), ...overrides };
}

describe('shared-slip-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects empty slips', async () => {
    const result = await createSharedBetSlip({
      slip: { legs: [], source: 'props_explorer' },
      createdBy: '11111111-1111-1111-1111-111111111111',
    });
    expect(result).toEqual({ ok: false, code: 'EMPTY_SLIP' });
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('persists frozen legs and returns public-safe fields only', async () => {
    const leg = tatumLeg();
    mockQueryOne.mockResolvedValueOnce({
      share_id: 'tok_test_share',
      title: 'Tonight',
      source: 'props_explorer',
      snapshot_version: 1,
      legs_snapshot: [leg],
      created_at: '2026-03-17T19:00:00.000Z',
      // Simulate a buggy driver that also returned secrets — mapper must ignore them.
      id: 'should-not-leak',
      created_by: 'should-not-leak',
    });

    const result = await createSharedBetSlip({
      slip: { legs: [leg], source: 'props_explorer', title: 'Tonight' },
      createdBy: '11111111-1111-1111-1111-111111111111',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.share.shareId).toBeTruthy();
    expect(result.share.path).toMatch(/^\/slip\//);
    expect(result.share.title).toBe('Tonight');
    expect(result.share.legs[0]?.line).toBe(28.5);
    expect(result.share.legs[0]?.selectedOdds).toBe(-110);
    expect(result.share.legs[0]?.selectedSportsbook).toBe('draftkings');
    expect(result.share).not.toHaveProperty('id');
    expect(result.share).not.toHaveProperty('created_by');
    expect(result.share).not.toHaveProperty('createdBy');

    const insertSql = String(mockQueryOne.mock.calls[0]?.[0] ?? '');
    expect(insertSql).toContain('RETURNING');
    expect(insertSql).toContain('share_id');
    expect(insertSql).not.toMatch(/RETURNING[\s\S]*\bcreated_by\b/);
  });

  it('getSharedBetSlipByShareId never surfaces created_by', async () => {
    const leg = tatumLeg();
    mockQueryOne.mockResolvedValueOnce({
      share_id: 'abc123',
      title: null,
      source: 'manual',
      snapshot_version: 1,
      legs_snapshot: [leg],
      created_at: '2026-03-17T19:00:00.000Z',
    });

    const result = await getSharedBetSlipByShareId('abc123');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.share.shareId).toBe('abc123');
    expect(JSON.stringify(result.share)).not.toContain('created_by');
    expect(result.share.legs[0]?.line).toBe(28.5);
  });

  it('returns NOT_FOUND when missing', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    await expect(getSharedBetSlipByShareId('missing')).resolves.toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
  });

  it('fail-closes on malformed legs_snapshot without repairing', async () => {
    mockQueryOne.mockResolvedValueOnce({
      share_id: 'bad',
      title: null,
      source: 'manual',
      snapshot_version: 1,
      legs_snapshot: [{ playerName: 'incomplete' }],
      created_at: '2026-03-17T19:00:00.000Z',
    });
    const result = await getSharedBetSlipByShareId('bad');
    expect(result).toEqual({
      ok: false,
      code: 'INVALID_SNAPSHOT',
      message: 'Malformed legs_snapshot',
    });
  });

  it('parseCanonicalBetLeg rejects selectionKey that does not match identity fields', () => {
    const leg = tatumLeg({ selectionKey: 'tampered|key' });
    expect(parseCanonicalBetLeg(leg)).toBeNull();
  });

  it('parseLegsSnapshot accepts a valid frozen array', () => {
    const legs = parseLegsSnapshot([tatumLeg()]);
    expect(legs).toHaveLength(1);
    expect(legs?.[0]?.line).toBe(28.5);
  });
});
