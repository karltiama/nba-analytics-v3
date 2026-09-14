/**
 * Research-only played-game shadow projection pipeline.
 *
 * Does NOT change production Track A, Track B.1, getPlayerPropModelInputs,
 * APIs, UI, sportsbook ingestion, or lib/betting/ev-calibration-artifacts.json.
 *
 *   npm run evaluate:shadow-projection
 *   npx tsx scripts/evaluate-shadow-projection.ts --season 2025 --limit 2000
 */
import 'dotenv/config';

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import {
  PROP_TYPE_LABEL,
  SAMPLE_BUCKETS,
  SUPPORTED_PROP_TYPES,
  buildAsOfModelInputs,
  computeMetricBlock,
  consensusMarketLine,
  filterPregameLines,
  sampleBucketForCount,
  selectPriorGames,
  statFromLog,
  type BookPregameLine,
  type FeatureDefinition,
  type MetricBlock,
  type SupportedPropType,
} from '../lib/betting/player-projection-eval';
import { getStatsForPropType } from '../lib/betting/player-prop-inputs';
import { getCalibrationVersion } from '../lib/betting/ev-calibration';
import { computeConfidenceTier, isComboPropType, propTypeToStatKey } from '../lib/betting/track-b1-policy';
import {
  classifyAppearance,
  isPlayedGame,
  isPostseasonGame,
  parseMinutes,
  teamChangeContext,
  type MinutesEvalLog,
} from '../lib/betting/minutes-projection-eval';
import {
  CALIBRATION_MIN_SAMPLES,
  CALIBRATION_SHRINK_LAMBDA,
  PRODUCTION_CALIBRATION_RELATIVE_PATH,
  SHADOW_CALIBRATION_RELATIVE_PATH,
  SHADOW_EVAL_VERSION,
  THREE_SHRINK_K,
  applyLinearCalibration,
  applyMismatchedProductionCalibration,
  anchorToMarket,
  bootstrapMaeDifference,
  buildPlayedOnlyAsOfModelInputs,
  chronologicalCutIso,
  classifyMaeDelta,
  clamp01,
  countShadowLeakage,
  decimalOddsFromAmerican,
  evFromProbability,
  filterPlayedGames,
  fitLinearCalibration,
  isOnOrAfter,
  marketImpliedProbability,
  preferredCleanBaseline,
  probabilityMetrics,
  rawOverProbability,
  realizedUnitReturn,
  shadowMeansFromInputs,
  shrinkToward,
  writeResearchCalibration,
  type FittedLinearCal,
  type ProbabilityScore,
  type ShadowMeanId,
} from '../lib/betting/shadow-projection-eval';

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

function fmt(n: number | null | undefined, digits = 3): string {
  if (n == null || !Number.isFinite(n)) return 'n/a';
  return n.toFixed(digits);
}

function round4(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n * 1e4) / 1e4;
}

function iso(v: Date | string | null | undefined): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
}

function compact(m: MetricBlock) {
  return {
    mae: round4(m.mae),
    rmse: round4(m.rmse),
    bias: round4(m.bias),
    medianAe: round4(m.medianAe),
    coverage: round4(m.coverage),
    n: m.nScored,
    nEligible: m.nEligible,
  };
}

function mdTable(headers: string[], rows: string[][]): string {
  const all = [headers, ...rows];
  const widths = headers.map((_, i) => Math.max(...all.map((r) => (r[i] ?? '').length)));
  const line = (r: string[]) =>
    `| ${r.map((c, i) => (c ?? '').padEnd(widths[i])).join(' | ')} |`;
  const sep = `| ${widths.map((w) => '-'.repeat(w)).join(' | ')} |`;
  return [line(headers), sep, ...rows.map(line)].join('\n');
}

type Pair = { projection: number | null; actual: number };

class PairBag {
  private bags = new Map<string, Pair[]>();
  push(key: string, projection: number | null, actual: number) {
    const list = this.bags.get(key);
    if (list) list.push({ projection, actual });
    else this.bags.set(key, [{ projection, actual }]);
  }
  get(key: string): Pair[] {
    return this.bags.get(key) ?? [];
  }
}

class RunningBag {
  private bags = new Map<string, { n: number; err: number; abs: number; sq: number }>();
  push(key: string, projection: number | null, actual: number) {
    if (projection == null || !Number.isFinite(projection) || !Number.isFinite(actual)) return;
    const e = projection - actual;
    const prev = this.bags.get(key);
    if (prev) {
      prev.n += 1;
      prev.err += e;
      prev.abs += Math.abs(e);
      prev.sq += e * e;
    } else {
      this.bags.set(key, { n: 1, err: e, abs: Math.abs(e), sq: e * e });
    }
  }
  compact(key: string) {
    const s = this.bags.get(key);
    if (!s || s.n === 0) {
      return { mae: null, rmse: null, bias: null, medianAe: null, coverage: 0, n: 0, nEligible: 0 };
    }
    return {
      mae: round4(s.abs / s.n),
      rmse: round4(Math.sqrt(s.sq / s.n)),
      bias: round4(s.err / s.n),
      medianAe: null,
      coverage: 1,
      n: s.n,
      nEligible: s.n,
    };
  }
}

const MEAN_IDS: ShadowMeanId[] = [
  'production_track_a',
  'production_track_b',
  'played_track_a',
  'played_track_b',
];

type LineRow = {
  game_id: string;
  player_id: string;
  prop_type: string;
  sportsbook: string;
  line_value: string | number;
  odds_american: string | number | null;
  odds_decimal: string | number | null;
  decision_at: Date | string;
  game_start_time: Date | string;
};

type LogRow = {
  player_id: string;
  game_id: string;
  team_id: string | null;
  start_time: Date | string | null;
  season: string;
  minutes: string | number | null;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  three_pointers_made: number | null;
};

type MarketRow = {
  prop: SupportedPropType;
  startTime: string;
  season: string;
  actual: number;
  line: number;
  decimalOdds: number | null;
  overWon: boolean | null;
  isPush: boolean;
  minutesBeforeTip: number | null;
  productionTrackA: number | null;
  productionTrackB: number | null;
  playedTrackA: number | null;
  playedTrackB: number | null;
  pProdARaw: number | null;
  pProdBRaw: number | null;
  pPlayedARaw: number | null;
  pPlayedBRaw: number | null;
  confidence: string | null;
  sampleBucket: string;
  phase: 'regular' | 'postseason';
  teamChanged: boolean;
};

type ThreePrefix = { t: number; sum: number; n: number };

function packProb(p: number | null, overWon: boolean | null): ProbabilityScore | null {
  if (p == null || overWon == null || !Number.isFinite(p)) return null;
  return { p: clamp01(p), win: overWon ? 1 : 0 };
}

function directionalHit(p: number | null, overWon: boolean | null): boolean | null {
  if (p == null || overWon == null || p === 0.5) return null;
  return p > 0.5 === overWon;
}

function evSummary(
  rows: Array<{ p: number | null; ev: number | null; overWon: boolean | null; decimalOdds: number | null; isPush: boolean }>
) {
  const scored = rows.filter((r) => r.ev != null && r.overWon != null && !r.isPush);
  const positive = scored.filter((r) => (r.ev as number) > 0);
  const hits = scored.filter((r) => r.overWon === true).length;
  const posHits = positive.filter((r) => r.overWon === true).length;
  const unit = positive.filter((r) => r.decimalOdds != null).map((r) =>
    realizedUnitReturn(r.overWon ? 1 : 0, r.decimalOdds as number)
  );
  return {
    n: scored.length,
    nPositiveEv: positive.length,
    avgEstimatedEv: round4(
      scored.length ? scored.reduce((a, r) => a + (r.ev as number), 0) / scored.length : null
    ),
    avgEstimatedEvPositive: round4(
      positive.length ? positive.reduce((a, r) => a + (r.ev as number), 0) / positive.length : null
    ),
    directionalHitRate: round4(scored.length ? hits / scored.length : null),
    positiveEvHitRate: round4(positive.length ? posHits / positive.length : null),
    realizedUnitReturnPositiveEv: round4(
      unit.length ? unit.reduce((a, b) => a + b, 0) / unit.length : null
    ),
  };
}

async function main() {
  const runAt = new Date().toISOString();
  const seasonArg = argValue('--season');
  const from = argValue('--from');
  const to = argValue('--to');
  const limit = argValue('--limit') ? Number(argValue('--limit')) : null;
  const bootstrapIters = argValue('--bootstrap') ? Number(argValue('--bootstrap')) : 400;
  const definition = (argValue('--feature-definition') ?? 'active_season') as FeatureDefinition;
  if (definition !== 'active_season' && definition !== 'career') {
    throw new Error('--feature-definition must be active_season or career');
  }

  const url = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('SUPABASE_DB_URL or DATABASE_URL required');
  const pool = new Pool({ connectionString: url, max: 4 });
  const seasons = seasonArg ? [seasonArg] : ['2023', '2024', '2025'];

  try {
    console.log(`Shadow projection eval ${SHADOW_EVAL_VERSION}`);
    console.log(`Run ${runAt} seasons=${seasons.join(',')} definition=${definition}`);

    const logRes = await pool.query<LogRow>(
      `
      SELECT
        l.player_id::text AS player_id,
        l.game_id::text AS game_id,
        l.team_id::text AS team_id,
        COALESCE(g.start_time, l.game_date::timestamptz) AS start_time,
        g.season::text AS season,
        l.minutes,
        l.points,
        l.rebounds,
        l.assists,
        l.three_pointers_made
      FROM analytics.player_game_logs l
      JOIN analytics.games g ON g.game_id = l.game_id
      WHERE g.status = 'Final'
        AND g.start_time IS NOT NULL
        AND g.season = ANY($1::text[])
      ORDER BY l.player_id, g.start_time
      `,
      [seasons]
    );
    console.log(`Loaded ${logRes.rows.length} Final log rows`);

    const starterRes = await pool.query<{ game_id: string; player_id: string }>(
      `SELECT game_id::text, player_id::text FROM analytics.game_starters`
    );
    const starterKeys = new Set(starterRes.rows.map((r) => `${r.game_id}|${r.player_id}`));
    const gamesWithStarters = new Set(starterRes.rows.map((r) => r.game_id));

    const lineRes = await pool.query<LineRow>(
      `
      SELECT
        game_id::text,
        player_id::text,
        prop_type,
        sportsbook,
        line_value,
        odds_american,
        odds_decimal,
        decision_at,
        game_start_time
      FROM research.prop_decision_lines
      WHERE lower(side) = 'over'
      `
    );
    const linesByOpp = new Map<string, BookPregameLine[]>();
    for (const row of lineRes.rows) {
      const key = `${row.game_id}|${row.player_id}|${String(row.prop_type).toLowerCase()}`;
      const list = linesByOpp.get(key) ?? [];
      list.push({
        sportsbook: row.sportsbook,
        lineValue: Number(row.line_value),
        oddsAmerican: row.odds_american != null ? Number(row.odds_american) : null,
        oddsDecimal: row.odds_decimal != null ? Number(row.odds_decimal) : null,
        decisionAt: iso(row.decision_at),
      });
      linesByOpp.set(key, list);
    }
    console.log(`Loaded ${lineRes.rows.length} pregame OVER decision lines`);

    const gamesByPlayer = new Map<string, MinutesEvalLog[]>();
    const seenLog = new Set<string>();
    const corpus = { n: 0, played: 0, dnp: 0, malformed: 0, zeroPointPlayed: 0, token00: 0, token0: 0 };
    const threeBySeason = new Map<string, Array<{ t: number; v: number }>>();
    for (const row of logRes.rows) {
      const k = `${row.player_id}|${row.game_id}`;
      if (seenLog.has(k)) continue;
      seenLog.add(k);
      if (!row.start_time) continue;
      const g: MinutesEvalLog = {
        game_id: row.game_id,
        player_id: row.player_id,
        team_id: row.team_id,
        start_time: iso(row.start_time),
        season: String(row.season ?? ''),
        minutes: row.minutes,
        points: row.points,
        rebounds: row.rebounds,
        assists: row.assists,
        three_pointers_made: row.three_pointers_made,
      };
      const cls = classifyAppearance(g);
      corpus.n += 1;
      if (cls.minutesToken === '00') corpus.token00 += 1;
      if (cls.minutesToken === '0' || cls.minutesToken === '0.0') corpus.token0 += 1;
      if (cls.class === 'played') {
        corpus.played += 1;
        if ((g.points ?? 0) === 0) corpus.zeroPointPlayed += 1;
        const t = Date.parse(g.start_time);
        const v = g.three_pointers_made ?? 0;
        const list = threeBySeason.get(g.season) ?? [];
        list.push({ t, v });
        threeBySeason.set(g.season, list);
      } else if (cls.class === 'dnp') corpus.dnp += 1;
      else corpus.malformed += 1;
      const list = gamesByPlayer.get(row.player_id) ?? [];
      list.push(g);
      gamesByPlayer.set(row.player_id, list);
    }

    const threePrefix = new Map<string, ThreePrefix[]>();
    for (const [season, events] of threeBySeason) {
      events.sort((a, b) => a.t - b.t);
      const pref: ThreePrefix[] = [];
      let sum = 0;
      let n = 0;
      for (const e of events) {
        sum += e.v;
        n += 1;
        pref.push({ t: e.t, sum, n });
      }
      threePrefix.set(season, pref);
    }

    function leagueThreeMeanAsOf(season: string, startTime: string): number | null {
      const pref = threePrefix.get(season);
      if (!pref || pref.length === 0) return null;
      const t = Date.parse(startTime);
      let lo = 0;
      let hi = pref.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (pref[mid].t < t) lo = mid + 1;
        else hi = mid;
      }
      if (lo === 0) return null;
      const p = pref[lo - 1];
      return p.n > 0 ? p.sum / p.n : null;
    }

    const fromMs = from ? Date.parse(from) : Number.NEGATIVE_INFINITY;
    const toMs = to ? Date.parse(to) : Number.POSITIVE_INFINITY;
    const targets: MinutesEvalLog[] = [];
    for (const logs of gamesByPlayer.values()) {
      for (const g of logs) {
        const t = Date.parse(g.start_time);
        if (t < fromMs || t > toMs) continue;
        if (!isPlayedGame(g)) continue;
        targets.push(g);
      }
    }
    targets.sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time));
    const limited =
      limit != null && Number.isFinite(limit) && limit > 0 ? targets.slice(0, limit) : targets;
    console.log(`Played targets: ${limited.length}`);
    const threeChrono = chronologicalCutIso(
      limited.map((g) => g.start_time),
      0.7
    );

    const overall = new PairBag();
    const slices = new RunningBag();
    const playedErrA: Record<string, number[]> = {};
    const playedErrB: Record<string, number[]> = {};
    const marketRows: MarketRow[] = [];
    const leakage = {
      targetGameInFeatures: 0,
      laterGamesInFeatures: 0,
      dnpRetainedInPlayedInputs: 0,
      zeroStatPlayedDropped: 0,
      postTipMarketLines: 0,
      usedSeasonAverageTable: false as const,
      usedInjuryState: false as const,
      usedSportsbookInMean: false as const,
      comparedUsingStartTimeNotGameDate: true as const,
    };

    let nScored = 0;
    let nNoPrior = 0;
    let minStart = '';
    let maxStart = '';
    const playerIds = new Set<string>();
    const postseasonDiag = {
      n: 0,
      starters: 0,
      knownRole: 0,
      highMinute: 0,
      sumActualMin: 0,
      sumPriorPlayed: 0,
      sumProdA: 0,
      sumPlayedA: 0,
      sumActualPts: 0,
      nPts: 0,
    };

    for (const target of limited) {
      const all = gamesByPlayer.get(target.player_id) ?? [];
      const prior = selectPriorGames(all, target.start_time, target.season, definition) as MinutesEvalLog[];
      const playedPrior = filterPlayedGames(prior);
      if (playedPrior.length === 0) {
        nNoPrior += 1;
        continue;
      }
      const prodInputs = buildAsOfModelInputs(prior, target.season);
      const playedInputs = buildPlayedOnlyAsOfModelInputs(prior, target.season);
      if (!prodInputs || !playedInputs) {
        nNoPrior += 1;
        continue;
      }

      nScored += 1;
      playerIds.add(target.player_id);
      if (!minStart || target.start_time < minStart) minStart = target.start_time;
      if (!maxStart || target.start_time > maxStart) maxStart = target.start_time;

      const leak = countShadowLeakage({
        target,
        priorAll: prior,
        playedInputsPrior: playedPrior,
        marketMinutesBeforeTip: null,
      });
      if (leak.targetIncluded) leakage.targetGameInFeatures += 1;
      if (leak.laterIncluded) leakage.laterGamesInFeatures += 1;
      if (leak.dnpInPlayedInputs) leakage.dnpRetainedInPlayedInputs += 1;
      if (leak.zeroStatPlayedDropped) leakage.zeroStatPlayedDropped += 1;

      const phase = isPostseasonGame(target.season, target.start_time) ? 'postseason' : 'regular';
      const team = teamChangeContext(prior, target.team_id);
      const sample = sampleBucketForCount(playedPrior.length);
      const actualMin = parseMinutes(target.minutes) ?? 0;
      const role = !gamesWithStarters.has(target.game_id)
        ? 'unknown'
        : starterKeys.has(`${target.game_id}|${target.player_id}`)
          ? 'starter'
          : 'bench';

      if (phase === 'postseason') {
        postseasonDiag.n += 1;
        postseasonDiag.sumActualMin += actualMin;
        postseasonDiag.sumPriorPlayed += playedPrior.length;
        if (role !== 'unknown') postseasonDiag.knownRole += 1;
        if (role === 'starter') postseasonDiag.starters += 1;
        if (actualMin >= 28) postseasonDiag.highMinute += 1;
      }

      const league3 = leagueThreeMeanAsOf(target.season, target.start_time);

      for (const prop of SUPPORTED_PROP_TYPES) {
        const key = propTypeToStatKey(prop);
        if (!key) continue;
        const actual = statFromLog(target, key);
        if (actual == null || !Number.isFinite(actual)) continue;
        const means = shadowMeansFromInputs(prodInputs, playedInputs, prop);
        const mapped: Record<ShadowMeanId, number | null> = {
          production_track_a: means.productionTrackA,
          production_track_b: means.productionTrackB,
          played_track_a: means.playedTrackA,
          played_track_b: means.playedTrackB,
        };
        for (const id of MEAN_IDS) {
          overall.push(`prop:${prop}|all|${id}`, mapped[id], actual);
          slices.push(`prop:${prop}|phase:${phase}|${id}`, mapped[id], actual);
          slices.push(`prop:${prop}|sample:${sample}|${id}`, mapped[id], actual);
          slices.push(
            `prop:${prop}|team:${team.teamChanged ? 'changed' : 'no_change'}|${id}`,
            mapped[id],
            actual
          );
        }
        if (means.playedTrackA != null && means.playedTrackB != null) {
          (playedErrA[prop] ??= []).push(means.playedTrackA - actual);
          (playedErrB[prop] ??= []).push(means.playedTrackB - actual);
        }
        if (prop === 'points' && phase === 'postseason') {
          if (means.productionTrackA != null && means.playedTrackA != null) {
            postseasonDiag.sumProdA += means.productionTrackA;
            postseasonDiag.sumPlayedA += means.playedTrackA;
            postseasonDiag.sumActualPts += actual;
            postseasonDiag.nPts += 1;
          }
        }
        if (prop === 'threes' && means.playedTrackA != null) {
          const n = playedPrior.length;
          const seasonCenter = playedInputs.season.threes;
          const threeHold = threeChrono.cutIso != null && isOnOrAfter(target.start_time, threeChrono.cutIso);
          const threeSlice = threeHold ? 'holdout' : 'fit';
          overall.push(`prop:${prop}|${threeSlice}|production_track_a`, means.productionTrackA, actual);
          overall.push(`prop:${prop}|${threeSlice}|played_track_a`, means.playedTrackA, actual);
          if (league3 != null) {
            for (const k of THREE_SHRINK_K) {
              const pred = shrinkToward(means.playedTrackA, league3, n, k);
              overall.push(`prop:${prop}|all|shrink_league_k${k}`, pred, actual);
              overall.push(`prop:${prop}|${threeSlice}|shrink_league_k${k}`, pred, actual);
            }
          }
          for (const k of THREE_SHRINK_K) {
            const pred = shrinkToward(means.playedTrackA, seasonCenter, n, k);
            overall.push(`prop:${prop}|all|shrink_season_k${k}`, pred, actual);
            overall.push(`prop:${prop}|${threeSlice}|shrink_season_k${k}`, pred, actual);
          }
        }

        const marketLines = linesByOpp.get(`${target.game_id}|${target.player_id}|${prop}`) ?? [];
        const consensus = consensusMarketLine(
          filterPregameLines(marketLines, target.start_time),
          target.start_time
        );
        if (consensus?.line != null) {
          if (consensus.minutesBeforeTip != null && consensus.minutesBeforeTip < 0) {
            leakage.postTipMarketLines += 1;
          }
          const oddsLine = consensus.closestToMedian;
          const decimalOdds = decimalOddsFromAmerican(
            oddsLine?.oddsAmerican ?? null,
            oddsLine?.oddsDecimal ?? null
          );
          const isPush = actual === consensus.line;
          const overWon = isPush ? null : actual > consensus.line;
          const playedStats = getStatsForPropType(playedInputs, prop);
          marketRows.push({
            prop,
            startTime: target.start_time,
            season: target.season,
            actual,
            line: consensus.line,
            decimalOdds,
            overWon,
            isPush,
            minutesBeforeTip: consensus.minutesBeforeTip,
            productionTrackA: means.productionTrackA,
            productionTrackB: means.productionTrackB,
            playedTrackA: means.playedTrackA,
            playedTrackB: means.playedTrackB,
            pProdARaw: rawOverProbability(prodInputs, prop, consensus.line, 'A'),
            pProdBRaw: rawOverProbability(prodInputs, prop, consensus.line, 'B'),
            pPlayedARaw: rawOverProbability(playedInputs, prop, consensus.line, 'A'),
            pPlayedBRaw: rawOverProbability(playedInputs, prop, consensus.line, 'B'),
            confidence: playedStats
              ? computeConfidenceTier(isComboPropType(prop), playedStats.stability)
              : null,
            sampleBucket: sample === 'none' ? '1-4' : sample,
            phase,
            teamChanged: team.teamChanged,
          });
          for (const id of MEAN_IDS) {
            overall.push(`prop:${prop}|market_overlap|${id}`, mapped[id], actual);
            overall.push(`prop:${prop}|market_overlap|market_line`, consensus.line, actual);
          }
        }
      }
    }

    console.log(`Scored ${nScored} player-games; market overlap rows ${marketRows.length}`);

    const marketStarts = [...new Set(marketRows.map((r) => r.startTime))].sort();
    const dateRange =
      marketStarts.length > 0
        ? { min: marketStarts[0], max: marketStarts[marketStarts.length - 1], uniqueStarts: marketStarts.length }
        : { min: null, max: null, uniqueStarts: 0 };
    let fitFraction = 0.7;
    if (marketStarts.length < 12) fitFraction = 0.6;
    const cut = chronologicalCutIso(marketStarts, fitFraction);
    console.log(
      `Market tape ${dateRange.min} → ${dateRange.max}; chronological cut ${cut.cutIso} (fitFraction=${fitFraction})`
    );

    const fitByProp = new Map<string, Array<{ p: number; y: 0 | 1 }>>();
    const fitAll: Array<{ p: number; y: 0 | 1 }> = [];
    for (const row of marketRows) {
      if (cut.cutIso == null || isOnOrAfter(row.startTime, cut.cutIso)) continue;
      const packed = packProb(row.pPlayedARaw, row.overWon);
      if (!packed) continue;
      const sample = { p: packed.p, y: packed.win };
      const list = fitByProp.get(row.prop) ?? [];
      list.push(sample);
      fitByProp.set(row.prop, list);
      fitAll.push(sample);
    }
    const researchCal: Record<string, FittedLinearCal> = {
      default: fitLinearCalibration(fitAll),
    };
    for (const prop of SUPPORTED_PROP_TYPES) {
      researchCal[prop] = fitLinearCalibration(fitByProp.get(prop) ?? []);
    }

    const calPayload = {
      version: `shadow-played-only-trackA-${runAt.slice(0, 10)}`,
      note: 'RESEARCH ONLY. Do not copy into lib/betting/ev-calibration-artifacts.json. Fit on played-only Track A raw P, chronological split.',
      productionArtifactsUntouched: PRODUCTION_CALIBRATION_RELATIVE_PATH,
      family: 'slope * p_raw + intercept',
      shrinkLambda: CALIBRATION_SHRINK_LAMBDA,
      minSamples: CALIBRATION_MIN_SAMPLES,
      split: {
        rule: 'chronological unique start_time',
        fitFraction,
        cutIso: cut.cutIso,
        uniqueStarts: cut.uniqueStarts,
        fitStarts: cut.fitStarts,
        holdStarts: cut.holdStarts,
        marketMin: dateRange.min,
        marketMax: dateRange.max,
      },
      tracks: {
        playedTrackA: Object.fromEntries(
          Object.entries(researchCal).map(([k, v]) => [
            k,
            {
              slope: v.slope,
              intercept: v.intercept,
              rawSlope: v.rawSlope,
              rawIntercept: v.rawIntercept,
              n: v.n,
              identityFallback: v.identityFallback,
              meanP: v.meanP,
              meanY: v.meanY,
              varP: v.varP,
              cov: v.cov,
            },
          ])
        ),
      },
    };
    mkdirSync(join(process.cwd(), 'reports/model-validation'), { recursive: true });
    const calPath = writeResearchCalibration(process.cwd(), calPayload, SHADOW_CALIBRATION_RELATIVE_PATH);
    console.log(`Wrote research calibration ${calPath}`);
    console.log(
      'research cal points',
      researchCal.points?.slope,
      researchCal.points?.intercept,
      'fallback',
      researchCal.points?.identityFallback,
      'meanP',
      researchCal.points?.meanP,
      'meanY',
      researchCal.points?.meanY,
      'varP',
      researchCal.points?.varP
    );

    function researchCalFor(prop: string): FittedLinearCal {
      return researchCal[prop] ?? researchCal.default;
    }

    function stageProb(row: MarketRow, stage: string): number | null {
      if (row.overWon == null) return null;
      const odds = row.decimalOdds;
      const marketP = odds != null ? marketImpliedProbability(odds) : null;
      switch (stage) {
        case 'production_raw':
          return row.pProdBRaw;
        case 'production_calibrated':
          return row.pProdBRaw != null
            ? applyMismatchedProductionCalibration(row.pProdBRaw, row.prop, 'trackB')
            : null;
        case 'production_anchored': {
          const cal =
            row.pProdBRaw != null
              ? applyMismatchedProductionCalibration(row.pProdBRaw, row.prop, 'trackB')
              : null;
          return cal != null && marketP != null && odds != null ? anchorToMarket(cal, marketP, odds) : null;
        }
        case 'played_a_raw':
          return row.pPlayedARaw;
        case 'played_a_mismatched_cal':
          return row.pPlayedARaw != null
            ? applyMismatchedProductionCalibration(row.pPlayedARaw, row.prop, 'trackA')
            : null;
        case 'played_a_research_cal':
          return row.pPlayedARaw != null
            ? applyLinearCalibration(row.pPlayedARaw, researchCalFor(row.prop))
            : null;
        case 'played_a_research_cal_anchored': {
          const cal =
            row.pPlayedARaw != null
              ? applyLinearCalibration(row.pPlayedARaw, researchCalFor(row.prop))
              : null;
          return cal != null && marketP != null && odds != null ? anchorToMarket(cal, marketP, odds) : null;
        }
        default:
          return null;
      }
    }

    const holdout = marketRows.filter((r) => cut.cutIso != null && isOnOrAfter(r.startTime, cut.cutIso));
    const fitRows = marketRows.filter((r) => cut.cutIso != null && !isOnOrAfter(r.startTime, cut.cutIso));

    const STAGE_IDS = [
      'production_raw',
      'production_calibrated',
      'production_anchored',
      'played_a_raw',
      'played_a_mismatched_cal',
      'played_a_research_cal',
      'played_a_research_cal_anchored',
    ] as const;

    function metricsFor(
      rows: MarketRow[],
      pick: (r: MarketRow) => number | null
    ): ReturnType<typeof probabilityMetrics> {
      const packed: ProbabilityScore[] = [];
      for (const r of rows) {
        const p = packProb(pick(r), r.overWon);
        if (p) packed.push(p);
      }
      const m = probabilityMetrics(packed);
      return {
        brier: round4(m.brier),
        ece: round4(m.ece),
        logLoss: round4(m.logLoss),
        n: m.n,
      };
    }

    const rawAll = {
      productionTrackA: metricsFor(marketRows, (r) => r.pProdARaw),
      productionTrackB: metricsFor(marketRows, (r) => r.pProdBRaw),
      playedTrackA: metricsFor(marketRows, (r) => r.pPlayedARaw),
      playedTrackB: metricsFor(marketRows, (r) => r.pPlayedBRaw),
    };
    const rawByProp: Record<string, typeof rawAll> = {};
    for (const prop of SUPPORTED_PROP_TYPES) {
      const rows = marketRows.filter((r) => r.prop === prop);
      rawByProp[PROP_TYPE_LABEL[prop]] = {
        productionTrackA: metricsFor(rows, (r) => r.pProdARaw),
        productionTrackB: metricsFor(rows, (r) => r.pProdBRaw),
        playedTrackA: metricsFor(rows, (r) => r.pPlayedARaw),
        playedTrackB: metricsFor(rows, (r) => r.pPlayedBRaw),
      };
    }

    const stagesHoldout: Record<string, ReturnType<typeof metricsFor>> = {};
    const stagesHoldoutByProp: Record<string, Record<string, ReturnType<typeof metricsFor>>> = {};
    for (const stage of STAGE_IDS) {
      stagesHoldout[stage] = metricsFor(holdout, (r) => stageProb(r, stage));
      stagesHoldoutByProp[stage] = {};
      for (const prop of SUPPORTED_PROP_TYPES) {
        stagesHoldoutByProp[stage][PROP_TYPE_LABEL[prop]] = metricsFor(
          holdout.filter((r) => r.prop === prop),
          (r) => stageProb(r, stage)
        );
      }
    }

    const bootstrap: Record<string, ReturnType<typeof bootstrapMaeDifference>> = {};
    for (const prop of SUPPORTED_PROP_TYPES) {
      bootstrap[PROP_TYPE_LABEL[prop]] = bootstrapMaeDifference(
        playedErrA[prop] ?? [],
        playedErrB[prop] ?? [],
        bootstrapIters,
        20260913
      );
    }

    const byProp: Record<string, Record<string, ReturnType<typeof compact>>> = {};
    const wouldHaveShipped: Record<
      string,
      {
        productionTrackA: ReturnType<typeof compact>;
        productionTrackB: ReturnType<typeof compact>;
        playedTrackA: ReturnType<typeof compact>;
        playedTrackB: ReturnType<typeof compact>;
        deltaPlayedBMinusA: number | null;
        classification: ReturnType<typeof classifyMaeDelta>;
        preferredCleanBaseline: ShadowMeanId;
        bootstrap: {
          delta: number | null;
          ciLow: number | null;
          ciHigh: number | null;
          n: number;
          iterations: number;
          ciExcludesZero: boolean | null;
        };
      }
    > = {};

    for (const prop of SUPPORTED_PROP_TYPES) {
      const label = PROP_TYPE_LABEL[prop];
      byProp[label] = {};
      for (const id of MEAN_IDS) {
        byProp[label][id] = compact(
          computeMetricBlock(overall.get(`prop:${prop}|all|${id}`), overall.get(`prop:${prop}|all|${id}`).length)
        );
      }
      byProp[label].market_line = compact(
        computeMetricBlock(
          overall.get(`prop:${prop}|market_overlap|market_line`),
          overall.get(`prop:${prop}|market_overlap|market_line`).length
        )
      );
      if (prop === 'threes') {
        for (const k of THREE_SHRINK_K) {
          byProp[label][`shrink_league_k${k}`] = compact(
            computeMetricBlock(
              overall.get(`prop:${prop}|all|shrink_league_k${k}`),
              overall.get(`prop:${prop}|all|shrink_league_k${k}`).length
            )
          );
          byProp[label][`shrink_season_k${k}`] = compact(
            computeMetricBlock(
              overall.get(`prop:${prop}|all|shrink_season_k${k}`),
              overall.get(`prop:${prop}|all|shrink_season_k${k}`).length
            )
          );
        }
      }
      const a = byProp[label].played_track_a.mae;
      const b = byProp[label].played_track_b.mae;
      const delta = a != null && b != null ? b - a : null;
      const boot = bootstrap[label];
      wouldHaveShipped[label] = {
        productionTrackA: byProp[label].production_track_a,
        productionTrackB: byProp[label].production_track_b,
        playedTrackA: byProp[label].played_track_a,
        playedTrackB: byProp[label].played_track_b,
        deltaPlayedBMinusA: round4(delta),
        classification: delta != null ? classifyMaeDelta(delta) : 'tied',
        preferredCleanBaseline: preferredCleanBaseline(delta ?? 0, prop),
        bootstrap: {
          delta: round4(boot.delta),
          ciLow: round4(boot.ciLow),
          ciHigh: round4(boot.ciHigh),
          n: boot.n,
          iterations: boot.iterations,
          ciExcludesZero:
            boot.ciLow != null && boot.ciHigh != null ? boot.ciLow > 0 || boot.ciHigh < 0 : null,
        },
      };
    }

    const segmentKeys = [
      ...['regular', 'postseason'].map((p) => `phase:${p}`),
      ...SAMPLE_BUCKETS.map((s) => `sample:${s}`),
      'team:changed',
      'team:no_change',
    ];
    const segments: Record<string, Record<string, Record<string, ReturnType<RunningBag['compact']>>>> = {};
    for (const prop of SUPPORTED_PROP_TYPES) {
      const label = PROP_TYPE_LABEL[prop];
      segments[label] = {};
      for (const slice of segmentKeys) {
        segments[label][slice] = {
          played_track_a: slices.compact(`prop:${prop}|${slice}|played_track_a`),
          played_track_b: slices.compact(`prop:${prop}|${slice}|played_track_b`),
        };
      }
    }

    const confidence: Record<
      string,
      Record<string, { n: number; mae: number | null; rmse: number | null; bias: number | null; directionalHit: number | null }>
    > = {};
    for (const prop of SUPPORTED_PROP_TYPES) {
      const label = PROP_TYPE_LABEL[prop];
      confidence[label] = {};
      for (const tier of ['high', 'medium', 'low'] as const) {
        const rows = marketRows.filter((r) => r.prop === prop && r.confidence === tier);
        const pairs = rows
          .filter((r) => r.playedTrackB != null)
          .map((r) => ({ projection: r.playedTrackB, actual: r.actual }));
        const m = computeMetricBlock(pairs, rows.length);
        const dir = rows.map((r) => directionalHit(r.pPlayedBRaw, r.overWon)).filter((x): x is boolean => x != null);
        confidence[label][tier] = {
          n: m.nScored,
          mae: round4(m.mae),
          rmse: round4(m.rmse),
          bias: round4(m.bias),
          directionalHit: round4(dir.length ? dir.filter(Boolean).length / dir.length : null),
        };
      }
    }

    function evForStage(
      rows: MarketRow[],
      pPick: (r: MarketRow) => number | null
    ) {
      return evSummary(
        rows.map((r) => {
          const p = pPick(r);
          const ev = p != null && r.decimalOdds != null ? evFromProbability(p, r.decimalOdds) : null;
          return { p, ev, overWon: r.overWon, decimalOdds: r.decimalOdds, isPush: r.isPush };
        })
      );
    }

    const evRows = marketRows.filter((r) => r.decimalOdds != null && r.overWon != null);
    const evDiagnostic = {
      nWithOdds: evRows.length,
      productionAnchored: evForStage(evRows, (r) => stageProb(r, 'production_anchored')),
      playedARaw: evForStage(evRows, (r) => r.pPlayedARaw),
      playedAMismatchedCal: evForStage(evRows, (r) => stageProb(r, 'played_a_mismatched_cal')),
      playedAResearchCal: evForStage(evRows, (r) => stageProb(r, 'played_a_research_cal')),
      playedAResearchCalAnchored: evForStage(evRows, (r) => stageProb(r, 'played_a_research_cal_anchored')),
    };

    const postseasonOut = {
      nGames: postseasonDiag.n,
      starterShare:
        postseasonDiag.knownRole > 0 ? round4(postseasonDiag.starters / postseasonDiag.knownRole) : null,
      highMinuteShare: postseasonDiag.n > 0 ? round4(postseasonDiag.highMinute / postseasonDiag.n) : null,
      meanActualMinutes: postseasonDiag.n > 0 ? round4(postseasonDiag.sumActualMin / postseasonDiag.n) : null,
      meanPriorPlayed: postseasonDiag.n > 0 ? round4(postseasonDiag.sumPriorPlayed / postseasonDiag.n) : null,
      pts: {
        n: postseasonDiag.nPts,
        meanActual: postseasonDiag.nPts > 0 ? round4(postseasonDiag.sumActualPts / postseasonDiag.nPts) : null,
        meanProductionA:
          postseasonDiag.nPts > 0 ? round4(postseasonDiag.sumProdA / postseasonDiag.nPts) : null,
        meanPlayedA:
          postseasonDiag.nPts > 0 ? round4(postseasonDiag.sumPlayedA / postseasonDiag.nPts) : null,
        productionA: slices.compact('prop:points|phase:postseason|production_track_a'),
        playedA: slices.compact('prop:points|phase:postseason|played_track_a'),
        playedB: slices.compact('prop:points|phase:postseason|played_track_b'),
      },
    };

    const payload = {
      version: SHADOW_EVAL_VERSION,
      runAt,
      productionUnchanged: true,
      productionCalibrationVersion: getCalibrationVersion(),
      productionCalibrationPath: PRODUCTION_CALIBRATION_RELATIVE_PATH,
      researchCalibrationPath: SHADOW_CALIBRATION_RELATIVE_PATH,
      featureDefinition: definition,
      seasons,
      range: { min: minStart, max: maxStart },
      nScored,
      nNoPrior,
      nPlayers: playerIds.size,
      corpus,
      leakage,
      marketTape: { ...dateRange, nRows: marketRows.length, chronological: cut, fitFraction },
      wouldHaveShipped,
      byProp,
      segments,
      bootstrap,
      rawProbability: { allOverlap: rawAll, byProp: rawByProp },
      probabilityStagesHoldout: { all: stagesHoldout, byProp: stagesHoldoutByProp, nHoldout: holdout.length, nFit: fitRows.length },
      researchCalibration: calPayload,
      threePmShrinkage: {
        chronological: {
          cutIso: threeChrono.cutIso,
          uniqueStarts: threeChrono.uniqueStarts,
          fitStarts: threeChrono.fitStarts,
          holdStarts: threeChrono.holdStarts,
        },
        note: 'Shrinkage is market-independent. reliability = n_played / (n_played + k). Chronological 70% unique start_time split on basketball games.',
        fullSample: Object.fromEntries(
          Object.entries(byProp['3PM'] ?? {}).filter(([k]) => k.startsWith('shrink') || k.includes('track'))
        ),
        holdout: {
          production_track_a: compact(
            computeMetricBlock(
              overall.get('prop:threes|holdout|production_track_a'),
              overall.get('prop:threes|holdout|production_track_a').length
            )
          ),
          played_track_a: compact(
            computeMetricBlock(
              overall.get('prop:threes|holdout|played_track_a'),
              overall.get('prop:threes|holdout|played_track_a').length
            )
          ),
          ...Object.fromEntries(
            THREE_SHRINK_K.flatMap((k) => [
              [
                `shrink_league_k${k}`,
                compact(
                  computeMetricBlock(
                    overall.get(`prop:threes|holdout|shrink_league_k${k}`),
                    overall.get(`prop:threes|holdout|shrink_league_k${k}`).length
                  )
                ),
              ],
              [
                `shrink_season_k${k}`,
                compact(
                  computeMetricBlock(
                    overall.get(`prop:threes|holdout|shrink_season_k${k}`),
                    overall.get(`prop:threes|holdout|shrink_season_k${k}`).length
                  )
                ),
              ],
            ])
          ),
        },
      },
      postseason: postseasonOut,
      confidenceTiersPlayedB: confidence,
      evDiagnostic,
      productionCandidate: null as string | null,
      notes: {
        meanIndependentOfMarket: true,
        rawProbabilityUsesLineAsThreshold: true,
        anchoredIsNotIndependent: true,
        mismatchedCalibrationIsDiagnosticOnly: true,
        deltaClass:
          'materially better: ΔMAE ≤ -0.03; marginal: -0.03 < Δ ≤ -0.01; tied: |Δ| < 0.01; worse: Δ ≥ 0.01. Not a significance test; bootstrap CI reported when computed.',
      },
    };

    const anyBMaterial = Object.values(wouldHaveShipped).some((v) => v.classification === 'materially better');
    const anyBMarginal = Object.values(wouldHaveShipped).some((v) => v.classification === 'marginal');
    const threeNeedsShrink = (byProp['3PM']?.played_track_a?.mae ?? 0) > (byProp['3PM']?.production_track_a?.mae ?? 0);
    payload.productionCandidate = anyBMaterial
      ? 'D. Use prop-specific shadow baselines (more validation needed before shipping)'
      : threeNeedsShrink
        ? 'E. More validation needed'
        : anyBMarginal
          ? 'D. Use prop-specific shadow baselines'
          : 'B. Shadow played-only Track A';

    const jsonPath = join(process.cwd(), 'reports/model-validation/played-only-shadow-pipeline.json');
    writeFileSync(jsonPath, JSON.stringify(payload, null, 2) + '\n', 'utf-8');

    const md: string[] = [];
    md.push('# Played-only shadow projection pipeline');
    md.push('');
    md.push(`Run: ${runAt}`);
    md.push(`Research version: \`${SHADOW_EVAL_VERSION}\`. Feature definition: **${definition}** as-of tipoff.`);
    md.push(`Seasons ${seasons.join(', ')}. Range ${minStart} → ${maxStart}.`);
    md.push(`Scored: **${nScored}** played player-games with ≥1 prior played game (${playerIds.size} players).`);
    md.push('**Production was not changed.** Track A, Track B.1, `getPlayerPropModelInputs()`, APIs, UI, ingestion, and `ev-calibration-artifacts.json` were not edited or overwritten.');
    md.push('');
    md.push('## Pipeline (research only)');
    md.push('');
    md.push('played-only historical inputs → Track A mean → raw P via existing Normal CDF → research calibration → optional market anchoring → research EV');
    md.push('');
    md.push('The projection **mean is market-independent**. The sportsbook line is used only as the probability threshold `P(stat > line)`, then for calibration/anchoring/EV.');
    md.push('');
    md.push('| Quantity | Sportsbook? |');
    md.push('| --- | --- |');
    md.push('| Court Context mean | independent |');
    md.push('| Raw model probability | line is the threshold only |');
    md.push('| Calibrated probability | derived from model P |');
    md.push('| Anchored probability | explicitly market-influenced |');
    md.push('| EV | market-dependent |');
    md.push('');
    md.push('Do not call anchored probability an independent Court Context probability.');
    md.push('');
    md.push('## 1. Clean Track A vs Clean Track B');
    md.push('');
    md.push(`ΔMAE = Played-only Track B − Played-only Track A. Negative = B better. Classification: ${payload.notes.deltaClass}`);
    md.push('');
    md.push(
      mdTable(
        ['Prop', 'Prod A MAE', 'Prod B MAE', 'Played A MAE', 'Played B MAE', 'Δ B−A', 'Class', 'Bootstrap 95% CI', 'Preferred'],
        SUPPORTED_PROP_TYPES.map((prop) => {
          const label = PROP_TYPE_LABEL[prop];
          const w = wouldHaveShipped[label];
          const ci =
            w.bootstrap.ciLow != null && w.bootstrap.ciHigh != null
              ? `[${fmt(w.bootstrap.ciLow, 3)}, ${fmt(w.bootstrap.ciHigh, 3)}]`
              : 'n/a';
          return [
            label,
            fmt(w.productionTrackA.mae),
            fmt(w.productionTrackB.mae),
            fmt(w.playedTrackA.mae),
            fmt(w.playedTrackB.mae),
            fmt(w.deltaPlayedBMinusA, 4),
            w.classification,
            ci,
            w.preferredCleanBaseline === 'played_track_a' ? 'Track A' : 'Track B',
          ];
        })
      )
    );
    md.push('');
    const bEarns = Object.values(wouldHaveShipped).some((v) => v.classification === 'materially better');
    md.push(
      bEarns
        ? 'Track B earns added complexity on at least one prop at the 0.03 MAE bar.'
        : 'Track B does **not** earn its complexity once inputs are clean: played-only B is tied or only marginally different from played-only A on every prop.'
    );
    md.push('');
    md.push('## 2. Preferred baseline by prop');
    md.push('');
    md.push(
      mdTable(
        ['Prop', 'Preferred clean baseline', 'Why'],
        SUPPORTED_PROP_TYPES.map((prop) => {
          const label = PROP_TYPE_LABEL[prop];
          const w = wouldHaveShipped[label];
          return [
            label,
            w.preferredCleanBaseline === 'played_track_a' ? 'Played-only Track A' : 'Played-only Track B',
            `${w.classification} (Δ ${fmt(w.deltaPlayedBMinusA, 4)})`,
          ];
        })
      )
    );
    md.push('');
    md.push('## 12. Would-have-shipped MAE / bias');
    md.push('');
    for (const prop of SUPPORTED_PROP_TYPES) {
      const label = PROP_TYPE_LABEL[prop];
      const w = wouldHaveShipped[label];
      md.push(`### ${label}`);
      md.push('');
      md.push(
        mdTable(
          ['Model', 'MAE', 'RMSE', 'Bias', 'Median AE', 'Coverage', 'N'],
          [
            ['Production Track A', fmt(w.productionTrackA.mae), fmt(w.productionTrackA.rmse), fmt(w.productionTrackA.bias), fmt(w.productionTrackA.medianAe), fmt(w.productionTrackA.coverage, 3), String(w.productionTrackA.n)],
            ['Production Track B', fmt(w.productionTrackB.mae), fmt(w.productionTrackB.rmse), fmt(w.productionTrackB.bias), fmt(w.productionTrackB.medianAe), fmt(w.productionTrackB.coverage, 3), String(w.productionTrackB.n)],
            ['Played-only Track A', fmt(w.playedTrackA.mae), fmt(w.playedTrackA.rmse), fmt(w.playedTrackA.bias), fmt(w.playedTrackA.medianAe), fmt(w.playedTrackA.coverage, 3), String(w.playedTrackA.n)],
            ['Played-only Track B', fmt(w.playedTrackB.mae), fmt(w.playedTrackB.rmse), fmt(w.playedTrackB.bias), fmt(w.playedTrackB.medianAe), fmt(w.playedTrackB.coverage, 3), String(w.playedTrackB.n)],
          ]
        )
      );
      md.push('');
      md.push(`Preferred clean baseline: **${w.preferredCleanBaseline === 'played_track_a' ? 'Track A' : 'Track B'}**`);
      md.push('');
    }

    md.push('## 3. Probability impact (raw, all market overlap, no anchor)');
    md.push('');
    md.push(`Market tape: ${dateRange.min ?? 'n/a'} → ${dateRange.max ?? 'n/a'} (${marketRows.length} rows). Thin. Not season-long proof.`);
    md.push('');
    md.push(
      mdTable(
        ['Model', 'Brier', 'ECE', 'Log loss', 'N'],
        [
          ['Production Track A raw', fmt(rawAll.productionTrackA.brier, 4), fmt(rawAll.productionTrackA.ece, 4), fmt(rawAll.productionTrackA.logLoss, 4), String(rawAll.productionTrackA.n)],
          ['Production Track B raw', fmt(rawAll.productionTrackB.brier, 4), fmt(rawAll.productionTrackB.ece, 4), fmt(rawAll.productionTrackB.logLoss, 4), String(rawAll.productionTrackB.n)],
          ['Played-only Track A raw', fmt(rawAll.playedTrackA.brier, 4), fmt(rawAll.playedTrackA.ece, 4), fmt(rawAll.playedTrackA.logLoss, 4), String(rawAll.playedTrackA.n)],
          ['Played-only Track B raw', fmt(rawAll.playedTrackB.brier, 4), fmt(rawAll.playedTrackB.ece, 4), fmt(rawAll.playedTrackB.logLoss, 4), String(rawAll.playedTrackB.n)],
        ]
      )
    );
    md.push('');
    md.push('## 4–5. Calibration and market-anchor contribution (held-out chronological rows)');
    md.push('');
    md.push(`Split: unique start times, fitFraction=${fitFraction}, cut=${cut.cutIso ?? 'n/a'}. Fit rows ${fitRows.length}, holdout ${holdout.length}. Never random-split.`);
    md.push('Production calibration on played-only raw P is labeled **mismatched calibration** and is diagnostic only.');
    md.push(`Research refit family: \`p = slope * p_raw + intercept\` with identity shrink λ=${CALIBRATION_SHRINK_LAMBDA} (same as production fitter). Saved to \`${SHADOW_CALIBRATION_RELATIVE_PATH}\`, not \`${PRODUCTION_CALIBRATION_RELATIVE_PATH}\`.`);
    md.push('');
    md.push(
      mdTable(
        ['Stage', 'Brier', 'ECE', 'Log loss', 'N'],
        STAGE_IDS.map((s) => [
          s,
          fmt(stagesHoldout[s].brier, 4),
          fmt(stagesHoldout[s].ece, 4),
          fmt(stagesHoldout[s].logLoss, 4),
          String(stagesHoldout[s].n),
        ])
      )
    );
    md.push('');
    const brierRaw = stagesHoldout.played_a_raw.brier;
    const brierMis = stagesHoldout.played_a_mismatched_cal.brier;
    const brierRefit = stagesHoldout.played_a_research_cal.brier;
    const brierAnch = stagesHoldout.played_a_research_cal_anchored.brier;
    const brierProdAnch = stagesHoldout.production_anchored.brier;
    md.push(
      `Mismatched production calibration vs played-only raw: Brier ${fmt(brierMis, 4)} vs ${fmt(brierRaw, 4)}.`
    );
    md.push(
      `Research refit vs mismatched: Brier ${fmt(brierRefit, 4)} vs ${fmt(brierMis, 4)}.`
    );
    md.push(
      `Anchor after research refit: Brier ${fmt(brierAnch, 4)} (production anchored ${fmt(brierProdAnch, 4)}). Good calibration after anchoring is **not** an independent model edge.`
    );
    md.push('');
    md.push('## 6. 3PM shrinkage (market-independent)');
    md.push('');
    md.push('Do not preserve fake DNP zeros. Explicit shrinkage: `reliability * player_projection + (1-r) * center`, `r = n/(n+k)`, k ∈ {5,10,20}.');
    md.push('');
    const threeRows = [
      ['Production Track A', fmt(byProp['3PM']?.production_track_a?.mae), fmt(byProp['3PM']?.production_track_a?.bias), String(byProp['3PM']?.production_track_a?.n ?? 0)],
      ['Played-only Track A', fmt(byProp['3PM']?.played_track_a?.mae), fmt(byProp['3PM']?.played_track_a?.bias), String(byProp['3PM']?.played_track_a?.n ?? 0)],
    ];
    for (const k of THREE_SHRINK_K) {
      threeRows.push([
        `Shrink → league k=${k}`,
        fmt(byProp['3PM']?.[`shrink_league_k${k}`]?.mae),
        fmt(byProp['3PM']?.[`shrink_league_k${k}`]?.bias),
        String(byProp['3PM']?.[`shrink_league_k${k}`]?.n ?? 0),
      ]);
      threeRows.push([
        `Shrink → player season k=${k}`,
        fmt(byProp['3PM']?.[`shrink_season_k${k}`]?.mae),
        fmt(byProp['3PM']?.[`shrink_season_k${k}`]?.bias),
        String(byProp['3PM']?.[`shrink_season_k${k}`]?.n ?? 0),
      ]);
    }
    md.push(mdTable(['Model', 'MAE', 'Bias', 'N'], threeRows));
    md.push('');
    md.push(`Chronological holdout (70% unique start times, cut ${threeChrono.cutIso ?? 'n/a'}):`);
    md.push('');
    const threeHold = payload.threePmShrinkage.holdout as Record<string, { mae: number | null; bias: number | null; n: number }>;
    const threeHoldRows = [
      ['Production Track A', fmt(threeHold.production_track_a?.mae), fmt(threeHold.production_track_a?.bias), String(threeHold.production_track_a?.n ?? 0)],
      ['Played-only Track A', fmt(threeHold.played_track_a?.mae), fmt(threeHold.played_track_a?.bias), String(threeHold.played_track_a?.n ?? 0)],
    ];
    for (const k of THREE_SHRINK_K) {
      threeHoldRows.push([
        `Shrink → league k=${k}`,
        fmt(threeHold[`shrink_league_k${k}`]?.mae),
        fmt(threeHold[`shrink_league_k${k}`]?.bias),
        String(threeHold[`shrink_league_k${k}`]?.n ?? 0),
      ]);
      threeHoldRows.push([
        `Shrink → player season k=${k}`,
        fmt(threeHold[`shrink_season_k${k}`]?.mae),
        fmt(threeHold[`shrink_season_k${k}`]?.bias),
        String(threeHold[`shrink_season_k${k}`]?.n ?? 0),
      ]);
    }
    md.push(mdTable(['Model (holdout)', 'MAE', 'Bias', 'N'], threeHoldRows));
    md.push('');
    md.push('## 7. Postseason diagnostic (no adjustment added)');
    md.push('');
    md.push(
      mdTable(
        ['', 'Value'],
        [
          ['N played postseason games', String(postseasonOut.nGames)],
          ['Starter share (known role)', fmt(postseasonOut.starterShare, 3)],
          ['High-minute share (≥28)', fmt(postseasonOut.highMinuteShare, 3)],
          ['Mean actual minutes', fmt(postseasonOut.meanActualMinutes)],
          ['Mean prior played games', fmt(postseasonOut.meanPriorPlayed)],
          ['PTS n', String(postseasonOut.pts.n)],
          ['PTS mean actual', fmt(postseasonOut.pts.meanActual)],
          ['PTS mean production A', fmt(postseasonOut.pts.meanProductionA)],
          ['PTS mean played-only A', fmt(postseasonOut.pts.meanPlayedA)],
          ['PTS production A MAE / bias', `${fmt(postseasonOut.pts.productionA.mae)} / ${fmt(postseasonOut.pts.productionA.bias)}`],
          ['PTS played-only A MAE / bias', `${fmt(postseasonOut.pts.playedA.mae)} / ${fmt(postseasonOut.pts.playedA.bias)}`],
          ['PTS played-only B MAE / bias', `${fmt(postseasonOut.pts.playedB.mae)} / ${fmt(postseasonOut.pts.playedB.bias)}`],
        ]
      )
    );
    md.push('');
    md.push('DNP zeros shrink playoff projections toward 0. Played-only removes that accidental regularizer. If played-only over-projects playoff minutes/usage, that is a role/minutes problem — not a reason to keep `"00"` in counting averages.');
    md.push('');
    md.push('## 8. Confidence tier validation (played-only Track B, market overlap)');
    md.push('');
    md.push(
      mdTable(
        ['Prop', 'Tier', 'N', 'MAE', 'RMSE', 'Bias', 'Directional hit'],
        SUPPORTED_PROP_TYPES.flatMap((prop) => {
          const label = PROP_TYPE_LABEL[prop];
          return (['high', 'medium', 'low'] as const).map((tier) => {
            const c = confidence[label][tier];
            return [label, tier, String(c.n), fmt(c.mae), fmt(c.rmse), fmt(c.bias), fmt(c.directionalHit, 3)];
          });
        })
      )
    );
    md.push('');
    md.push('## 9. Segment stability (played-only A vs B)');
    md.push('');
    for (const slice of segmentKeys) {
      md.push(`### ${slice}`);
      md.push('');
      md.push(
        mdTable(
          ['Prop', 'A MAE', 'B MAE', 'Δ B−A', 'N(A)'],
          SUPPORTED_PROP_TYPES.map((prop) => {
            const label = PROP_TYPE_LABEL[prop];
            const a = segments[label][slice].played_track_a;
            const b = segments[label][slice].played_track_b;
            const d = a.mae != null && b.mae != null ? b.mae - a.mae : null;
            return [label, fmt(a.mae), fmt(b.mae), fmt(d, 4), String(a.n)];
          })
        )
      );
      md.push('');
    }
    md.push('## 10. Production candidate');
    md.push('');
    md.push(`**${payload.productionCandidate}**`);
    md.push('');
    md.push('This is a recommendation only. **Do not implement the switch.**');
    md.push('');
    md.push('## 11. Required migration sequence (if we later ship)');
    md.push('');
    md.push('1. Played-game input semantics in `getPlayerPropModelInputs()` / log windows (`"00"` DNP out; `"0"` and 0-stat appearances in)');
    md.push('2. Shadow mean serving (Track A, possibly prop-specific 3PM shrinkage) behind a flag');
    md.push('3. Calibration **refit** on the new raw probabilities (do not reuse `ev-calibration-artifacts.json`)');
    md.push('4. Probability validation (Brier/ECE on a later market window)');
    md.push('5. EV validation on a later tape — do not tune to this thin overlap');
    md.push('6. Production switch + confidence redesign if tiers remain unordered');
    md.push('');
    md.push('## 12. Files that would need production changes');
    md.push('');
    md.push('List only — **not edited in this task**:');
    md.push('');
    md.push('- `lib/betting/player-prop-inputs.ts` (`getPlayerPropModelInputs`, last10/last5/season windows)');
    md.push('- `lib/players/` analytics game-log fetchers if they currently return DNP roster rows in L10');
    md.push('- `lib/betting/ev-calibration-artifacts.json` (refit after mean change; do not reuse)');
    md.push('- `scripts/fit-ev-calibration.ts` (fit SQL currently averages DNP-inclusive logs)');
    md.push('- `lib/betting/player-prop-ev-row.ts` only if serving should expose shadow stages');
    md.push('- Prop APIs / UI copy only if confidence labels or input footnotes change');
    md.push('');
    md.push('Not required for a played-only Track A mean: `lib/betting/player-prop-model.ts` (Track A formula), `lib/betting/track-b1-policy.ts` (unless shipping Track B on clean inputs).');
    md.push('');
    md.push('## Leakage counters');
    md.push('');
    md.push(
      mdTable(
        ['Check', 'Count'],
        [
          ['Target game in features', String(leakage.targetGameInFeatures)],
          ['Later games in features', String(leakage.laterGamesInFeatures)],
          ['DNP retained in played-only inputs', String(leakage.dnpRetainedInPlayedInputs)],
          ['Valid 0-stat played games dropped', String(leakage.zeroStatPlayedDropped)],
          ['Post-tip market lines in overlap', String(leakage.postTipMarketLines)],
          ['Season-average table used', 'false'],
          ['Sportsbook used in mean', 'false'],
        ]
      )
    );
    md.push('');
    md.push('## Shadow EV diagnostic (thin tape — do not optimize)');
    md.push('');
    md.push(
      mdTable(
        ['Pipeline stage', 'N', '+EV n', 'Avg EV', 'Hit rate', '+EV hit', '+EV unit return'],
        [
          ['Production anchored', String(evDiagnostic.productionAnchored.n), String(evDiagnostic.productionAnchored.nPositiveEv), fmt(evDiagnostic.productionAnchored.avgEstimatedEv, 4), fmt(evDiagnostic.productionAnchored.directionalHitRate, 3), fmt(evDiagnostic.productionAnchored.positiveEvHitRate, 3), fmt(evDiagnostic.productionAnchored.realizedUnitReturnPositiveEv, 4)],
          ['Played-only A raw', String(evDiagnostic.playedARaw.n), String(evDiagnostic.playedARaw.nPositiveEv), fmt(evDiagnostic.playedARaw.avgEstimatedEv, 4), fmt(evDiagnostic.playedARaw.directionalHitRate, 3), fmt(evDiagnostic.playedARaw.positiveEvHitRate, 3), fmt(evDiagnostic.playedARaw.realizedUnitReturnPositiveEv, 4)],
          ['Played-only A mismatched cal', String(evDiagnostic.playedAMismatchedCal.n), String(evDiagnostic.playedAMismatchedCal.nPositiveEv), fmt(evDiagnostic.playedAMismatchedCal.avgEstimatedEv, 4), fmt(evDiagnostic.playedAMismatchedCal.directionalHitRate, 3), fmt(evDiagnostic.playedAMismatchedCal.positiveEvHitRate, 3), fmt(evDiagnostic.playedAMismatchedCal.realizedUnitReturnPositiveEv, 4)],
          ['Played-only A research cal', String(evDiagnostic.playedAResearchCal.n), String(evDiagnostic.playedAResearchCal.nPositiveEv), fmt(evDiagnostic.playedAResearchCal.avgEstimatedEv, 4), fmt(evDiagnostic.playedAResearchCal.directionalHitRate, 3), fmt(evDiagnostic.playedAResearchCal.positiveEvHitRate, 3), fmt(evDiagnostic.playedAResearchCal.realizedUnitReturnPositiveEv, 4)],
          ['Played-only A research cal + anchor', String(evDiagnostic.playedAResearchCalAnchored.n), String(evDiagnostic.playedAResearchCalAnchored.nPositiveEv), fmt(evDiagnostic.playedAResearchCalAnchored.avgEstimatedEv, 4), fmt(evDiagnostic.playedAResearchCalAnchored.directionalHitRate, 3), fmt(evDiagnostic.playedAResearchCalAnchored.positiveEvHitRate, 3), fmt(evDiagnostic.playedAResearchCalAnchored.realizedUnitReturnPositiveEv, 4)],
        ]
      )
    );
    md.push('');
    md.push('Repro: `npm run evaluate:shadow-projection`');
    md.push('');

    const mdPath = join(process.cwd(), 'reports/model-validation/played-only-shadow-pipeline.md');
    writeFileSync(mdPath, md.join('\n'), 'utf-8');
    console.log(`Wrote ${jsonPath}`);
    console.log(`Wrote ${mdPath}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
