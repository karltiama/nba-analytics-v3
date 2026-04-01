/**
 * Comprehensive backtest of Track B (odds-aware anchor) model.
 * Runs point-in-time reconstruction on historical props and evaluates:
 *   - Overall ROI, hit rate, Brier score
 *   - Breakdown by prop type
 *   - Breakdown by EV bucket
 *   - Breakdown by confidence tier
 *   - Breakdown by side (over/under)
 */
import { query } from '../lib/db';
import { computePropEvFields, type PropEvRowInput } from '../lib/betting/player-prop-ev-row';
import { type GameLog } from '../lib/players/types';
import {
  buildStabilitySignals,
  neutralStabilitySignals,
  type PropStatSeriesKey,
} from '../lib/betting/track-b1-policy';
import { type PlayerPropModelInputs, type ModelInputStats } from '../lib/betting/player-prop-inputs';

import * as dotenv from 'dotenv';
import * as fs from 'fs';
dotenv.config();

const SAMPLE_SIZE = 5000;

interface EvalUnit {
  game_id: number;
  player_id: number;
  player_name: string;
  game_date: string;
  sportsbook: string;
  prop_type: string;
  side: string;
  line_value: number;
  decision_at: string;
  odds_american: number;
  odds_decimal: number;
  implied_probability: number;
  game_start_time: string;
  stat_actual: number | null;
  bet_won: boolean | null;
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = avg(values);
  const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (values.length - 1);
  return Math.sqrt(Math.max(variance, 0));
}

function rebuildInputs(games: GameLog[], gameDateStr: string): PlayerPropModelInputs {
  const priorGames = games
    .filter((g) => new Date(g.game_date) < new Date(gameDateStr))
    .sort((a, b) => new Date(b.game_date).getTime() - new Date(a.game_date).getTime());

  const toStats = (gameList: GameLog[]): ModelInputStats => ({
    pts: avg(gameList.map(g => g.points ?? 0)),
    reb: avg(gameList.map(g => g.rebounds ?? 0)),
    ast: avg(gameList.map(g => g.assists ?? 0)),
    threes: avg(gameList.map(g => g.three_pointers_made ?? 0)),
    pra: avg(gameList.map(g => (g.points ?? 0) + (g.rebounds ?? 0) + (g.assists ?? 0))),
    pa: avg(gameList.map(g => (g.points ?? 0) + (g.assists ?? 0))),
    pr: avg(gameList.map(g => (g.points ?? 0) + (g.rebounds ?? 0))),
    ra: avg(gameList.map(g => (g.rebounds ?? 0) + (g.assists ?? 0)))
  });

  const getStd = (gameList: GameLog[]): ModelInputStats => ({
    pts: stddev(gameList.map(g => g.points ?? 0)),
    reb: stddev(gameList.map(g => g.rebounds ?? 0)),
    ast: stddev(gameList.map(g => g.assists ?? 0)),
    threes: stddev(gameList.map(g => g.three_pointers_made ?? 0)),
    pra: stddev(gameList.map(g => (g.points ?? 0) + (g.rebounds ?? 0) + (g.assists ?? 0))),
    pa: stddev(gameList.map(g => (g.points ?? 0) + (g.assists ?? 0))),
    pr: stddev(gameList.map(g => (g.points ?? 0) + (g.rebounds ?? 0))),
    ra: stddev(gameList.map(g => (g.rebounds ?? 0) + (g.assists ?? 0)))
  });

  const last10Games = priorGames.slice(0, 10);
  const last5Games = priorGames.slice(0, 5);
  const last10 = toStats(last10Games);
  const last5 = toStats(last5Games);
  const std10 = getStd(last10Games);
  const latestSeason = priorGames.length > 0 ? priorGames[0].season : null;
  const seasonGames = priorGames.filter(g => g.season === latestSeason);
  const season = toStats(seasonGames);

  const STABILITY_STAT_KEYS: PropStatSeriesKey[] = ['pts', 'reb', 'ast', 'threes', 'pra', 'pa', 'pr', 'ra'];
  const signalsByStat = {} as any;
  for (const k of STABILITY_STAT_KEYS) {
    signalsByStat[k] = last10Games.length === 0
      ? neutralStabilitySignals()
      : buildStabilitySignals(last10Games, k);
  }

  return { last10, season, ext: { last5, std10 }, meta: { signalsByStat } };
}

interface BetResult {
  playerName: string;
  propType: string;
  side: string;
  line: number;
  oddsDecimal: number;
  oddsAmerican: number;
  evTrackB: number;
  modelProbB: number;
  confidenceTier: string | null;
  betWon: boolean;
  profit: number;
}

async function main() {
  console.log(`Fetching ${SAMPLE_SIZE} recent evaluated props...`);

  const evalUnits = await query<EvalUnit>(`
    SELECT *
    FROM research.v_prop_eval_units
    WHERE odds_decimal IS NOT NULL AND stat_actual IS NOT NULL AND bet_won IS NOT NULL AND stat_actual != line_value
    ORDER BY decision_at DESC
    LIMIT $1
  `, [SAMPLE_SIZE]);

  if (evalUnits.length === 0) {
    console.log("No evaluable props found.");
    return;
  }

  console.log(`Fetched ${evalUnits.length} props. Finding unique players...`);
  const playerIds = [...new Set(evalUnits.map(e => e.player_id))];

  console.log(`Fetching game logs for ${playerIds.length} unique players...`);
  const logs = await query(`
    SELECT l.game_id, l.game_date::text, l.season, l.points, l.rebounds, l.assists,
           l.three_pointers_made, l.minutes, l.player_id, g.start_time
    FROM analytics.player_game_logs l
    JOIN analytics.games g ON l.game_id::varchar = g.game_id
    WHERE l.player_id = ANY($1)
  `, [playerIds]);

  const gamesByPlayer = new Map<number, GameLog[]>();
  for (const row of logs) {
    const pid = row.player_id;
    if (!gamesByPlayer.has(pid)) gamesByPlayer.set(pid, []);
    gamesByPlayer.get(pid)!.push({
      game_id: row.game_id, game_date: row.game_date, season: row.season,
      points: Number(row.points), rebounds: Number(row.rebounds), assists: Number(row.assists),
      three_pointers_made: Number(row.three_pointers_made), minutes: Number(row.minutes),
      start_time: row.start_time,
    } as any);
  }

  console.log('Running backtest simulations...');
  const allBets: BetResult[] = [];
  let brierSum = 0;
  let brierCount = 0;

  // EV thresholds to test
  const thresholds = [0.0, 0.02, 0.05, 0.08, 0.10];

  for (const row of evalUnits) {
    const games = gamesByPlayer.get(row.player_id) || [];
    const inputs = rebuildInputs(games, row.game_date);

    const propRow: PropEvRowInput = {
      prop_type: row.prop_type,
      market_type: 'over_under',
      side: row.side,
      line_value: row.line_value,
      odds_american: row.odds_american,
      odds_decimal: row.odds_decimal,
    };

    const evFields = computePropEvFields(propRow, inputs, 'trackB_calibrated');
    const outcome = row.bet_won ? 1 : 0;

    if (evFields.modelProbabilityTrackB != null) {
      brierSum += Math.pow(evFields.modelProbabilityTrackB - outcome, 2);
      brierCount++;
    }

    if (evFields.evTrackB != null && evFields.modelProbabilityTrackB != null) {
      const profit = row.bet_won ? (row.odds_decimal - 1) : -1;
      allBets.push({
        playerName: row.player_name,
        propType: row.prop_type,
        side: row.side,
        line: row.line_value,
        oddsDecimal: row.odds_decimal,
        oddsAmerican: row.odds_american,
        evTrackB: evFields.evTrackB,
        modelProbB: evFields.modelProbabilityTrackB,
        confidenceTier: evFields.confidenceTier,
        betWon: row.bet_won!,
        profit,
      });
    }
  }

  // Helper to compute stats for a subset
  function computeStats(bets: BetResult[], minEv: number) {
    const qualified = bets.filter(b => b.evTrackB >= minEv);
    const placed = qualified.length;
    const won = qualified.filter(b => b.betWon).length;
    const totalProfit = qualified.reduce((s, b) => s + b.profit, 0);
    return {
      betsPlaced: placed,
      won,
      hitRate: placed > 0 ? won / placed : 0,
      roiUnits: totalProfit,
      roaPct: placed > 0 ? (totalProfit / placed) * 100 : 0,
    };
  }

  // Overall by threshold
  const byThreshold: Record<string, any> = {};
  for (const t of thresholds) {
    byThreshold[`ev_${(t * 100).toFixed(0)}pct`] = computeStats(allBets, t);
  }

  // By prop type (at 2% threshold)
  const propTypes = [...new Set(allBets.map(b => b.propType))].sort();
  const byPropType: Record<string, any> = {};
  for (const pt of propTypes) {
    const subset = allBets.filter(b => b.propType === pt);
    byPropType[pt] = computeStats(subset, 0.02);
  }

  // By confidence tier (at 2% threshold)
  const tiers = ['high', 'medium', 'low'];
  const byConfidence: Record<string, any> = {};
  for (const tier of tiers) {
    const subset = allBets.filter(b => b.confidenceTier === tier);
    byConfidence[tier] = computeStats(subset, 0.02);
  }

  // By side (at 2% threshold)
  const bySide: Record<string, any> = {};
  for (const side of ['over', 'under']) {
    const subset = allBets.filter(b => b.side.toLowerCase() === side);
    bySide[side] = computeStats(subset, 0.02);
  }

  // EV distribution of all bets
  const evVals = allBets.map(b => b.evTrackB);
  const evDistribution = {
    'above_15pct': evVals.filter(v => v > 0.15).length,
    '10_to_15pct': evVals.filter(v => v > 0.10 && v <= 0.15).length,
    '5_to_10pct': evVals.filter(v => v > 0.05 && v <= 0.10).length,
    '2_to_5pct': evVals.filter(v => v > 0.02 && v <= 0.05).length,
    '0_to_2pct': evVals.filter(v => v >= 0 && v <= 0.02).length,
    'neg_0_to_5pct': evVals.filter(v => v >= -0.05 && v < 0).length,
    'neg_5_to_10pct': evVals.filter(v => v >= -0.10 && v < -0.05).length,
    'neg_10_to_15pct': evVals.filter(v => v >= -0.15 && v < -0.10).length,
    'below_neg15pct': evVals.filter(v => v < -0.15).length,
  };

  const results = {
    sampleSize: evalUnits.length,
    brierScore: brierCount > 0 ? brierSum / brierCount : null,
    totalBetsEvaluated: allBets.length,
    evDistribution,
    byThreshold,
    byPropType,
    byConfidence,
    bySide,
  };

  fs.writeFileSync('results.json', JSON.stringify(results, null, 2));
  console.log('Results written to results.json');
}

main().catch(console.error);
