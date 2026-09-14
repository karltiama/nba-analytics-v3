/**
 * Research-only expected-minutes × per-minute-rate evaluation.
 *
 * Does not change production formulas, calibration artifacts, APIs, or UI.
 * Does not use sportsbook lines as projection inputs.
 *
 *   npm run evaluate:minutes-projections
 *   npx tsx scripts/evaluate-minutes-projections.ts --season 2025 --limit 2000
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
  MINUTES_EVAL_VERSION,
  MINUTES_MODEL_IDS,
  MINUTES_MODEL_LABEL,
  POSTSEASON_START_ET,
  STAT_MODEL_IDS,
  STAT_MODEL_LABEL,
  actualPerMinuteRate,
  isPlayedGame,
  isPostseasonGame,
  minutesErrorBucket,
  parseMinutes,
  pearson,
  rateBasedProjection,
  reconstructAsOfUsage,
  type MinutesEvalLog,
  type StatModelId,
} from '../lib/betting/minutes-projection-eval';

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

function fmt(n: number | null | undefined, digits = 3): string {
  if (n == null || !Number.isFinite(n)) return 'n/a';
  return n.toFixed(digits);
}

function pct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return 'n/a';
  return `${(n * 100).toFixed(1)}%`;
}

function round4(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n * 1e4) / 1e4;
}

function compact(m: MetricBlock) {
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

function mdTable(headers: string[], rows: string[][]): string {
  const all = [headers, ...rows];
  const widths = headers.map((_, i) => Math.max(...all.map((r) => (r[i] ?? '').length)));
  const line = (r: string[]) =>
    `| ${r.map((c, i) => (c ?? '').padEnd(widths[i])).join(' | ')} |`;
  const sep = `| ${widths.map((w) => '-'.repeat(w)).join(' | ')} |`;
  return [line(headers), sep, ...rows.map(line)].join('\n');
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

  const seasons = seasonArg
    ? [seasonArg]
    : ['2023', '2024', '2025'];

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
        oddsAmerican: null,
        oddsDecimal: null,
        decisionAt: iso(row.decision_at),
      });
      linesByOpp.set(key, list);
    }

    const gamesByPlayer = new Map<string, MinutesEvalLog[]>();
    const seenLog = new Set<string>();
    let duplicateLogs = 0;
    let skippedNoTime = 0;
    for (const row of logRes.rows) {
      const k = `${row.player_id}|${row.game_id}`;
      if (seenLog.has(k)) {
        duplicateLogs += 1;
        continue;
      }
      seenLog.add(k);
      if (!row.start_time) {
        skippedNoTime += 1;
        continue;
      }
      const list = gamesByPlayer.get(row.player_id) ?? [];
      list.push({
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
      });
      gamesByPlayer.set(row.player_id, list);
    }

    const fromMs = from ? Date.parse(from) : Number.NEGATIVE_INFINITY;
    const toMs = to ? Date.parse(to) : Number.POSITIVE_INFINITY;

    const minutesBag = new PairBag();
    const statBag = new PairBag();
    const identityAbs: number[] = [];
    const minErr: number[] = [];
    const rateErr: number[] = [];
    const statErr: number[] = [];
    const absMinErr: number[] = [];
    const absRateErr: number[] = [];
    const absStatErr: number[] = [];

    let nCandidateLogs = 0;
    let nPlayed = 0;
    let nScoredMinutes = 0;
    let nNoPrior = 0;
    let nDateFiltered = 0;
    const playerIds = new Set<string>();
    let minStart = '';
    let maxStart = '';

    const targets: MinutesEvalLog[] = [];
    for (const logs of gamesByPlayer.values()) {
      for (const g of logs) {
        nCandidateLogs += 1;
        const t = Date.parse(g.start_time);
        if (t < fromMs || t > toMs) {
          nDateFiltered += 1;
          continue;
        }
        if (!isPlayedGame(g)) continue;
        nPlayed += 1;
        targets.push(g);
      }
    }
    targets.sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time));
    const limited = limit != null && Number.isFinite(limit) && limit > 0 ? targets.slice(0, limit) : targets;
    console.log(`Played targets: ${limited.length} (of ${targets.length})`);

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
      nScoredMinutes += 1;
      playerIds.add(target.player_id);
      if (!minStart || target.start_time < minStart) minStart = target.start_time;
      if (!maxStart || target.start_time > maxStart) maxStart = target.start_time;

      const phase = isPostseasonGame(target.season, target.start_time) ? 'postseason' : 'regular';
      const roleKey = `${target.game_id}|${target.player_id}`;
      const role = !gamesWithStarters.has(target.game_id)
        ? 'unknown'
        : starterKeys.has(roleKey)
          ? 'starter'
          : 'bench';
      const teamSlices: string[] = features.teamChanged
        ? ['after_team_change']
        : ['no_team_change'];
      const gamesOnTeam = features.gamesOnCurrentTeamIncludingTonight;
      if (features.teamChanged && gamesOnTeam != null && gamesOnTeam <= 10) {
        teamSlices.push('first10_new_team');
      }
      if (features.teamChanged && gamesOnTeam != null && gamesOnTeam <= 5) {
        teamSlices.push('first5_new_team');
      }

      for (const model of MINUTES_MODEL_IDS) {
        const pred = features.minutes[model];
        minutesBag.push(`all|${model}`, pred, actualMin);
        minutesBag.push(`season:${target.season}|${model}`, pred, actualMin);
        minutesBag.push(`sample:${features.sampleBucket}|${model}`, pred, actualMin);
        minutesBag.push(`phase:${phase}|${model}`, pred, actualMin);
        minutesBag.push(`role:${role}|${model}`, pred, actualMin);
        for (const teamSlice of teamSlices) {
          minutesBag.push(`team:${teamSlice}|${model}`, pred, actualMin);
        }
      }

      const eMin = features.minutes.track_a;
      const minBucket = minutesErrorBucket(eMin, actualMin);

      for (const prop of SUPPORTED_PROP_TYPES) {
        const key = propTypeToStatKey(prop);
        if (!key) continue;
        const actual = statFromLog(target, key);
        if (actual == null || !Number.isFinite(actual)) continue;

        const counting = features.counting[prop];
        const rates = features.rates[prop];
        const marketLines = linesByOpp.get(`${target.game_id}|${target.player_id}|${prop}`) ?? [];
        const consensus = consensusMarketLine(
          filterPregameLines(marketLines, target.start_time),
          target.start_time
        );
        const market = consensus?.line ?? null;

        const projections: Record<StatModelId, number | null> = {
          season_avg: counting.season,
          l10: counting.l10,
          track_a: counting.trackA,
          r1_min_x_season_rate: rateBasedProjection(eMin, rates.season),
          r2_min_x_l10_rate: rateBasedProjection(eMin, rates.l10),
          r3_min_x_blended_rate: rateBasedProjection(eMin, rates.blended),
          perfect_min_x_blended_rate: rateBasedProjection(actualMin, rates.blended),
          track_a_min_x_actual_rate: rateBasedProjection(
            eMin,
            actualPerMinuteRate(actual, actualMin)
          ),
          market_line: market,
        };

        const identity = rateBasedProjection(features.minutes.season, rates.season);
        if (identity != null && counting.season != null) {
          identityAbs.push(Math.abs(identity - counting.season));
        }

        for (const model of STAT_MODEL_IDS) {
          const pred = projections[model];
          if (model === 'market_line' && pred == null) continue;
          statBag.push(`prop:${prop}|all|${model}`, pred, actual);
          statBag.push(`prop:${prop}|season:${target.season}|${model}`, pred, actual);
          statBag.push(`prop:${prop}|sample:${features.sampleBucket}|${model}`, pred, actual);
          statBag.push(`prop:${prop}|phase:${phase}|${model}`, pred, actual);
          for (const teamSlice of teamSlices) {
            statBag.push(`prop:${prop}|team:${teamSlice}|${model}`, pred, actual);
          }
          if (model === 'track_a' || model === 'r3_min_x_blended_rate') {
            statBag.push(`prop:${prop}|minbucket:${minBucket}|${model}`, pred, actual);
          }
          if (model === 'market_line') {
            statBag.push(`prop:${prop}|market_overlap|track_a`, projections.track_a, actual);
            statBag.push(`prop:${prop}|market_overlap|r3_min_x_blended_rate`, projections.r3_min_x_blended_rate, actual);
            statBag.push(`prop:${prop}|market_overlap|market_line`, pred, actual);
          }
        }

        if (prop === 'points' && eMin != null && rates.blended != null) {
          const actualRate = actualPerMinuteRate(actual, actualMin);
          const predStat = rateBasedProjection(eMin, rates.blended);
          if (actualRate != null && predStat != null) {
            minErr.push(eMin - actualMin);
            rateErr.push(rates.blended - actualRate);
            statErr.push(predStat - actual);
            absMinErr.push(Math.abs(eMin - actualMin));
            absRateErr.push(Math.abs(rates.blended - actualRate));
            absStatErr.push(Math.abs(predStat - actual));
          }
        }
      }
    }

    function bagMetrics(bag: PairBag, key: string): ReturnType<typeof compact> {
      return compact(computeMetricBlock(bag.get(key), bag.get(key).length));
    }

    const minutesOverall: Record<string, ReturnType<typeof compact>> = {};
    for (const model of MINUTES_MODEL_IDS) {
      minutesOverall[model] = bagMetrics(minutesBag, `all|${model}`);
    }
    const bestMinutes = MINUTES_MODEL_IDS.slice()
      .filter((id) => minutesOverall[id].mae != null)
      .sort((a, b) => (minutesOverall[a].mae ?? 999) - (minutesOverall[b].mae ?? 999))[0];

    const bySeason: Record<string, Record<string, ReturnType<typeof compact>>> = {};
    for (const season of seasons) {
      bySeason[season] = {};
      for (const model of MINUTES_MODEL_IDS) {
        bySeason[season][model] = bagMetrics(minutesBag, `season:${season}|${model}`);
      }
    }
    const bySample: Record<string, Record<string, ReturnType<typeof compact>>> = {};
    for (const bucket of ['1-4', '5-9', '10-19', '20+']) {
      bySample[bucket] = {};
      for (const model of MINUTES_MODEL_IDS) {
        bySample[bucket][model] = bagMetrics(minutesBag, `sample:${bucket}|${model}`);
      }
    }
    const byPhase: Record<string, Record<string, ReturnType<typeof compact>>> = {};
    for (const phase of ['regular', 'postseason']) {
      byPhase[phase] = {};
      for (const model of MINUTES_MODEL_IDS) {
        byPhase[phase][model] = bagMetrics(minutesBag, `phase:${phase}|${model}`);
      }
    }
    const byRole: Record<string, Record<string, ReturnType<typeof compact>>> = {};
    for (const role of ['starter', 'bench', 'unknown']) {
      byRole[role] = {};
      for (const model of MINUTES_MODEL_IDS) {
        byRole[role][model] = bagMetrics(minutesBag, `role:${role}|${model}`);
      }
    }
    const byTeam: Record<string, Record<string, ReturnType<typeof compact>>> = {};
    for (const slice of ['no_team_change', 'after_team_change', 'first5_new_team', 'first10_new_team']) {
      byTeam[slice] = {};
      for (const model of MINUTES_MODEL_IDS) {
        byTeam[slice][model] = bagMetrics(minutesBag, `team:${slice}|${model}`);
      }
    }

    const statsByProp: Record<
      string,
      Record<string, ReturnType<typeof compact>>
    > = {};
    const statsVsMarket: Record<
      string,
      {
        trackA: ReturnType<typeof compact>;
        minutesBlended: ReturnType<typeof compact>;
        market: ReturnType<typeof compact>;
      }
    > = {};
    const statsByPhase: Record<string, Record<string, Record<string, ReturnType<typeof compact>>>> = {};
    const statsBySample: Record<string, Record<string, Record<string, ReturnType<typeof compact>>>> = {};
    const statsByTeam: Record<string, Record<string, Record<string, ReturnType<typeof compact>>>> = {};
    const statsByMinBucket: Record<string, Record<string, Record<string, ReturnType<typeof compact>>>> = {};

    for (const prop of SUPPORTED_PROP_TYPES) {
      const label = PROP_TYPE_LABEL[prop];
      statsByProp[label] = {};
      for (const model of STAT_MODEL_IDS) {
        statsByProp[label][STAT_MODEL_LABEL[model]] = bagMetrics(statBag, `prop:${prop}|all|${model}`);
      }
      statsVsMarket[label] = {
        trackA: bagMetrics(statBag, `prop:${prop}|market_overlap|track_a`),
        minutesBlended: bagMetrics(statBag, `prop:${prop}|market_overlap|r3_min_x_blended_rate`),
        market: bagMetrics(statBag, `prop:${prop}|market_overlap|market_line`),
      };
      statsByPhase[label] = {};
      for (const phase of ['regular', 'postseason']) {
        statsByPhase[label][phase] = {};
        for (const model of ['track_a', 'r3_min_x_blended_rate'] as StatModelId[]) {
          statsByPhase[label][phase][STAT_MODEL_LABEL[model]] = bagMetrics(
            statBag,
            `prop:${prop}|phase:${phase}|${model}`
          );
        }
      }
      statsBySample[label] = {};
      for (const bucket of ['1-4', '5-9', '10-19', '20+']) {
        statsBySample[label][bucket] = {};
        for (const model of ['track_a', 'r3_min_x_blended_rate'] as StatModelId[]) {
          statsBySample[label][bucket][STAT_MODEL_LABEL[model]] = bagMetrics(
            statBag,
            `prop:${prop}|sample:${bucket}|${model}`
          );
        }
      }
      statsByTeam[label] = {};
      for (const slice of ['no_team_change', 'after_team_change', 'first5_new_team', 'first10_new_team']) {
        statsByTeam[label][slice] = {};
        for (const model of ['track_a', 'r3_min_x_blended_rate'] as StatModelId[]) {
          statsByTeam[label][slice][STAT_MODEL_LABEL[model]] = bagMetrics(
            statBag,
            `prop:${prop}|team:${slice}|${model}`
          );
        }
      }
      statsByMinBucket[label] = {};
      for (const bucket of ['actual_over_5+', 'within_pm2', 'actual_under_5+', 'other']) {
        statsByMinBucket[label][bucket] = {};
        for (const model of ['track_a', 'r3_min_x_blended_rate'] as StatModelId[]) {
          statsByMinBucket[label][bucket][STAT_MODEL_LABEL[model]] = bagMetrics(
            statBag,
            `prop:${prop}|minbucket:${bucket}|${model}`
          );
        }
      }
    }

    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const identityMae = mean(identityAbs);

    const recommendation = (() => {
      const pts = statsByProp.PTS;
      const trackA = pts?.['Track A']?.mae;
      const r3 = pts?.['Minutes × Blended Rate']?.mae;
      if (trackA == null || r3 == null) return 'MORE DATA NEEDED';
      const delta = r3 - trackA;
      if (delta < -0.15) return 'MOVE TOWARD MINUTES × RATE';
      if (Math.abs(delta) <= 0.15) return 'KEEP TRACK A';
      return 'KEEP TRACK A';
    })();

    const payload = {
      meta: {
        runAt,
        version: MINUTES_EVAL_VERSION,
        featureDefinition: definition,
        seasons,
        dateRange: { from: from ?? minStart, to: to ?? maxStart },
        sampleSize: {
          finalLogsLoaded: logRes.rows.length,
          duplicateLogs,
          skippedNoTime,
          nDateFiltered,
          nPlayedTargets: nPlayed,
          nScoredMinutes,
          nNoPriorPlayed: nNoPrior,
          nPlayers: playerIds.size,
          limitApplied: limit,
        },
        targetDefinition:
          'Actual minutes played (minutes > 0) in Final games. DNP / 00-minute logs are excluded from the target.',
        featureNotes: {
          expectedMinutes:
            'Mean of prior played games (minutes > 0) as-of tipoff. DNP logs are skipped in minutes windows.',
          rates: 'sum(stat) / sum(minutes) over prior played games. Zero-minute logs do not enter either sum.',
          trackAMinutes: '0.7 * L10 played minutes + 0.3 * season played minutes (production Track A weights).',
          r1r2r3ExpectedMinutes: 'Track-A minutes blend. Sportsbook line is never an input.',
          countingTrackA:
            '0.7 * L10 counting avg + 0.3 * season counting avg over all prior Final logs (DNP zeros included), matching production Track A.',
          identityNote:
            'Season played-minutes * season rate is close to, but not identical to, counting season avg because counting averages include DNP 0-stat games.',
          noLeakage: 'Prior games require start_time < target.start_time. Active-season ignores other seasons.',
          postseasonRule: POSTSEASON_START_ET,
          starterRole:
            'analytics.game_starters is this-game observed starter (2025 only). Used as a split, never as a feature.',
          teamChange:
            'Inferred from analytics.player_game_logs.team_id vs prior games. Observation of roster, not a trade timestamp.',
        },
        formulas: {
          trackA: '0.7 * L10 + 0.3 * season',
          r1: 'E[min]_trackA * season_ppm',
          r2: 'E[min]_trackA * L10_ppm',
          r3: 'E[min]_trackA * (0.7 * L10_ppm + 0.3 * season_ppm)',
          perfectMinutes: 'actual_minutes * blended_ppm',
          perfectRate: 'E[min]_trackA * (actual_stat / actual_minutes)',
        },
      },
      minutes: {
        overall: minutesOverall,
        bestMinutesModel: bestMinutes ?? null,
        bySeason,
        bySample,
        byPhase,
        byRole,
        byTeam,
      },
      identityCheck: {
        maeSeasonMinTimesSeasonRateVsSeasonCountingAvg: round4(identityMae),
        n: identityAbs.length,
      },
      stats: {
        byProp: statsByProp,
        vsMarketOverlap: statsVsMarket,
        byPhase: statsByPhase,
        bySample: statsBySample,
        byTeam: statsByTeam,
        byMinutesErrorBucket: statsByMinBucket,
      },
      errorDecomposition: {
        n: statErr.length,
        pearsonAbsMinutesErrorVsAbsStatError: round4(pearson(absMinErr, absStatErr)),
        pearsonAbsRateErrorVsAbsStatError: round4(pearson(absRateErr, absStatErr)),
        pearsonMinutesErrorVsStatError: round4(pearson(minErr, statErr)),
        pearsonRateErrorVsStatError: round4(pearson(rateErr, statErr)),
        meanAbsMinutesError: round4(mean(absMinErr)),
        meanAbsRateError: round4(mean(absRateErr)),
        meanAbsPtsErrorMinutesXBlended: round4(mean(absStatErr)),
      },
      recommendation,
      productionChange: 'none — research only; live Track B.1 / Track A serving unchanged',
    };

    const outDir = join(process.cwd(), 'reports', 'model-validation');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'expected-minutes-baseline.json'), JSON.stringify(payload, null, 2));
    writeFileSync(join(outDir, 'rate-based-projection-baseline.json'), JSON.stringify(payload, null, 2));

    const minutesRows = MINUTES_MODEL_IDS.map((id) => {
      const m = minutesOverall[id];
      return [
        MINUTES_MODEL_LABEL[id],
        fmt(m.mae),
        fmt(m.rmse),
        fmt(m.bias),
        fmt(m.medianAe),
        pct(m.coverage),
        String(m.n ?? 0),
      ];
    });

    const minutesMd = [
      '# Expected minutes baseline',
      '',
      `Run: ${runAt}`,
      `Feature definition: **${definition}** (as-of before tipoff).`,
      `Seasons: ${seasons.join(', ')}`,
      `Date range: ${payload.meta.dateRange.from} → ${payload.meta.dateRange.to}`,
      `Scored player-games (minutes > 0, ≥1 prior played game): **${nScoredMinutes}** across **${playerIds.size}** players.`,
      '',
      '## Target and features',
      '',
      '- Target: actual minutes played (`minutes > 0`). DNP/`00` logs are not scored as targets.',
      '- Expected minutes windows use **prior played games only** (skip DNP).',
      '- Track-A minutes = `0.7 * L10 played minutes + 0.3 * season played minutes`.',
      '- Starter vs bench is an observed split from `analytics.game_starters` (season 2025 coverage). It is **not** a model feature.',
      '- No sportsbook line is used as an input.',
      '',
      '## Overall',
      '',
      mdTable(['Model', 'MAE', 'RMSE', 'Bias', 'MedAE', 'Cover', 'N'], minutesRows),
      '',
      `Best simple minutes method by MAE: **${bestMinutes ? MINUTES_MODEL_LABEL[bestMinutes] : 'n/a'}**.`,
      '',
      '### By season',
      '',
      ...seasons.map((season) => {
        const rows = MINUTES_MODEL_IDS.map((id) => [
          MINUTES_MODEL_LABEL[id],
          fmt(bySeason[season][id].mae),
          fmt(bySeason[season][id].bias),
          String(bySeason[season][id].n ?? 0),
        ]);
        return `#### Season ${season}\n\n${mdTable(['Model', 'MAE', 'Bias', 'N'], rows)}\n`;
      }),
      '### By prior played-game sample',
      '',
      ...['1-4', '5-9', '10-19', '20+'].map((bucket) => {
        const rows = MINUTES_MODEL_IDS.map((id) => [
          MINUTES_MODEL_LABEL[id],
          fmt(bySample[bucket][id].mae),
          fmt(bySample[bucket][id].bias),
          String(bySample[bucket][id].n ?? 0),
        ]);
        return `#### ${bucket} prior played games\n\n${mdTable(['Model', 'MAE', 'Bias', 'N'], rows)}\n`;
      }),
      '### Regular season vs postseason',
      '',
      'Postseason includes play-in from the first play-in ET date (2023: 2024-04-16, 2024: 2025-04-15, 2025: 2026-04-14).',
      '',
      ...['regular', 'postseason'].map((phase) => {
        const rows = MINUTES_MODEL_IDS.map((id) => [
          MINUTES_MODEL_LABEL[id],
          fmt(byPhase[phase][id].mae),
          fmt(byPhase[phase][id].bias),
          String(byPhase[phase][id].n ?? 0),
        ]);
        return `#### ${phase}\n\n${mdTable(['Model', 'MAE', 'Bias', 'N'], rows)}\n`;
      }),
      '### Starter vs bench (observed this-game role, not a feature)',
      '',
      ...['starter', 'bench', 'unknown'].map((role) => {
        const rows = MINUTES_MODEL_IDS.map((id) => [
          MINUTES_MODEL_LABEL[id],
          fmt(byRole[role][id].mae),
          fmt(byRole[role][id].bias),
          String(byRole[role][id].n ?? 0),
        ]);
        return `#### ${role}\n\n${mdTable(['Model', 'MAE', 'Bias', 'N'], rows)}\n`;
      }),
      '### Team-change diagnostics (no special handling)',
      '',
      ...['no_team_change', 'after_team_change', 'first5_new_team', 'first10_new_team'].map((slice) => {
        const rows = MINUTES_MODEL_IDS.map((id) => [
          MINUTES_MODEL_LABEL[id],
          fmt(byTeam[slice][id].mae),
          fmt(byTeam[slice][id].bias),
          String(byTeam[slice][id].n ?? 0),
        ]);
        return `#### ${slice}\n\n${mdTable(['Model', 'MAE', 'Bias', 'N'], rows)}\n`;
      }),
    ].join('\n');

    const statSections = SUPPORTED_PROP_TYPES.map((prop) => {
      const label = PROP_TYPE_LABEL[prop];
      const rows = [
        'Season Avg',
        'L10',
        'Track A',
        'Minutes × Season Rate',
        'Minutes × L10 Rate',
        'Minutes × Blended Rate',
        'Market Line',
      ].map((name) => [name, fmt(statsByProp[label][name]?.mae), String(statsByProp[label][name]?.n ?? 0)]);
      const ov = statsVsMarket[label];
      return [
        `## ${label}`,
        '',
        mdTable(['Model', 'MAE', 'N'], rows),
        '',
        `Market-overlap (same rows with a latest-pregame line): Track A MAE ${fmt(ov.trackA.mae)} vs Minutes × Blended ${fmt(ov.minutesBlended.mae)} vs Market ${fmt(ov.market.mae)} (n=${ov.market.n ?? 0}).`,
        '',
      ].join('\n');
    });

    const rateMd = [
      '# Rate-based projection baseline',
      '',
      `Run: ${runAt}`,
      'Track A is the reference counting-stat baseline. R1–R3 use **Track-A expected minutes** × per-minute rates from prior **played** games.',
      'Track B rate is not included (existing Track B logic is a counting-stat blend, not a clean per-minute rate).',
      '',
      `Algebraic identity check: MAE of (season played-minutes × season rate) vs counting season avg = **${fmt(identityMae)}** (n=${identityAbs.length}). Non-zero because counting averages include DNP 0-stat games.`,
      '',
      ...statSections,
      '## Error decomposition (PTS, Minutes × Blended Rate)',
      '',
      `- N: ${statErr.length}`,
      `- corr(|minutes error|, |PTS error|): ${fmt(payload.errorDecomposition.pearsonAbsMinutesErrorVsAbsStatError)}`,
      `- corr(|rate error|, |PTS error|): ${fmt(payload.errorDecomposition.pearsonAbsRateErrorVsAbsStatError)}`,
      `- corr(signed minutes error, signed PTS error): ${fmt(payload.errorDecomposition.pearsonMinutesErrorVsStatError)}`,
      `- corr(signed rate error, signed PTS error): ${fmt(payload.errorDecomposition.pearsonRateErrorVsStatError)}`,
      `- mean |minutes error|: ${fmt(payload.errorDecomposition.meanAbsMinutesError)}`,
      `- mean |rate error| (points per minute): ${fmt(payload.errorDecomposition.meanAbsRateError)}`,
      '',
      'PTS MAE by Track-A minutes miss bucket:',
      '',
      mdTable(
        ['Minutes bucket', 'Track A MAE', 'Minutes × Blended MAE', 'N (Track A)'],
        ['actual_over_5+', 'within_pm2', 'actual_under_5+', 'other'].map((bucket) => [
          bucket,
          fmt(statsByMinBucket.PTS[bucket]['Track A'].mae),
          fmt(statsByMinBucket.PTS[bucket]['Minutes × Blended Rate'].mae),
          String(statsByMinBucket.PTS[bucket]['Track A'].n ?? 0),
        ])
      ),
      '',
      'Counterfactuals (PTS overall):',
      '',
      `- Actual minutes × blended rate MAE: ${fmt(statsByProp.PTS['Actual minutes × Blended Rate']?.mae)}`,
      `- Track-A minutes × actual rate MAE: ${fmt(statsByProp.PTS['Track-A minutes × Actual Rate']?.mae)}`,
      '',
      'If perfect minutes drops MAE a lot while perfect rate does not, minutes is the missing variable. If the reverse, rate/usage mix is.',
      '',
      '## Regular vs postseason (PTS)',
      '',
      mdTable(
        ['Phase', 'Track A MAE', 'Track A bias', 'Minutes × Blended MAE', 'N'],
        ['regular', 'postseason'].map((phase) => [
          phase,
          fmt(statsByPhase.PTS[phase]['Track A'].mae),
          fmt(statsByPhase.PTS[phase]['Track A'].bias),
          fmt(statsByPhase.PTS[phase]['Minutes × Blended Rate'].mae),
          String(statsByPhase.PTS[phase]['Track A'].n ?? 0),
        ])
      ),
      '',
      '## Low-sample (PTS)',
      '',
      mdTable(
        ['Prior played', 'Track A MAE', 'Minutes × Blended MAE', 'N'],
        ['1-4', '5-9', '10-19', '20+'].map((bucket) => [
          bucket,
          fmt(statsBySample.PTS[bucket]['Track A'].mae),
          fmt(statsBySample.PTS[bucket]['Minutes × Blended Rate'].mae),
          String(statsBySample.PTS[bucket]['Track A'].n ?? 0),
        ])
      ),
      '',
      `## Recommendation`,
      '',
      `**${recommendation}**`,
      '',
      'Production projection behavior was not changed.',
      '',
    ].join('\n');

    writeFileSync(join(outDir, 'expected-minutes-baseline.md'), minutesMd);
    writeFileSync(join(outDir, 'rate-based-projection-baseline.md'), rateMd);

    console.log('\nMinutes overall');
    for (const id of MINUTES_MODEL_IDS) {
      const m = minutesOverall[id];
      console.log(`${MINUTES_MODEL_LABEL[id].padEnd(44)} MAE=${fmt(m.mae)} bias=${fmt(m.bias)} n=${m.n}`);
    }
    console.log('\nPTS models');
    for (const name of ['Season Avg', 'L10', 'Track A', 'Minutes × Season Rate', 'Minutes × L10 Rate', 'Minutes × Blended Rate', 'Market Line']) {
      const m = statsByProp.PTS[name];
      console.log(`${name.padEnd(28)} MAE=${fmt(m?.mae)} n=${m?.n}`);
    }
    console.log(`\nRecommendation: ${recommendation}`);
    console.log(`Wrote ${join(outDir, 'expected-minutes-baseline.md')}`);
    console.log(`Wrote ${join(outDir, 'rate-based-projection-baseline.md')}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
