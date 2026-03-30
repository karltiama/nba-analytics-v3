import { query } from '@/lib/db';
import {
  evaluateOverUnder,
  isOverUnderMarket,
  profitUnitsForSettlement,
  statActualForPropType,
  type PlayerGameOutcomeStats,
} from '@/lib/betting/paper-settlement';

type OpenBetRow = {
  id: string;
  game_id: string;
  player_id: string;
  market_type: string | null;
  prop_type: string | null;
  side: string | null;
  line_value: string | number | null;
  odds_american: number | null;
  stake_units: string | number;
  pts: string | number | null;
  reb: string | number | null;
  ast: string | number | null;
  threes: string | number | null;
  pra: string | number | null;
  pa: string | number | null;
  pr: string | number | null;
  ra: string | number | null;
};

function num(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) ? x : null;
}

export type PaperSettlementResult = {
  ok: true;
  examined: number;
  settled: number;
  skippedNoBoxScore: number;
  errors?: string[];
};

/**
 * Settles open bets whose games are Final and player has box score in research.v_player_game_outcomes.
 */
export async function runPaperSettlement(): Promise<PaperSettlementResult> {
  const rows = await query<OpenBetRow>(
    `SELECT
       b.id,
       b.game_id,
       b.player_id,
       b.market_type,
       b.prop_type,
       b.side,
       b.line_value,
       b.odds_american,
       b.stake_units,
       o.pts,
       o.reb,
       o.ast,
       o.threes,
       o.pra,
       o.pa,
       o.pr,
       o.ra
     FROM paper.bets b
     INNER JOIN analytics.games g ON g.game_id = b.game_id AND g.status = 'Final'
     LEFT JOIN research.v_player_game_outcomes o
       ON o.game_id = b.game_id AND o.player_id = b.player_id
     WHERE b.status = 'open'`
  );

  let settled = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const r of rows) {
    const stake = Number(r.stake_units);
    if (!Number.isFinite(stake) || stake <= 0) continue;

    const hasOutcome =
      r.pts != null ||
      r.reb != null ||
      r.ast != null ||
      r.threes != null ||
      r.pra != null ||
      r.pa != null ||
      r.pr != null ||
      r.ra != null;

    if (!hasOutcome) {
      skipped++;
      continue;
    }

    const stats: PlayerGameOutcomeStats = {
      pts: num(r.pts) ?? 0,
      reb: num(r.reb) ?? 0,
      ast: num(r.ast) ?? 0,
      threes: num(r.threes) ?? 0,
      pra: num(r.pra) ?? 0,
      pa: num(r.pa) ?? 0,
      pr: num(r.pr) ?? 0,
      ra: num(r.ra) ?? 0,
    };

    let result: 'win' | 'loss' | 'push' | 'void';
    let profit: number;

    if (!isOverUnderMarket(r.market_type)) {
      result = 'void';
      profit = profitUnitsForSettlement('void', r.odds_american, stake);
    } else {
      const statActual = statActualForPropType(r.prop_type, stats);
      const line = num(r.line_value);
      const ou = evaluateOverUnder(r.side, line, statActual);

      if (ou === null) {
        result = 'void';
        profit = profitUnitsForSettlement('void', r.odds_american, stake);
      } else {
        result = ou;
        profit = profitUnitsForSettlement(ou, r.odds_american, stake);
      }
    }

    try {
      await query(
        `UPDATE paper.bets
         SET status = 'settled',
             result = $2,
             profit_units = $3,
             settled_at = now()
         WHERE id = $1 AND status = 'open'`,
        [r.id, result, profit]
      );
      settled++;
    } catch (e) {
      errors.push(`${r.id}: ${e instanceof Error ? e.message : 'update failed'}`);
    }
  }

  return {
    ok: true,
    examined: rows.length,
    settled,
    skippedNoBoxScore: skipped,
    ...(errors.length ? { errors } : {}),
  };
}
