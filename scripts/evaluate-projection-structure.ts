/**
 * Research-only: played-game counting baselines vs minutes × rate.
 *
 * Does not change production formulas, calibration, APIs, UI, or archival.
 *
 *   npm run evaluate:projection-structure
 *   npx tsx scripts/evaluate-projection-structure.ts --season 2025 --limit 2000
 */
import 'dotenv/config';

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import {
  PROP_TYPE_LABEL,
  SUPPORTED_PROP_TYPES,
  computeMetricBlock,
  consensusMarketLine,
  filterPregameLines,
  statFromLog,
  type BookPregameLine,
  type FeatureDefinition,
} from '../lib/betting/player-projection-eval';
import { propTypeToStatKey } from '../lib/betting/track-b1-policy';
import {
  PLAYED_GAME_DEFINITION,
  POSTSEASON_START_ET,
  actualPerMinuteRate,
  classifyAppearance,
  comboComponentProjection,
  isPlayedGame,
  isPostseasonGame,
  parseMinutes,
  pearson,
  playedMinutesBucket,
  rateBasedProjection,
  reconstructAsOfUsage,
  type MinutesEvalLog,
} from '../lib/betting/minutes-projection-eval';

const STRUCTURE_MODELS = [
  'current_season',
  'current_l10',
  'current_track_a',
  'played_season',
  'played_l10',
  'played_l5',
  'played_track_a',
  'm1_l5min_season_rate',
  'm2_l5min_l10_rate',
  'm3_l5min_blended_rate',
  'm4_tamin_season_rate',
  'm5_tamin_l10_rate',
  'm6_tamin_blended_rate',
  'l5min_l5_rate',
  'tamin_mean_game_blended',
  'tamin_season_rate_min3',
  'tamin_season_rate_min5',
  'actual_min_blended',
  'l5min_actual_rate',
  'tamin_actual_rate',
  'played_ta_components',
  'm3_components',
  'market_line',
] as const;
type StructureModel = (typeof STRUCTURE_MODELS)[number];

const MODEL_LABEL: Record<StructureModel, string> = {
  current_season: 'Current Season Avg',
  current_l10: 'Current L10',
  current_track_a: 'Current Track A',
  played_season: 'Played-only Season Avg',
  played_l10: 'Played-only L10',
  played_l5: 'Played-only L5',
  played_track_a: 'Played-only Track A',
  m1_l5min_season_rate: 'L5 min × Season Rate',
  m2_l5min_l10_rate: 'L5 min × L10 Rate',
  m3_l5min_blended_rate: 'L5 min × Blended Rate',
  m4_tamin_season_rate: 'Track-A min × Season Rate',
  m5_tamin_l10_rate: 'Track-A min × L10 Rate',
  m6_tamin_blended_rate: 'Track-A min × Blended Rate',
  l5min_l5_rate: 'L5 min × L5 Rate',
  tamin_mean_game_blended: 'Track-A min × Mean-game Blended Rate',
  tamin_season_rate_min3: 'Track-A min × Season Rate (≥3 min history)',
  tamin_season_rate_min5: 'Track-A min × Season Rate (≥5 min history)',
  actual_min_blended: 'Actual minutes × Blended Rate',
  l5min_actual_rate: 'L5 min × Actual Rate',
  tamin_actual_rate: 'Track-A min × Actual Rate',
  played_ta_components: 'Played-only Track A (summed components)',
  m3_components: 'L5 min × Blended (summed components)',
  market_line: 'Market Line',
};

const MINUTES_RATE_MODELS: StructureModel[] = [
  'm1_l5min_season_rate',
  'm2_l5min_l10_rate',
  'm3_l5min_blended_rate',
  'm4_tamin_season_rate',
  'm5_tamin_l10_rate',
  'm6_tamin_blended_rate',
];

const PRIMARY_TABLE: StructureModel[] = [
  'current_season',
  'current_l10',
  'current_track_a',
  'played_season',
  'played_l10',
  'played_l5',
  'played_track_a',
  'm4_tamin_season_rate',
  'm5_tamin_l10_rate',
  'm6_tamin_blended_rate',
];

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

function compact(pairs: Array<{ projection: number | null; actual: number }>) {
  const m = computeMetricBlock(pairs, pairs.length);
  return {
    mae: round4(m.mae),
    rmse: round4(m.rmse),
    bias: round4(m.bias),
    medianAe: round4(m.medianAe),
    p90Ae: round4(m.p90Ae),
    coverage: round4(m.coverage),
    n: m.nScored,
    nEligible: m.nEligible,
  };
}

function iso(v: Date | string | null | undefined): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
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
      return {
        mae: null,
        rmse: null,
        bias: null,
        medianAe: null,
        p90Ae: null,
        coverage: 0,
        n: 0,
        nEligible: 0,
      };
    }
    return {
      mae: round4(s.abs / s.n),
      rmse: round4(Math.sqrt(s.sq / s.n)),
      bias: round4(s.err / s.n),
      medianAe: null,
      p90Ae: null,
      coverage: 1,
      n: s.n,
      nEligible: s.n,
    };
  }
}

function mdTable(headers: string[], rows: string[][]): string {
  const all = [headers, ...rows];
  const widths = headers.map((_, i) => Math.max(...all.map((r) => (r[i] ?? '').length)));
  const line = (r: string[]) =>
    `| ${r.map((c, i) => (c ?? '').padEnd(widths[i])).join(' | ')} |`;
  const sep = `| ${widths.map((w) => '-'.repeat(w)).join(' | ')} |`;
  return [line(headers), sep, ...rows.map(line)].join('\n');
}

function usageBand(seasonMinutes: number | null): 'high' | 'low' | 'mid' | 'unknown' {
  if (seasonMinutes == null) return 'unknown';
  if (seasonMinutes >= 28) return 'high';
  if (seasonMinutes < 15) return 'low';
  return 'mid';
}

type LineRow = {
  game_id: string;
  player_id: string;
  prop_type: string;
  sportsbook: string;
  line_value: string | number;
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
  field_goals_attempted: number | null;
  free_throws_attempted: number | null;
};

async function main() {
  const runAt = new Date().toISOString();
  const seasonArg = argValue('--season');
  const from = argValue('--from');
  const to = argValue('--to');
  const limit = argValue('--limit') ? Number(argValue('--limit')) : null;
  const definition = (argValue('--feature-definition') ?? 'active_season') as FeatureDefinition;
  if (definition !== 'active_season' && definition !== 'career') {
    throw new Error('--feature-definition must be active_season or career');
  }

  const url = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('SUPABASE_DB_URL or DATABASE_URL required');
  const pool = new Pool({ connectionString: url, max: 4 });
  const seasons = seasonArg ? [seasonArg] : ['2023', '2024', '2025'];

  try {
    console.log(`Loading Final logs seasons=${seasons.join(',')} definition=${definition}`);
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
        l.three_pointers_made,
        l.field_goals_attempted,
        l.free_throws_attempted
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
      SELECT game_id::text, player_id::text, prop_type, sportsbook, line_value, decision_at, game_start_time
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
        oddsAmerican: null,
        oddsDecimal: null,
        decisionAt: iso(row.decision_at),
      });
      linesByOpp.set(key, list);
    }

    const gamesByPlayer = new Map<string, MinutesEvalLog[]>();
    const seenLog = new Set<string>();
    let duplicateLogs = 0;
    const corpus = { n: 0, played: 0, dnp: 0, malformed: 0, zeroPointPlayed: 0, token00: 0, token0: 0 };
    for (const row of logRes.rows) {
      const k = `${row.player_id}|${row.game_id}`;
      if (seenLog.has(k)) {
        duplicateLogs += 1;
        continue;
      }
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
        field_goals_attempted: row.field_goals_attempted,
        free_throws_attempted: row.free_throws_attempted,
      };
      const cls = classifyAppearance(g);
      corpus.n += 1;
      if (cls.minutesToken === '00') corpus.token00 += 1;
      if (cls.minutesToken === '0') corpus.token0 += 1;
      if (cls.class === 'played') {
        corpus.played += 1;
        if ((g.points ?? 0) === 0) corpus.zeroPointPlayed += 1;
      } else if (cls.class === 'dnp') corpus.dnp += 1;
      else corpus.malformed += 1;
      const list = gamesByPlayer.get(row.player_id) ?? [];
      list.push(g);
      gamesByPlayer.set(row.player_id, list);
    }

    const fromMs = from ? Date.parse(from) : Number.NEGATIVE_INFINITY;
    const toMs = to ? Date.parse(to) : Number.POSITIVE_INFINITY;
    const targets: MinutesEvalLog[] = [];
    for (const logs of gamesByPlayer.values()) {
      for (const g of logs) {
        const t = Date.parse(g.start_time);
        if (t < fromMs || t > toMs) continue;
        const m = parseMinutes(g.minutes);
        if (m == null || m <= 0) continue;
        targets.push(g);
      }
    }
    targets.sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time));
    const limited = limit != null && Number.isFinite(limit) && limit > 0 ? targets.slice(0, limit) : targets;
    console.log(`Played targets: ${limited.length}`);

    const bag = new PairBag();
    const slices = new RunningBag();
    const absShift: Record<string, number[]> = {};
    const minErr: number[] = [];
    const rateErr: number[] = [];
    const statErr: number[] = [];
    const absMinErr: number[] = [];
    const absRateErr: number[] = [];
    const absStatErr: number[] = [];
    let nScored = 0;
    let nNoPrior = 0;
    let sumPriorLogs = 0;
    let sumPriorDnp = 0;
    let sumDnpInL10 = 0;
    const playerIds = new Set<string>();
    let minStart = '';
    let maxStart = '';

    for (const target of limited) {
      const actualMin = parseMinutes(target.minutes);
      if (actualMin == null || actualMin <= 0) continue;
      const features = reconstructAsOfUsage(
        gamesByPlayer.get(target.player_id) ?? [],
        target,
        definition
      );
      if (!features) {
        nNoPrior += 1;
        continue;
      }
      nScored += 1;
      playerIds.add(target.player_id);
      if (!minStart || target.start_time < minStart) minStart = target.start_time;
      if (!maxStart || target.start_time > maxStart) maxStart = target.start_time;
      sumPriorLogs += features.priorLogCount;
      sumPriorDnp += features.priorDnpCount;
      sumDnpInL10 += features.dnpInCurrentL10;

      const phase = isPostseasonGame(target.season, target.start_time) ? 'postseason' : 'regular';
      const role = !gamesWithStarters.has(target.game_id)
        ? 'unknown'
        : starterKeys.has(`${target.game_id}|${target.player_id}`)
          ? 'starter'
          : 'bench';
      const usage = usageBand(features.minutes.season);
      const minBucket = playedMinutesBucket(actualMin);
      const teamSlices: string[] = features.teamChanged ? ['after_team_change'] : ['no_team_change'];
      const gamesOnTeam = features.gamesOnCurrentTeamIncludingTonight;
      if (features.teamChanged && gamesOnTeam != null && gamesOnTeam <= 10) teamSlices.push('first10_new_team');
      if (features.teamChanged && gamesOnTeam != null && gamesOnTeam <= 5) teamSlices.push('first5_new_team');

      const ptsP = {
        playedTa: features.playedCounting.points.trackA,
        m3: rateBasedProjection(features.minutes.l5, features.rates.points.blended),
        m4: rateBasedProjection(features.minutes.track_a, features.rates.points.season),
      };
      const rebP = {
        playedTa: features.playedCounting.rebounds.trackA,
        m3: rateBasedProjection(features.minutes.l5, features.rates.rebounds.blended),
      };
      const astP = {
        playedTa: features.playedCounting.assists.trackA,
        m3: rateBasedProjection(features.minutes.l5, features.rates.assists.blended),
      };

      for (const prop of SUPPORTED_PROP_TYPES) {
        const key = propTypeToStatKey(prop);
        if (!key) continue;
        const actual = statFromLog(target, key);
        if (actual == null || !Number.isFinite(actual)) continue;
        const current = features.counting[prop];
        const played = features.playedCounting[prop];
        const rates = features.rates[prop];
        const meanRates = features.meanGameRates[prop];
        const eL5 = features.minutes.l5;
        const eTa = features.minutes.track_a;
        const actualRate = actualPerMinuteRate(actual, actualMin);
        const marketLines = linesByOpp.get(`${target.game_id}|${target.player_id}|${prop}`) ?? [];
        const consensus = consensusMarketLine(
          filterPregameLines(marketLines, target.start_time),
          target.start_time
        );

        let componentsPlayed: number | null = null;
        let componentsM3: number | null = null;
        if (prop === 'points_rebounds_assists') {
          componentsPlayed = comboComponentProjection(ptsP.playedTa, rebP.playedTa, astP.playedTa, 'pra');
          componentsM3 = comboComponentProjection(ptsP.m3, rebP.m3, astP.m3, 'pra');
        } else if (prop === 'points_assists') {
          componentsPlayed = comboComponentProjection(ptsP.playedTa, null, astP.playedTa, 'pa');
          componentsM3 = comboComponentProjection(ptsP.m3, null, astP.m3, 'pa');
        } else if (prop === 'points_rebounds') {
          componentsPlayed = comboComponentProjection(ptsP.playedTa, rebP.playedTa, null, 'pr');
          componentsM3 = comboComponentProjection(ptsP.m3, rebP.m3, null, 'pr');
        } else if (prop === 'rebounds_assists') {
          componentsPlayed = comboComponentProjection(null, rebP.playedTa, astP.playedTa, 'ra');
          componentsM3 = comboComponentProjection(null, rebP.m3, astP.m3, 'ra');
        } else if (prop === 'points') {
          componentsPlayed = played.trackA;
          componentsM3 = rateBasedProjection(eL5, rates.blended);
        }

        const projections: Record<StructureModel, number | null> = {
          current_season: current.season,
          current_l10: current.l10,
          current_track_a: current.trackA,
          played_season: played.season,
          played_l10: played.l10,
          played_l5: played.l5,
          played_track_a: played.trackA,
          m1_l5min_season_rate: rateBasedProjection(eL5, rates.season),
          m2_l5min_l10_rate: rateBasedProjection(eL5, rates.l10),
          m3_l5min_blended_rate: rateBasedProjection(eL5, rates.blended),
          m4_tamin_season_rate: rateBasedProjection(eTa, rates.season),
          m5_tamin_l10_rate: rateBasedProjection(eTa, rates.l10),
          m6_tamin_blended_rate: rateBasedProjection(eTa, rates.blended),
          l5min_l5_rate: rateBasedProjection(eL5, rates.l5),
          tamin_mean_game_blended: rateBasedProjection(eTa, meanRates.blended),
          tamin_season_rate_min3: rateBasedProjection(eTa, features.ratesMin3[prop].season),
          tamin_season_rate_min5: rateBasedProjection(eTa, features.ratesMin5[prop].season),
          actual_min_blended: rateBasedProjection(actualMin, rates.blended),
          l5min_actual_rate: rateBasedProjection(eL5, actualRate),
          tamin_actual_rate: rateBasedProjection(eTa, actualRate),
          played_ta_components: componentsPlayed,
          m3_components: componentsM3,
          market_line: consensus?.line ?? null,
        };

        if (current.trackA != null && played.trackA != null) {
          const list = absShift[prop] ?? [];
          list.push(Math.abs(current.trackA - played.trackA));
          absShift[prop] = list;
        }

        const sliceKeys = [
          `phase:${phase}`,
          `sample:${features.sampleBucket}`,
          `role:${role}`,
          `usage:${usage}`,
          `minbucket:${minBucket}`,
          ...teamSlices.map((s) => `team:${s}`),
        ];
        const diagnosticModels: StructureModel[] = [
          'current_track_a',
          'played_track_a',
          'm1_l5min_season_rate',
          'm4_tamin_season_rate',
        ];
        for (const model of STRUCTURE_MODELS) {
          const pred = projections[model];
          if (model === 'market_line' && pred == null) continue;
          bag.push(`prop:${prop}|all|${model}`, pred, actual);
        }
        for (const model of diagnosticModels) {
          const pred = projections[model];
          for (const slice of sliceKeys) {
            if (slice === 'all') continue;
            slices.push(`prop:${prop}|${slice}|${model}`, pred, actual);
          }
        }
        if (projections.market_line != null) {
          bag.push(`prop:${prop}|market_overlap|current_track_a`, projections.current_track_a, actual);
          bag.push(`prop:${prop}|market_overlap|played_track_a`, projections.played_track_a, actual);
          bag.push(`prop:${prop}|market_overlap|m4_tamin_season_rate`, projections.m4_tamin_season_rate, actual);
          bag.push(`prop:${prop}|market_overlap|m1_l5min_season_rate`, projections.m1_l5min_season_rate, actual);
          bag.push(`prop:${prop}|market_overlap|market_line`, projections.market_line, actual);
        }

        if (prop === 'points' && eL5 != null && rates.blended != null && actualRate != null) {
          const predStat = rateBasedProjection(eL5, rates.blended);
          if (predStat != null) {
            minErr.push(eL5 - actualMin);
            rateErr.push(rates.blended - actualRate);
            statErr.push(predStat - actual);
            absMinErr.push(Math.abs(eL5 - actualMin));
            absRateErr.push(Math.abs(rates.blended - actualRate));
            absStatErr.push(Math.abs(predStat - actual));
          }
        }
      }
    }

    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const m = (prop: string, slice: string, model: StructureModel) =>
      slice === 'all' || slice === 'market_overlap'
        ? compact(bag.get(`prop:${prop}|${slice}|${model}`))
        : slices.compact(`prop:${prop}|${slice}|${model}`);

    const byProp: Record<string, Record<string, ReturnType<typeof compact>>> = {};
    const decomp: Record<
      string,
      {
        currentTrackA: number | null;
        playedTrackA: number | null;
        bestMinutesRate: { id: StructureModel; label: string; mae: number | null };
        dnpCleanupGain: number | null;
        structuralGain: number | null;
        meanAbsTrackAShift: number | null;
        n: number;
      }
    > = {};

    for (const prop of SUPPORTED_PROP_TYPES) {
      const label = PROP_TYPE_LABEL[prop];
      byProp[label] = {};
      for (const model of STRUCTURE_MODELS) {
        byProp[label][MODEL_LABEL[model]] = m(prop, 'all', model);
      }
      const a = m(prop, 'all', 'current_track_a').mae;
      const b = m(prop, 'all', 'played_track_a').mae;
      let best: { id: StructureModel; mae: number | null } = { id: 'm4_tamin_season_rate', mae: null };
      for (const id of MINUTES_RATE_MODELS) {
        const mae = m(prop, 'all', id).mae;
        if (mae == null) continue;
        if (best.mae == null || mae < best.mae) best = { id, mae };
      }
      decomp[label] = {
        currentTrackA: a,
        playedTrackA: b,
        bestMinutesRate: { id: best.id, label: MODEL_LABEL[best.id], mae: best.mae },
        dnpCleanupGain: a != null && b != null ? round4(a - b) : null,
        structuralGain: b != null && best.mae != null ? round4(b - best.mae) : null,
        meanAbsTrackAShift: round4(mean(absShift[prop] ?? [])),
        n: m(prop, 'all', 'current_track_a').n ?? 0,
      };
    }

    const sliceReport = (prop: string, slicePrefix: string, values: string[]) => {
      const out: Record<string, Record<string, ReturnType<typeof compact>>> = {};
      for (const v of values) {
        out[v] = {
          currentTrackA: m(prop, `${slicePrefix}:${v}`, 'current_track_a'),
          playedTrackA: m(prop, `${slicePrefix}:${v}`, 'played_track_a'),
          m4: m(prop, `${slicePrefix}:${v}`, 'm4_tamin_season_rate'),
          m1: m(prop, `${slicePrefix}:${v}`, 'm1_l5min_season_rate'),
        };
      }
      return out;
    };

    const ptsBest = decomp.PTS.bestMinutesRate.id;
    const recommendation = (() => {
      const d = decomp.PTS;
      if (d.currentTrackA == null || d.playedTrackA == null || d.bestMinutesRate.mae == null) {
        return 'D. MORE VALIDATION NEEDED';
      }
      const dnp = d.dnpCleanupGain ?? 0;
      const structural = d.structuralGain ?? 0;
      const threes = decomp['3PM'];
      const threesStructural = threes.structuralGain ?? 0;
      if (dnp >= 0.12 && structural < 0.08 && threesStructural <= 0.02) {
        return 'A. PLAYED-ONLY TRACK A';
      }
      if (structural >= 0.08 && (threes.bestMinutesRate.mae ?? 99) <= (threes.playedTrackA ?? 0) + 0.02) {
        return 'B. MINUTES × RATE';
      }
      if (Math.abs(threesStructural) > 0.01 && structural >= 0.05) {
        return 'C. PROP-SPECIFIC BASELINES';
      }
      if (structural >= 0.05) return 'B. MINUTES × RATE';
      if (dnp >= 0.05) return 'A. PLAYED-ONLY TRACK A';
      return 'D. MORE VALIDATION NEEDED';
    })();

    const payload = {
      meta: {
        runAt,
        version: 'projection-structure-v1',
        featureDefinition: definition,
        seasons,
        dateRange: { from: from ?? minStart, to: to ?? maxStart },
        sampleSize: {
          finalLogsLoaded: logRes.rows.length,
          duplicateLogs,
          corpus,
          nScored,
          nNoPriorPlayed: nNoPrior,
          nPlayers: playerIds.size,
          limitApplied: limit,
          dnpShareOfCorpus: round4(corpus.n ? corpus.dnp / corpus.n : null),
          meanDnpShareAsOfSeason: round4(nScored ? sumPriorDnp / sumPriorLogs : null),
          meanDnpInCurrentL10: round4(nScored ? sumDnpInL10 / nScored : null),
        },
        playedGameDefinition: PLAYED_GAME_DEFINITION,
        postseasonRule: POSTSEASON_START_ET,
        formulas: {
          currentTrackA: '0.7 * L10_all_final_logs + 0.3 * season_all_final_logs',
          playedTrackA: '0.7 * L10_played + 0.3 * season_played',
          aggregateRate: 'sum(stat)/sum(minutes) on played games with minutes>0',
          m1: 'L5_played_minutes * season_rate',
          m4: 'TrackA_played_minutes * season_rate',
        },
        productionChange: 'none',
      },
      contamination: {
        corpusDnpRows: corpus.dnp,
        corpusPlayedRows: corpus.played,
        corpusMalformedRows: corpus.malformed,
        token00: corpus.token00,
        token0: corpus.token0,
        zeroPointPlayed: corpus.zeroPointPlayed,
        dnpShareOfCorpus: round4(corpus.n ? corpus.dnp / corpus.n : null),
        meanDnpShareInAsOfSeasonWindows: round4(nScored ? sumPriorDnp / sumPriorLogs : null),
        meanDnpCountInCurrentL10Window: round4(nScored ? sumDnpInL10 / nScored : null),
        meanAbsTrackAShiftByProp: Object.fromEntries(
          SUPPORTED_PROP_TYPES.map((p) => [PROP_TYPE_LABEL[p], round4(mean(absShift[p] ?? []))])
        ),
      },
      byProp,
      decomposition: decomp,
      ptsBestMinutesRateModel: { id: ptsBest, label: MODEL_LABEL[ptsBest] },
      segments: {
        PTS: {
          phase: sliceReport('points', 'phase', ['regular', 'postseason']),
          sample: sliceReport('points', 'sample', ['1-4', '5-9', '10-19', '20+']),
          role: sliceReport('points', 'role', ['starter', 'bench', 'unknown']),
          usage: sliceReport('points', 'usage', ['high', 'mid', 'low']),
          team: sliceReport('points', 'team', [
            'no_team_change',
            'after_team_change',
            'first5_new_team',
            'first10_new_team',
          ]),
          actualMinutesBucket: sliceReport('points', 'minbucket', [
            '0-3',
            '3-8',
            '8-15',
            '15-25',
            '25-35',
            '35+',
          ]),
        },
        '3PM': {
          all: {
            currentTrackA: m('threes', 'all', 'current_track_a'),
            playedTrackA: m('threes', 'all', 'played_track_a'),
            m1: m('threes', 'all', 'm1_l5min_season_rate'),
            m2: m('threes', 'all', 'm2_l5min_l10_rate'),
            m3: m('threes', 'all', 'm3_l5min_blended_rate'),
            m4: m('threes', 'all', 'm4_tamin_season_rate'),
            m5: m('threes', 'all', 'm5_tamin_l10_rate'),
            m6: m('threes', 'all', 'm6_tamin_blended_rate'),
            l5minL5rate: m('threes', 'all', 'l5min_l5_rate'),
            playedL10: m('threes', 'all', 'played_l10'),
            playedSeason: m('threes', 'all', 'played_season'),
          },
        },
      },
      combos: Object.fromEntries(
        (['points_rebounds_assists', 'points_assists', 'points_rebounds', 'rebounds_assists'] as const).map(
          (prop) => [
            PROP_TYPE_LABEL[prop],
            {
              directPlayedTrackA: m(prop, 'all', 'played_track_a'),
              summedPlayedTrackA: m(prop, 'all', 'played_ta_components'),
              directM3: m(prop, 'all', 'm3_l5min_blended_rate'),
              summedM3: m(prop, 'all', 'm3_components'),
            },
          ]
        )
      ),
      marketOverlap: Object.fromEntries(
        SUPPORTED_PROP_TYPES.map((prop) => [
          PROP_TYPE_LABEL[prop],
          {
            currentTrackA: compact(bag.get(`prop:${prop}|market_overlap|current_track_a`)),
            playedTrackA: compact(bag.get(`prop:${prop}|market_overlap|played_track_a`)),
            m4: compact(bag.get(`prop:${prop}|market_overlap|m4_tamin_season_rate`)),
            m1: compact(bag.get(`prop:${prop}|market_overlap|m1_l5min_season_rate`)),
            market: compact(bag.get(`prop:${prop}|market_overlap|market_line`)),
          },
        ])
      ),
      errorDecompositionPts: {
        n: statErr.length,
        pearsonAbsMinutesVsStat: round4(pearson(absMinErr, absStatErr)),
        pearsonAbsRateVsStat: round4(pearson(absRateErr, absStatErr)),
        pearsonSignedMinutesVsStat: round4(pearson(minErr, statErr)),
        pearsonSignedRateVsStat: round4(pearson(rateErr, statErr)),
        actualMinXBlended: m('points', 'all', 'actual_min_blended'),
        l5minXActualRate: m('points', 'all', 'l5min_actual_rate'),
        playedTrackA: m('points', 'all', 'played_track_a'),
        l5minXBlended: m('points', 'all', 'm3_l5min_blended_rate'),
      },
      rateWindowPts: {
        season: m('points', 'all', 'm4_tamin_season_rate'),
        l10: m('points', 'all', 'm5_tamin_l10_rate'),
        blended: m('points', 'all', 'm6_tamin_blended_rate'),
        l5rateWithL5min: m('points', 'all', 'l5min_l5_rate'),
        meanGameBlended: m('points', 'all', 'tamin_mean_game_blended'),
        min3: m('points', 'all', 'tamin_season_rate_min3'),
        min5: m('points', 'all', 'tamin_season_rate_min5'),
      },
      recommendation,
    };

    const outDir = join(process.cwd(), 'reports', 'model-validation');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'projection-v2-structure.json'), JSON.stringify(payload, null, 2));
    writeFileSync(join(outDir, 'played-game-baseline.json'), JSON.stringify(payload, null, 2));

    const decompRows = SUPPORTED_PROP_TYPES.map((prop) => {
      const label = PROP_TYPE_LABEL[prop];
      const d = decomp[label];
      return [
        label,
        fmt(d.currentTrackA),
        fmt(d.playedTrackA),
        fmt(d.dnpCleanupGain),
        MODEL_LABEL[d.bestMinutesRate.id],
        fmt(d.bestMinutesRate.mae),
        fmt(d.structuralGain),
      ];
    });

    const md = [
      '# Played-game baseline vs minutes × rate',
      '',
      `Run: ${runAt}`,
      `Feature definition: **${definition}**. Scored player-games (minutes > 0, ≥1 prior played): **${nScored}** / ${playerIds.size} players.`,
      `Seasons: ${seasons.join(', ')}. Range: ${payload.meta.dateRange.from} → ${payload.meta.dateRange.to}.`,
      '',
      '## Played-game definition',
      '',
      PLAYED_GAME_DEFINITION.predicate,
      '',
      `- Corpus Final logs: ${corpus.n}. Played ${corpus.played}. DNP ${corpus.dnp} (${fmt(payload.contamination.dnpShareOfCorpus, 3)}). Malformed ${corpus.malformed}.`,
      `- minutes="00": ${corpus.token00}. minutes="0": ${corpus.token0}. Zero-point played games kept: ${corpus.zeroPointPlayed}.`,
      `- Mean DNP share in as-of season windows: ${fmt(payload.contamination.meanDnpShareInAsOfSeasonWindows, 3)}. Mean DNPs inside current L10 log window: ${fmt(payload.contamination.meanDnpCountInCurrentL10Window, 3)}.`,
      '',
      '## Improvement decomposition (most important)',
      '',
      mdTable(
        ['Prop', 'Current Track A', 'Played-only Track A', 'DNP cleanup A−B', 'Best min×rate', 'That MAE', 'Structural B−C'],
        decompRows
      ),
      '',
      '## PTS primary table',
      '',
      mdTable(
        ['Model', 'MAE', 'Bias', 'N'],
        PRIMARY_TABLE.map((id) => [
          MODEL_LABEL[id],
          fmt(byProp.PTS[MODEL_LABEL[id]].mae),
          fmt(byProp.PTS[MODEL_LABEL[id]].bias),
          String(byProp.PTS[MODEL_LABEL[id]].n ?? 0),
        ])
      ),
      '',
      `Best minutes×rate on PTS: **${MODEL_LABEL[ptsBest]}**.`,
      '',
      '## Recommendation',
      '',
      `**${recommendation}**`,
      '',
      'Production was not changed.',
      '',
    ].join('\n');

    writeFileSync(join(outDir, 'projection-v2-structure.md'), md);
    writeFileSync(join(outDir, 'played-game-baseline.md'), md);

    console.log(`Corpus DNP share=${fmt(payload.contamination.dnpShareOfCorpus)}`);
    console.log(`PTS Current TA=${fmt(decomp.PTS.currentTrackA)} Played TA=${fmt(decomp.PTS.playedTrackA)} DNP gain=${fmt(decomp.PTS.dnpCleanupGain)} best=${MODEL_LABEL[ptsBest]} ${fmt(decomp.PTS.bestMinutesRate.mae)} structural=${fmt(decomp.PTS.structuralGain)}`);
    console.log(`Recommendation: ${recommendation}`);
    console.log(`Wrote ${join(outDir, 'projection-v2-structure.md')}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
