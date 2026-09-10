import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(process.cwd(), 'db/schemas/MIGRATION_market_movement_v1.sql'), 'utf8');

describe('MIGRATION_market_movement_v1.sql contract', () => {
  it('creates the two compact serving tables and no consensus table', () => {
    expect(sql).toMatch(/create table if not exists analytics\.player_prop_market_movement/i);
    expect(sql).toMatch(/create table if not exists analytics\.game_odds_market_movement/i);
    expect(sql).not.toMatch(/create table if not exists analytics\.\w*consensus/i);
    expect(sql).not.toMatch(/alter table analytics\.player_prop_movement_summary/i);
    expect(sql).not.toMatch(/alter table analytics\.game_line_movement_summary/i);
  });

  it('enforces player grain game_id + player_id + prop_type + vendor', () => {
    expect(sql).toMatch(
      /constraint player_prop_market_movement_pk\s+primary key \(game_id, player_id, prop_type, vendor\)/
    );
  });

  it('enforces game grain game_id + vendor', () => {
    expect(sql).toMatch(/constraint game_odds_market_movement_pk\s+primary key \(game_id, vendor\)/);
  });

  it('uses certified kinds and window, not first-seen open', () => {
    expect(sql).toMatch(/3_hour_pre_tip/);
    expect(sql).toMatch(/decision_close/);
    expect(sql).toMatch(/opening_snapshot/);
    expect(sql).toMatch(/last_pre_tip_history/);
    expect(sql).toMatch(/2026-03-09/);
    expect(sql).toMatch(/2026-03-22/);
    expect(sql).not.toMatch(/first_seen/);
  });

  it('stores implied-probability deltas, not American-odds subtraction columns', () => {
    expect(sql).toMatch(/over_implied_probability_delta/);
    expect(sql).toMatch(/home_ml_implied_probability_delta/);
    expect(sql).not.toMatch(/home_ml_delta(?!_implied)/);
    expect(sql).not.toMatch(/american_odds_delta/);
  });

  it('adds only the justified extra player index', () => {
    expect(sql).toMatch(/analytics_player_prop_mm_player_game_idx/);
    expect(sql).toMatch(/\(player_id, game_id\)/);
    expect(sql).not.toMatch(/analytics_game_odds_mm_game_idx/);
    expect(sql).not.toMatch(/analytics_player_prop_mm_game_idx/);
  });

  it('allows null snapshot lines/odds and requires movement_class', () => {
    expect(sql).toMatch(/reference_line numeric,/);
    expect(sql).toMatch(/reference_over_odds integer,/);
    expect(sql).toMatch(/movement_class text not null/);
    expect(sql).toMatch(/check \(movement_class in \('A', 'B', 'C', 'D', 'unclassified'\)\)/);
  });
});
