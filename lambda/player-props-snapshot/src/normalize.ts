import type { BdlPlayerPropRow, NormalizedPropRow } from './types';

/** BDL returns mixed-case vendor names; normalize so preferred-vendor filters and UI queries stay stable. */
function normalizeSportsbook(vendor: string): string {
  return vendor.trim().toLowerCase();
}

function parseNumeric(val: string | null | undefined): number | null {
  if (val == null || val === '') return null;
  const n = Number.parseFloat(val);
  return Number.isNaN(n) ? null : n;
}

function americanToDecimal(oddsAmerican: number): number {
  if (oddsAmerican < 0) return 1 + 100 / Math.abs(oddsAmerican);
  return 1 + oddsAmerican / 100;
}

function impliedProbability(oddsAmerican: number): number {
  if (oddsAmerican < 0) return Math.abs(oddsAmerican) / (Math.abs(oddsAmerican) + 100);
  return 100 / (oddsAmerican + 100);
}

export function normalizePlayerPropRows(rows: BdlPlayerPropRow[]): NormalizedPropRow[] {
  const out: NormalizedPropRow[] = [];
  for (const row of rows) {
    const line = parseNumeric(row.line_value);
    const providerUpdatedAt = row.updated_at ? new Date(row.updated_at) : null;
    if (row.market.type === 'over_under') {
      out.push({
        game_id: row.game_id,
        player_id: row.player_id,
        player_name: null,
        team_id: null,
        sportsbook: normalizeSportsbook(row.vendor),
        prop_type: row.prop_type,
        market_type: 'over_under',
        side: 'over',
        line_value: line,
        odds_american: row.market.over_odds,
        odds_decimal: americanToDecimal(row.market.over_odds),
        implied_probability: impliedProbability(row.market.over_odds),
        raw_json: row,
        provider_updated_at: providerUpdatedAt,
      });
      out.push({
        game_id: row.game_id,
        player_id: row.player_id,
        player_name: null,
        team_id: null,
        sportsbook: normalizeSportsbook(row.vendor),
        prop_type: row.prop_type,
        market_type: 'over_under',
        side: 'under',
        line_value: line,
        odds_american: row.market.under_odds,
        odds_decimal: americanToDecimal(row.market.under_odds),
        implied_probability: impliedProbability(row.market.under_odds),
        raw_json: row,
        provider_updated_at: providerUpdatedAt,
      });
    } else {
      out.push({
        game_id: row.game_id,
        player_id: row.player_id,
        player_name: null,
        team_id: null,
        sportsbook: normalizeSportsbook(row.vendor),
        prop_type: row.prop_type,
        market_type: 'milestone',
        side: 'milestone',
        line_value: line,
        odds_american: row.market.odds,
        odds_decimal: americanToDecimal(row.market.odds),
        implied_probability: impliedProbability(row.market.odds),
        raw_json: row,
        provider_updated_at: providerUpdatedAt,
      });
    }
  }
  return out;
}
