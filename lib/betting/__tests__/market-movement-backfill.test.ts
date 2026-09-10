import { describe, expect, it } from 'vitest';
import {
  GAME_ODDS_CERTIFIED_WINDOW,
  PLAYER_PROP_COMPARISON_KIND,
  PLAYER_PROP_REFERENCE_KIND,
  americanOddsToImpliedProbability,
} from '../market-movement';
import {
  CERTIFIED_PLAYER_V1_ALLOWLIST_MATCHES,
  PREDICTION_MARKETS,
  assertCertifiedWindowDates,
  buildGameOddsServingDataset,
  buildPlayerServingDataset,
  isCanonicalGameArchiveObject,
  parseOpeningOdds,
  parseOpeningProp,
  toGameServingRow,
  type ClosingOddsRow,
  type ClosingProp,
} from '../market-movement-backfill';

const implied110 = americanOddsToImpliedProbability(-110);
const implied120 = americanOddsToImpliedProbability(-120);

function parseV1Points(vendor = 'betmgm') {
  const parsed = parseOpeningProp(
    {
      game_id: 'g1',
      player_id: 'p1',
      player_name: 'Test Player',
      vendor,
      prop_type: 'points',
      line_value: 25.5,
      market: { over_odds: -110, under_odds: -110 },
      opened_at: '2026-04-10T20:00:00.000Z',
    },
    'g1'
  );
  if (!parsed) throw new Error('parse failed');
  return parsed;
}

function closeSides(args?: { line?: number; over?: number; under?: number; vendor?: string }): ClosingProp[] {
  const line = args?.line ?? 25.5;
  const vendor = args?.vendor ?? 'betmgm';
  return [
    {
      gameId: 'g1',
      playerId: 'p1',
      vendor,
      canonical: 'points',
      side: 'over',
      line,
      oddsAmerican: args?.over ?? -110,
      decisionAt: '2026-04-10T22:50:00.000Z',
    },
    {
      gameId: 'g1',
      playerId: 'p1',
      vendor,
      canonical: 'points',
      side: 'under',
      line,
      oddsAmerican: args?.under ?? -110,
      decisionAt: '2026-04-10T22:50:00.000Z',
    },
  ];
}

describe('parseOpeningProp / parseOpeningOdds', () => {
  it('parses nested market odds and PRA alias', () => {
    const row = parseOpeningProp(
      {
        game_id: 'g1',
        player: { id: 'p9', first_name: 'A', last_name: 'B' },
        vendor: 'FanDuel',
        prop_type: 'PRA',
        market: { line: 35.5, over_odds: -115, under_odds: -105 },
        opened_at: '2026-04-01T00:00:00.000Z',
      },
      null
    );
    expect(row?.canonical).toBe('points_rebounds_assists');
    expect(row?.vendor).toBe('fanduel');
    expect(row?.playerName).toBe('A B');
    expect(row?.line).toBe(35.5);
    expect(row?.overOdds).toBe(-115);
  });

  it('classifies prediction markets separately from sportsbooks', () => {
    const pm = parseOpeningOdds({ game_id: 'g1', vendor: 'polymarket', moneyline_home_odds: 120 }, 'g1');
    const sb = parseOpeningOdds(
      {
        game_id: 'g1',
        vendor: 'draftkings',
        spread_home_value: -3.5,
        spread_home_odds: -110,
        total_value: 220.5,
        total_over_odds: -108,
        moneyline_home_odds: -150,
        moneyline_away_odds: 130,
        opened_at: '2026-03-10T00:00:00.000Z',
      },
      'g1'
    );
    expect(pm?.class).toBe('prediction-market');
    expect(PREDICTION_MARKETS.has('kalshi')).toBe(true);
    expect(sb?.class).toBe('sportsbook');
    expect(sb?.homeSpread).toBe(-3.5);
    expect(sb?.overOdds).toBe(-108);
  });
});

describe('buildPlayerServingDataset', () => {
  it('maps opening + close to a certified serving row', () => {
    const { servingRows } = buildPlayerServingDataset({
      openingProps: [parseV1Points()],
      closingProps: closeSides({ line: 26.5, over: -120 }),
    });
    expect(servingRows).toHaveLength(1);
    const row = servingRows[0]!;
    expect(row.reference_kind).toBe(PLAYER_PROP_REFERENCE_KIND);
    expect(row.comparison_kind).toBe(PLAYER_PROP_COMPARISON_KIND);
    expect(row.reference_line).toBe(25.5);
    expect(row.comparison_line).toBe(26.5);
    expect(row.line_delta).toBe(1);
    expect(row.movement_class).toBe('D');
    expect(row.over_implied_probability_delta).toBeCloseTo((implied120 ?? 0) - (implied110 ?? 0), 10);
    expect(row.reference_timestamp).toBe('2026-04-10T20:00:00.000Z');
    expect(row.comparison_timestamp).toBe('2026-04-10T22:50:00.000Z');
  });

  it('classifies Quiet / Juice / Line / Line+Price from the shared taxonomy', () => {
    const quiet = buildPlayerServingDataset({
      openingProps: [parseV1Points()],
      closingProps: closeSides({ over: -105, under: -105 }),
    }).servingRows[0]!;
    expect(quiet.movement_class).toBe('A');

    const juice = buildPlayerServingDataset({
      openingProps: [parseV1Points()],
      closingProps: closeSides({ over: -120 }),
    }).servingRows[0]!;
    expect(juice.movement_class).toBe('B');

    const line = buildPlayerServingDataset({
      openingProps: [parseV1Points()],
      closingProps: closeSides({ line: 26.5, over: -105, under: -105 }),
    }).servingRows[0]!;
    expect(line.movement_class).toBe('C');
  });

  it('excludes unsupported vendors', () => {
    const parsed = parseV1Points('betrivers');
    const { servingRows, counts } = buildPlayerServingDataset({
      openingProps: [parsed],
      closingProps: closeSides({ vendor: 'betrivers' }),
    });
    expect(servingRows).toHaveLength(0);
    expect(counts.productGradeMatched).toBe(0);
  });

  it('excludes unsupported props even when the matcher knows them', () => {
    const parsed = parseOpeningProp(
      {
        game_id: 'g1',
        player_id: 'p1',
        vendor: 'betmgm',
        prop_type: 'blocks',
        line_value: 1.5,
        over_odds: -110,
        under_odds: -110,
        opened_at: '2026-04-10T20:00:00.000Z',
      },
      'g1'
    )!;
    const { servingRows, counts } = buildPlayerServingDataset({
      openingProps: [parsed],
      closingProps: [
        {
          gameId: 'g1',
          playerId: 'p1',
          vendor: 'betmgm',
          canonical: 'blocks',
          side: 'over',
          line: 1.5,
          oddsAmerican: -110,
          decisionAt: '2026-04-10T22:50:00.000Z',
        },
      ],
    });
    expect(parsed.canonical).toBe('blocks');
    expect(counts.productGradeMatched).toBe(1);
    expect(servingRows).toHaveLength(0);
  });

  it('excludes the entire ambiguous simultaneous-line group', () => {
    const a = parseOpeningProp(
      {
        game_id: 'g1',
        player_id: 'p1',
        vendor: 'betrivers',
        prop_type: 'points',
        line_value: 24.5,
        over_odds: -110,
      },
      'g1'
    )!;
    const b = parseOpeningProp(
      {
        game_id: 'g1',
        player_id: 'p1',
        vendor: 'betrivers',
        prop_type: 'points',
        line_value: 25.5,
        over_odds: -110,
      },
      'g1'
    )!;
    const { servingRows, counts } = buildPlayerServingDataset({
      openingProps: [a, b],
      closingProps: closeSides({ vendor: 'betrivers' }),
    });
    expect(counts.ambiguousGroups).toBe(1);
    expect(counts.ambiguousRows).toBe(2);
    expect(servingRows).toHaveLength(0);
  });

  it('does not insert unmatched opening rows (missing comparison)', () => {
    const { servingRows, unmatchedV1 } = buildPlayerServingDataset({
      openingProps: [parseV1Points()],
      closingProps: [],
    });
    expect(servingRows).toHaveLength(0);
    expect(unmatchedV1).toHaveLength(1);
  });

  it('is idempotent: a second build yields the same serving rows', () => {
    const openingProps = [parseV1Points('betmgm'), parseV1Points('fanduel')];
    const closingProps = [...closeSides({ vendor: 'betmgm' }), ...closeSides({ vendor: 'fanduel', line: 26.5 })];
    const a = buildPlayerServingDataset({ openingProps, closingProps }).servingRows;
    const b = buildPlayerServingDataset({ openingProps, closingProps }).servingRows;
    expect(a).toEqual(b);
    expect(a).toHaveLength(2);
  });

  it('documents the v1 allowlist vs 7E product-grade 24412 universe', () => {
    expect(CERTIFIED_PLAYER_V1_ALLOWLIST_MATCHES).toBe(21132);
    expect(24412 - 1248 - 365 - 1667).toBe(21132);
  });
});

describe('buildGameOddsServingDataset', () => {
  const openDk = parseOpeningOdds(
    {
      game_id: '18447469',
      vendor: 'draftkings',
      spread_home_value: -3.5,
      spread_home_odds: -110,
      spread_away_value: 3.5,
      total_value: 220.5,
      total_over_odds: -108,
      total_under_odds: -112,
      moneyline_home_odds: -150,
      moneyline_away_odds: 130,
      opened_at: '2026-03-10T00:00:00.000Z',
    },
    '18447469'
  )!;

  const closeDk: ClosingOddsRow = {
    gameId: '18447469',
    vendor: 'draftkings',
    homeSpread: -4.5,
    homeSpreadOdds: -110,
    awaySpread: 4.5,
    awaySpreadOdds: -110,
    total: 222.5,
    overOdds: -105,
    underOdds: -115,
    homeMl: -160,
    awayMl: 140,
    snapshotAt: '2026-03-10T23:50:00.000Z',
  };

  it('matches game_id + vendor and stores implied-probability ML deltas', () => {
    const { servingRows, unmatched } = buildGameOddsServingDataset({
      openingOdds: [openDk],
      closingOdds: [closeDk],
    });
    expect(unmatched).toHaveLength(0);
    expect(servingRows).toHaveLength(1);
    const row = servingRows[0]!;
    expect(row.reference_kind).toBe('opening_snapshot');
    expect(row.comparison_kind).toBe('last_pre_tip_history');
    expect(row.spread_delta).toBe(-1);
    expect(row.total_delta).toBe(2);
    expect(row.home_ml_implied_probability_delta).toBeCloseTo(
      (americanOddsToImpliedProbability(-160) ?? 0) - (americanOddsToImpliedProbability(-150) ?? 0),
      10
    );
    expect(row.certified_window_start).toBe(GAME_ODDS_CERTIFIED_WINDOW.start);
    expect(row.certified_window_end).toBe(GAME_ODDS_CERTIFIED_WINDOW.end);
  });

  it('does not manufacture a comparison for unmatched Rebet', () => {
    const rebet = parseOpeningOdds(
      { game_id: 'g9', vendor: 'rebet', spread_home_value: -2.5, opened_at: '2026-03-11T00:00:00.000Z' },
      'g9'
    )!;
    const { servingRows, unmatched } = buildGameOddsServingDataset({
      openingOdds: [rebet],
      closingOdds: [],
    });
    expect(servingRows).toHaveLength(0);
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0]?.vendor).toBe('rebet');
  });

  it('does not insert prediction-market rows', () => {
    const pm = parseOpeningOdds(
      { game_id: 'g9', vendor: 'kalshi', moneyline_home_odds: 100, opened_at: '2026-03-11T00:00:00.000Z' },
      'g9'
    )!;
    const close: ClosingOddsRow = { ...closeDk, gameId: 'g9', vendor: 'kalshi' };
    const { servingRows, predictionOpen } = buildGameOddsServingDataset({
      openingOdds: [pm],
      closingOdds: [close],
    });
    expect(predictionOpen).toHaveLength(1);
    expect(servingRows).toHaveLength(0);
  });

  it('keeps suspicious outlier rows instead of dropping them', () => {
    const wildOpen = { ...openDk, homeSpread: -20, total: 200 };
    const peer = parseOpeningOdds(
      {
        game_id: '18447469',
        vendor: 'fanduel',
        spread_home_value: -3.5,
        total_value: 220,
        opened_at: '2026-03-10T00:00:00.000Z',
      },
      '18447469'
    )!;
    const { servingRows, outliers } = buildGameOddsServingDataset({
      openingOdds: [wildOpen, peer],
      closingOdds: [closeDk, { ...closeDk, vendor: 'fanduel', homeSpread: -3.5, total: 221 }],
    });
    const dk = servingRows.find((r) => r.vendor === 'draftkings');
    expect(dk).toBeTruthy();
    expect(outliers.some((o) => o.vendor === 'draftkings')).toBe(true);
    expect(dk?.outlier_class).not.toBeNull();
  });

  it('rejects window dates that are not the certified Opening Snapshot window', () => {
    expect(() => assertCertifiedWindowDates('2026-03-09', '2026-03-23')).toThrow(/outside certified/);
  });

  it('does not target characterization prefixes or non-game objects', () => {
    expect(
      isCanonicalGameArchiveObject(
        'raw/source=balldontlie/league=nba/season=2025/entity=opening_game_odds/window=2026-03-09_to_2026-03-22/game_id=1.json'
      )
    ).toBe(true);
    expect(
      isCanonicalGameArchiveObject(
        'raw/source=balldontlie/league=nba/season=2025/entity=opening_game_odds/_characterization_march_cutoff.json'
      )
    ).toBe(false);
  });
});

describe('toGameServingRow window lock', () => {
  it('always stamps the certified window constants', () => {
    const open = parseOpeningOdds({ game_id: '1', vendor: 'caesars', spread_home_value: -1 }, '1')!;
    const close: ClosingOddsRow = {
      gameId: '1',
      vendor: 'caesars',
      homeSpread: -1,
      homeSpreadOdds: null,
      awaySpread: null,
      awaySpreadOdds: null,
      total: null,
      overOdds: null,
      underOdds: null,
      homeMl: null,
      awayMl: null,
      snapshotAt: '2026-03-10T00:00:00.000Z',
    };
    const row = toGameServingRow(open, close, null);
    expect(row.certified_window_start).toBe('2026-03-09');
    expect(row.certified_window_end).toBe('2026-03-22');
  });
});
