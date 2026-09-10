import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

import { query, queryOne } from '@/lib/db';
import {
  CONSENSUS_MEDIAN_DISCLAIMER,
  PLAYER_PROP_CONSENSUS_MIN_BOOKS,
} from '../market-movement';
import {
  GAME_ODDS_MARKET_MOVEMENT_TABLE,
  PLAYER_PROP_MARKET_MOVEMENT_TABLE,
  gameOddsMarketMovementSql,
  getGameOddsMarketMovementMeta,
  getPlayerMarketMovement,
  mapServingRowsToPlayerMarketMovement,
  playerMarketMovementSql,
  summarizePlayerMarketMovementForFree,
} from '../market-movement-server';

const mockQuery = query as ReturnType<typeof vi.fn>;
const mockQueryOne = queryOne as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

function servingRow(partial: Record<string, unknown>) {
  return {
    game_id: 'g1',
    player_id: 'p1',
    player_name: 'Test Player',
    prop_type: 'points',
    vendor: 'betmgm',
    reference_kind: '3_hour_pre_tip',
    reference_line: 25.5,
    reference_over_odds: -110,
    reference_under_odds: -110,
    reference_timestamp: '2026-04-10T20:00:00.000Z',
    comparison_kind: 'decision_close',
    comparison_line: 25.5,
    comparison_over_odds: -110,
    comparison_under_odds: -110,
    comparison_timestamp: '2026-04-10T22:50:00.000Z',
    line_delta: 0,
    over_implied_probability_delta: 0,
    under_implied_probability_delta: 0,
    movement_class: 'A',
    ...partial,
  };
}

describe('certified SQL source', () => {
  it('reads analytics.player_prop_market_movement and not legacy summary/history', () => {
    const sql = playerMarketMovementSql();
    expect(sql).toMatch(/analytics\.player_prop_market_movement/);
    expect(sql).toMatch(/LEFT JOIN analytics\.players/);
    expect(sql).not.toMatch(/player_prop_movement_summary/);
    expect(sql).not.toMatch(/player_prop_lines/);
    expect(sql).not.toMatch(/player_prop_history/);
  });

  it('game helper reads analytics.game_odds_market_movement', () => {
    const sql = gameOddsMarketMovementSql();
    expect(sql).toMatch(/analytics\.game_odds_market_movement/);
    expect(sql).not.toMatch(/game_line_movement_summary/);
  });
});

describe('mapServingRowsToPlayerMarketMovement', () => {
  it('returns empty state without fabricating zeros', () => {
    const out = mapServingRowsToPlayerMarketMovement({
      gameId: 'g1',
      playerId: 'p1',
      propType: 'points',
      rows: [],
      playerNameFallback: 'Fallback Name',
    });
    expect(out.status).toBe('empty');
    expect(out.reason).toBe('no_certified_historical_snapshot');
    expect(out.sourceTable).toBe(PLAYER_PROP_MARKET_MOVEMENT_TABLE);
    expect(out.books).toEqual([]);
    expect(out.consensus.comparison.median).toBeNull();
    expect(out.consensus.comparison.bookCount).toBe(0);
    expect(out.market.player.name).toBe('Fallback Name');
    expect(out.coverage.liveCurrent).toBe(false);
    expect(out.reference.label).toBe('3-Hour Pre-Tip');
    expect(out.comparison.label).toBe('Close');
  });

  it('maps a 1-book market with consensus unavailable', () => {
    const out = mapServingRowsToPlayerMarketMovement({
      gameId: 'g1',
      playerId: 'p1',
      propType: 'points',
      rows: [servingRow({ vendor: 'draftkings', movement_class: 'B' })],
    });
    expect(out.status).toBe('ok');
    expect(out.books).toHaveLength(1);
    expect(out.books[0]?.movement.class).toBe('Juice');
    expect(out.books[0]?.movement.classCode).toBe('B');
    expect(out.consensus.comparison.available).toBe(false);
    expect(out.consensus.comparison.bookCount).toBe(1);
    expect(out.coverage.consensusMinimumBooks).toBe(PLAYER_PROP_CONSENSUS_MIN_BOOKS);
    expect(out.market.player.name).toBe('Test Player');
  });

  it('computes interpolating median for a 2-book split without claiming an offered line', () => {
    const out = mapServingRowsToPlayerMarketMovement({
      gameId: 'g1',
      playerId: 'p1',
      propType: 'points',
      rows: [
        servingRow({ vendor: 'betmgm', comparison_line: 25.5, reference_line: 25.5 }),
        servingRow({ vendor: 'fanduel', comparison_line: 26.5, reference_line: 26.5 }),
      ],
    });
    expect(out.consensus.comparison.available).toBe(true);
    expect(out.consensus.comparison.median).toBe(26);
    expect(out.consensus.comparison.min).toBe(25.5);
    expect(out.consensus.comparison.max).toBe(26.5);
    expect(out.consensus.comparison.bookCount).toBe(2);
    expect(out.consensus.isStatisticalMedianNotAnOfferedLine).toBe(true);
    expect(out.consensus.note).toBe(CONSENSUS_MEDIAN_DISCLAIMER);
    expect(out.books.map((b) => b.vendor)).toEqual(['betmgm', 'fanduel']);
    expect(out.books.some((b) => b.comparison.line === 26)).toBe(false);
  });

  it('returns a 4-book result with Quiet/Juice/Line/Line+Price labels from serving class codes', () => {
    const out = mapServingRowsToPlayerMarketMovement({
      gameId: 'g1',
      playerId: 'p1',
      propType: 'points_rebounds_assists',
      rows: [
        servingRow({ vendor: 'caesars', movement_class: 'A', prop_type: 'points_rebounds_assists' }),
        servingRow({ vendor: 'betmgm', movement_class: 'B', prop_type: 'points_rebounds_assists' }),
        servingRow({ vendor: 'fanduel', movement_class: 'C', prop_type: 'points_rebounds_assists' }),
        servingRow({
          vendor: 'draftkings',
          movement_class: 'D',
          prop_type: 'points_rebounds_assists',
          comparison_line: 36.5,
          line_delta: 1,
        }),
      ],
    });
    expect(out.books).toHaveLength(4);
    expect(out.market.propType).toBe('points_rebounds_assists');
    expect(out.market.displayLabel).toBe('PRA');
    expect(out.books.map((b) => [b.vendor, b.movement.class])).toEqual([
      ['betmgm', 'Juice'],
      ['fanduel', 'Line'],
      ['draftkings', 'Line+Price'],
      ['caesars', 'Quiet'],
    ]);
    expect(out.coverage.booksWithMeaningfulMovement).toBe(3);
    expect(out.consensus.comparison.bookCount).toBe(4);
  });

  it('preserves null odds and does not coerce missing comparison fields to 0', () => {
    const out = mapServingRowsToPlayerMarketMovement({
      gameId: 'g1',
      playerId: 'p1',
      propType: 'rebounds',
      rows: [
        servingRow({
          vendor: 'betmgm',
          reference_over_odds: null,
          comparison_under_odds: null,
          over_implied_probability_delta: null,
          comparison_line: null,
          line_delta: null,
          movement_class: 'unclassified',
        }),
      ],
    });
    expect(out.books[0]?.reference.overOdds).toBeNull();
    expect(out.books[0]?.comparison.underOdds).toBeNull();
    expect(out.books[0]?.comparison.line).toBeNull();
    expect(out.books[0]?.movement.lineDelta).toBeNull();
    expect(out.books[0]?.movement.class).toBe('Unclassified');
    expect(out.consensus.comparison.available).toBe(false);
  });

  it('drops unsupported books instead of treating them as v1 Market Movement', () => {
    const out = mapServingRowsToPlayerMarketMovement({
      gameId: 'g1',
      playerId: 'p1',
      propType: 'points',
      rows: [
        servingRow({ vendor: 'betmgm', comparison_line: 25.5 }),
        servingRow({ vendor: 'betrivers', comparison_line: 99.5 }),
      ],
    });
    expect(out.books.map((b) => b.vendor)).toEqual(['betmgm']);
    expect(out.consensus.comparison.available).toBe(false);
    expect(out.books.some((b) => (b.vendor as string) === 'betrivers')).toBe(false);
  });

  it('returns both reference and comparison consensus without a market sentiment score', () => {
    const out = mapServingRowsToPlayerMarketMovement({
      gameId: 'g1',
      playerId: 'p1',
      propType: 'threes',
      rows: [
        servingRow({
          vendor: 'betmgm',
          reference_line: 2.5,
          comparison_line: 3.5,
          over_implied_probability_delta: 0.024,
        }),
        servingRow({
          vendor: 'draftkings',
          reference_line: 2.5,
          comparison_line: 3.5,
        }),
      ],
    });
    expect(out.market.displayLabel).toBe('3-Pointers');
    expect(out.consensus.reference.median).toBe(2.5);
    expect(out.consensus.comparison.median).toBe(3.5);
    expect(out.consensus.lineDelta).toBe(1);
    expect(out.books[0]?.movement.overImpliedProbabilityDelta).toBe(0.024);
    expect(out.reference.kind).toBe('3_hour_pre_tip');
    expect(out.comparison.kind).toBe('decision_close');
    expect(out).not.toHaveProperty('sentiment');
  });
});

describe('getPlayerMarketMovement', () => {
  it('looks up the exact market and joins player display name', async () => {
    mockQuery.mockResolvedValueOnce([
      servingRow({ vendor: 'betmgm' }),
      servingRow({ vendor: 'fanduel' }),
    ]);
    const out = await getPlayerMarketMovement({
      gameId: 'g1',
      playerId: 'p1',
      propType: 'points',
    });
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const sql = String(mockQuery.mock.calls[0]?.[0]);
    const params = mockQuery.mock.calls[0]?.[1] as unknown[];
    expect(sql).toMatch(/analytics\.player_prop_market_movement/);
    expect(sql).not.toMatch(/player_prop_movement_summary/);
    expect(params?.[0]).toBe('g1');
    expect(params?.[1]).toBe('p1');
    expect(params?.[2]).toBe('points');
    expect(params?.[3]).toEqual(['betmgm', 'fanduel', 'draftkings', 'caesars']);
    expect(out.books).toHaveLength(2);
    expect(out.market.player.name).toBe('Test Player');
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('canonicalizes PRA and returns the stored prop type with a display label', async () => {
    mockQuery.mockResolvedValueOnce([
      servingRow({ vendor: 'betmgm', prop_type: 'points_rebounds_assists' }),
    ]);
    const out = await getPlayerMarketMovement({
      gameId: 'g1',
      playerId: 'p1',
      propType: 'PRA',
    });
    expect(mockQuery.mock.calls[0]?.[1]?.[2]).toBe('points_rebounds_assists');
    expect(out.market.propType).toBe('points_rebounds_assists');
    expect(out.market.displayLabel).toBe('PRA');
  });

  it('does not query serving rows for an unsupported prop', async () => {
    const out = await getPlayerMarketMovement({
      gameId: 'g1',
      playerId: 'p1',
      propType: 'blocks',
    });
    expect(mockQuery).not.toHaveBeenCalled();
    expect(out.status).toBe('unsupported_prop');
    expect(out.books).toEqual([]);
  });

  it('fetches player name on empty serving result', async () => {
    mockQuery.mockResolvedValueOnce([]);
    mockQueryOne.mockResolvedValueOnce({ full_name: 'Solo Player' });
    const out = await getPlayerMarketMovement({
      gameId: 'g1',
      playerId: 'p1',
      propType: 'assists',
    });
    expect(out.status).toBe('empty');
    expect(out.market.player.name).toBe('Solo Player');
  });
});

describe('summarizePlayerMarketMovementForFree', () => {
  it('keeps close consensus and hides 3-Hour Pre-Tip book rows', () => {
    const full = mapServingRowsToPlayerMarketMovement({
      gameId: 'g1',
      playerId: 'p1',
      propType: 'points',
      rows: [
        servingRow({ vendor: 'betmgm', comparison_line: 25.5, reference_line: 24.5 }),
        servingRow({ vendor: 'fanduel', comparison_line: 26.5, reference_line: 25.5 }),
      ],
    });
    const summary = summarizePlayerMarketMovementForFree(full);
    expect(summary.detail).toBe('summary');
    expect(summary.books).toEqual([]);
    expect(summary.consensus.comparison.median).toBe(26);
    expect(summary.consensus.reference.available).toBe(false);
    expect(summary.reference.timestamp).toBeNull();
    expect(summary.consensus.lineDelta).toBeNull();
  });
});

describe('getGameOddsMarketMovementMeta', () => {
  it('queries the certified game serving table', async () => {
    mockQuery.mockResolvedValueOnce([{ vendor: 'draftkings' }, { vendor: 'fanduel' }]);
    const out = await getGameOddsMarketMovementMeta('18447469');
    expect(out.sourceTable).toBe(GAME_ODDS_MARKET_MOVEMENT_TABLE);
    expect(out.vendorCount).toBe(2);
    expect(out.referenceKind).toBe('opening_snapshot');
    expect(String(mockQuery.mock.calls[0]?.[0])).toMatch(/analytics\.game_odds_market_movement/);
  });
});
