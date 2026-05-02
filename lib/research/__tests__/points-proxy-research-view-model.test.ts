import { describe, expect, it } from 'vitest';
import {
  buildPointsProxyLabViewModel,
  buildPlayerConcentrationRows,
  mapPlayerFrequencyFromJson,
  parseBreakdownResultsJson,
  parseComparisonResultsJson,
  playerConcentrationDisplayFields,
} from '@/lib/research/points-proxy-research-view-model';
import { parsePlayerIdDisplayNameLookupJson } from '@/lib/research/player-id-display-name-lookup';
import type { StrategyBreakdownBundle } from '@/lib/research/proxy-strategy-breakdowns';
import type { ComparedStrategy } from '@/lib/research/proxy-strategy-comparison';

const strongBundle: StrategyBreakdownBundle = {
  strategy_name: 'strong_recent_role_change_v1',
  total_signals: 100,
  overall_hit_rate: 0.66,
  by_season: [],
  by_prior_games: [],
  by_minutes_l5: [],
  by_points_season_avg: [],
  player_frequency: [
    { player_id: 'p1', signal_count: 10, hit_count: 7, hit_rate: 0.7 },
    { player_id: 'p2', signal_count: 5, hit_count: 2, hit_rate: 0.4 },
  ],
  player_hit_leaderboard: [],
  best_worst_by_dimension: {},
  concentration: {
    unique_players_with_signals: 20,
    total_signals: 100,
    top_k_signal_share: 0.07,
    k_used: 10,
  },
};

const comparedRow: ComparedStrategy = {
  strategy_name: 'strong_recent_role_change_v1',
  seasons_included: [2023, 2024, 2025],
  total_signal_count: 6226,
  weighted_hit_rate: 0.666,
  simple_avg_hit_rate: 0.66,
  min_hit_rate: 0.64,
  max_hit_rate: 0.67,
  hit_rate_range: 0.03,
  avg_signal_count_per_season: 2000,
  min_signal_count: 1800,
  max_signal_count: 2100,
  weighted_avg_points_over_baseline: 3.5,
  best_season: 2025,
  worst_season: 2023,
  rank: 1,
};

describe('points-proxy-research-view-model', () => {
  it('parses comparison JSON shape', () => {
    const raw = {
      seasons: [2023, 2024, 2025],
      missing_seasons: [],
      target_definition: 'actual_points > points_season_avg_before_game',
      generated_at: 't',
      strategy_summary: [comparedRow],
    };
    const p = parseComparisonResultsJson(raw);
    expect(p?.strategy_summary).toHaveLength(1);
    expect(p?.strategy_summary[0].weighted_hit_rate).toBe(0.666);
  });

  it('returns null for invalid comparison JSON', () => {
    expect(parseComparisonResultsJson(null)).toBeNull();
    expect(parseComparisonResultsJson({})).toBeNull();
  });

  it('parses breakdown JSON shape', () => {
    const raw = {
      seasons: [2023, 2024, 2025],
      strategies: ['strong_recent_role_change_v1'],
      target_definition: 'actual_points > points_season_avg_before_game',
      generated_at: 't',
      total_rows_loaded: 1000,
      strategies_breakdown: [strongBundle],
      narratives: [
        {
          strategy_name: 'strong_recent_role_change_v1',
          label: 'broad' as const,
          reasons: ['Signals spread across many players with moderate top-K share.'],
        },
      ],
    };
    const p = parseBreakdownResultsJson(raw);
    expect(p?.strategies_breakdown).toHaveLength(1);
    expect(p?.narratives[0].label).toBe('broad');
  });

  it('merges leaderboard and marks strong_recent_role_change_v1 as broad', () => {
    const vm = buildPointsProxyLabViewModel({
      seasonsTag: '2023-2024-2025',
      comparison: parseComparisonResultsJson({
        seasons: [2023, 2024, 2025],
        missing_seasons: [],
        target_definition: 'actual_points > points_season_avg_before_game',
        generated_at: 't',
        strategy_summary: [comparedRow],
      }),
      breakdown: parseBreakdownResultsJson({
        seasons: [2023, 2024, 2025],
        strategies: ['strong_recent_role_change_v1'],
        target_definition: 'actual_points > points_season_avg_before_game',
        generated_at: 't',
        total_rows_loaded: 1000,
        strategies_breakdown: [strongBundle],
        narratives: [
          {
            strategy_name: 'strong_recent_role_change_v1',
            label: 'broad',
            reasons: ['Signals spread across many players with moderate top-K share.'],
          },
        ],
      }),
    });
    const row = vm.leaderboard.find((r) => r.strategy_name === 'strong_recent_role_change_v1');
    expect(row?.narrative_label).toBe('broad');
    expect(row?.top10_player_signal_share).toBeCloseTo(0.07, 5);
    expect(row?.unique_players).toBe(20);
    expect(vm.player_display_name_enrichment.s3_lookup_keys_tried).toEqual([]);
    expect(vm.player_display_name_enrichment.s3_lookup_files_found).toBe(0);
    expect(vm.player_display_name_enrichment.s3_lookup_entry_count).toBe(0);
    expect(vm.player_display_name_enrichment.bdl_filled_count).toBe(0);
  });

  it('handles missing breakdown with warnings and no breakdown label', () => {
    const vm = buildPointsProxyLabViewModel({
      seasonsTag: '2023-2024-2025',
      comparison: parseComparisonResultsJson({
        seasons: [2023, 2024, 2025],
        missing_seasons: [],
        target_definition: 't',
        generated_at: 't',
        strategy_summary: [comparedRow],
      }),
      breakdown: null,
    });
    expect(vm.data_quality_warnings.some((w) => w.includes('breakdown'))).toBe(true);
    expect(vm.leaderboard[0].narrative_label).toBe('no breakdown');
    expect(vm.leaderboard[0].top10_player_signal_share).toBeNull();
  });

  it('handles empty comparison summary', () => {
    const vm = buildPointsProxyLabViewModel({
      seasonsTag: '2023-2024-2025',
      comparison: parseComparisonResultsJson({
        seasons: [],
        missing_seasons: [],
        target_definition: 't',
        generated_at: 't',
        strategy_summary: [],
      }),
      breakdown: null,
    });
    expect(vm.leaderboard).toHaveLength(0);
    expect(vm.strategies).toHaveLength(0);
  });

  it('buildPlayerConcentrationRows computes share of strategy signals', () => {
    const rows = buildPlayerConcentrationRows(strongBundle, 10);
    expect(rows[0].player_id).toBe('p1');
    expect(rows[0].share_of_strategy_signals).toBe(0.1);
    expect(rows[0].player_name).toBeNull();
    expect(rows[0].hit_count).toBe(7);
  });

  it('mapPlayerFrequencyFromJson preserves player_name when present', () => {
    const pf = mapPlayerFrequencyFromJson([
      { player_id: '99', signal_count: 3, hit_count: 2, hit_rate: 2 / 3, player_name: '  Test Player  ' },
    ]);
    expect(pf[0].player_name).toBe('Test Player');
    expect(pf[0].player_id).toBe('99');
  });

  it('buildPlayerConcentrationRows prefers breakdown player_name over lookup map', () => {
    const bundle: StrategyBreakdownBundle = {
      ...strongBundle,
      player_frequency: [
        { player_id: 'p1', signal_count: 10, hit_count: 7, hit_rate: 0.7, player_name: 'From Breakdown' },
        { player_id: 'p2', signal_count: 5, hit_count: 2, hit_rate: 0.4 },
      ],
    };
    const lookup = new Map<string, string>([
      ['p1', 'From Lookup'],
      ['p2', 'Player Two'],
    ]);
    const rows = buildPlayerConcentrationRows(bundle, 10, lookup);
    expect(rows[0].player_name).toBe('From Breakdown');
    expect(rows[1].player_name).toBe('Player Two');
  });

  it('buildPlayerConcentrationRows uses lookup when breakdown omits player_name', () => {
    const lookup = new Map<string, string>([
      ['p1', 'Alpha'],
      ['p2', 'Beta'],
    ]);
    const rows = buildPlayerConcentrationRows(strongBundle, 10, lookup);
    expect(rows[0].player_name).toBe('Alpha');
    expect(rows[1].player_name).toBe('Beta');
  });

  it('buildPlayerConcentrationRows resolves name when lookup JSON used zero-padded digit keys', () => {
    const lookup = parsePlayerIdDisplayNameLookupJson({ by_player_id: { '000123': 'From Padded Key' } });
    const bundle: StrategyBreakdownBundle = {
      ...strongBundle,
      total_signals: 10,
      player_frequency: [{ player_id: '123', signal_count: 10, hit_count: 7, hit_rate: 0.7 }],
    };
    const rows = buildPlayerConcentrationRows(bundle, 10, lookup);
    expect(rows[0].player_id).toBe('123');
    expect(rows[0].player_name).toBe('From Padded Key');
  });

  it('parseBreakdownResultsJson normalizes player_frequency player_name into bundles', () => {
    const raw = {
      seasons: [2023],
      strategies: ['strong_recent_role_change_v1'],
      target_definition: 't',
      generated_at: 't',
      total_rows_loaded: 1,
      strategies_breakdown: [
        {
          ...strongBundle,
          player_frequency: [
            { player_id: 'p1', signal_count: 10, hit_count: 7, hit_rate: 0.7, player_name: 'Gamma' },
            { player_id: 'p2', signal_count: 5, hit_count: 2, hit_rate: 0.4 },
          ],
        },
      ],
      narratives: [],
    };
    const p = parseBreakdownResultsJson(raw);
    const b = p?.strategies_breakdown[0];
    expect(b?.player_frequency[0].player_name).toBe('Gamma');
  });

  it('playerConcentrationDisplayFields keeps name separate from id', () => {
    expect(playerConcentrationDisplayFields({ player_id: '123', player_name: 'Ann User' })).toEqual({
      resolvedName: 'Ann User',
      canonicalPlayerId: '123',
    });
  });

  it('playerConcentrationDisplayFields does not put player_id into resolvedName when name missing', () => {
    expect(playerConcentrationDisplayFields({ player_id: '335', player_name: null })).toEqual({
      resolvedName: null,
      canonicalPlayerId: '335',
    });
  });
});
