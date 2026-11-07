/**
 * Per-period team scores from a BDL /v1/games row → raw.game_period_scores.
 * Dependency-free so scripts can import it too.
 */

export type PeriodScores = {
  gameId: number;
  season: number;
  homePeriods: number[];
  visitorPeriods: number[];
  periodCount: number;
  overtimeCount: number;
  reconciled: boolean;
};

const QUARTERS = [1, 2, 3, 4] as const;
const OVERTIMES = [1, 2, 3] as const;

function intOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null;
}

function isFinal(status: unknown): boolean {
  return typeof status === 'string' && status.trim().toLowerCase() === 'final';
}

/**
 * Returns null unless the game is Final and all four quarters are present for both teams.
 * Overtime periods are included up to the first missing one on either side.
 */
export function extractPeriodScores(g: any): PeriodScores | null {
  if (!g || !isFinal(g.status)) return null;
  const gameId = intOrNull(g.id);
  const season = intOrNull(g.season);
  if (gameId == null || season == null) return null;

  const home: number[] = [];
  const visitor: number[] = [];
  for (const q of QUARTERS) {
    const h = intOrNull(g[`home_q${q}`]);
    const v = intOrNull(g[`visitor_q${q}`]);
    if (h == null || v == null) return null;
    home.push(h);
    visitor.push(v);
  }
  let overtimeCount = 0;
  for (const ot of OVERTIMES) {
    const h = intOrNull(g[`home_ot${ot}`]);
    const v = intOrNull(g[`visitor_ot${ot}`]);
    if (h == null || v == null) break;
    home.push(h);
    visitor.push(v);
    overtimeCount++;
  }

  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const homeFinal = intOrNull(g.home_team_score);
  const visitorFinal = intOrNull(g.visitor_team_score);
  const reconciled =
    homeFinal != null && visitorFinal != null && sum(home) === homeFinal && sum(visitor) === visitorFinal;

  return {
    gameId,
    season,
    homePeriods: home,
    visitorPeriods: visitor,
    periodCount: home.length,
    overtimeCount,
    reconciled,
  };
}

export const upsertGamePeriodScoresSql = `
  insert into raw.game_period_scores (game_id, season, home_periods, visitor_periods, period_count, overtime_count, reconciled)
  values ($1, $2, $3::int[], $4::int[], $5, $6, $7)
  on conflict (game_id) do update set
    season = excluded.season,
    home_periods = excluded.home_periods,
    visitor_periods = excluded.visitor_periods,
    period_count = excluded.period_count,
    overtime_count = excluded.overtime_count,
    reconciled = excluded.reconciled,
    updated_at = now();
`;

export function periodScoresParams(p: PeriodScores): unknown[] {
  return [p.gameId, p.season, p.homePeriods, p.visitorPeriods, p.periodCount, p.overtimeCount, p.reconciled];
}
