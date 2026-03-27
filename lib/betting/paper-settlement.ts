/**
 * Paper bet settlement: American odds profit and prop_type → stat mapping aligned with
 * research.v_prop_eval_units / research.v_player_game_outcomes.
 */

export type PlayerGameOutcomeStats = {
  pts: number;
  reb: number;
  ast: number;
  threes: number;
  pra: number;
  pa: number;
  pr: number;
  ra: number;
};

/** Net profit in units on a winning bet (stake = stakeUnits). */
export function profitUnitsOnWinAmerican(oddsAmerican: number | null, stakeUnits: number): number {
  if (oddsAmerican == null || oddsAmerican === 0 || !Number.isFinite(stakeUnits) || stakeUnits <= 0) return 0;
  if (oddsAmerican < 0) return stakeUnits * (100 / -oddsAmerican);
  return stakeUnits * (oddsAmerican / 100);
}

export function profitUnitsForSettlement(
  result: 'win' | 'loss' | 'push' | 'void',
  oddsAmerican: number | null,
  stakeUnits: number
): number {
  if (result === 'push' || result === 'void') return 0;
  if (result === 'loss') return -stakeUnits;
  return profitUnitsOnWinAmerican(oddsAmerican, stakeUnits);
}

/** Map prop_type to stat value (same cases as research_v_prop_eval_units.sql). */
export function statActualForPropType(propType: string | null, o: PlayerGameOutcomeStats): number | null {
  const k = (propType ?? '').toLowerCase().trim();
  switch (k) {
    case 'points':
    case 'pts':
      return o.pts;
    case 'rebounds':
    case 'reb':
      return o.reb;
    case 'assists':
    case 'ast':
      return o.ast;
    case 'threes':
      return o.threes;
    case 'points_rebounds_assists':
    case 'pra':
      return o.pra;
    case 'points_assists':
    case 'pa':
      return o.pa;
    case 'points_rebounds':
    case 'pr':
      return o.pr;
    case 'rebounds_assists':
    case 'ra':
      return o.ra;
    default:
      return null;
  }
}

export type OverUnderOutcome = 'win' | 'loss' | 'push';

export function evaluateOverUnder(
  side: string | null,
  lineValue: number | null,
  statActual: number | null
): OverUnderOutcome | null {
  if (statActual == null || !Number.isFinite(statActual)) return null;
  if (lineValue == null || !Number.isFinite(lineValue)) return null;
  const s = (side ?? '').toLowerCase();
  if (s !== 'over' && s !== 'under') return null;
  const diff = statActual - lineValue;
  const eps = 1e-9;
  if (Math.abs(diff) <= eps) return 'push';
  if (s === 'over') return diff > 0 ? 'win' : 'loss';
  return diff < 0 ? 'win' : 'loss';
}

export function isOverUnderMarket(marketType: string | null | undefined): boolean {
  return (marketType ?? '').toLowerCase().trim() === 'over_under';
}
