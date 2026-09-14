/**
 * Research-only baseline evaluation for the Court Context player projection.
 *
 * Does not change production formulas, calibration artifacts, APIs, or UI.
 *
 *   npx tsx scripts/evaluate-player-projections.ts
 *   npm run evaluate:player-projections -- --season 2025 --prop-type points --limit 500
 */
import 'dotenv/config';

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import {
  SUPPORTED_PROP_TYPES,
  PROP_TYPE_LABEL,
  MODEL_IDS,
  MODEL_LABEL,
  SAMPLE_BUCKETS,
  EVAL_MODEL_VERSION,
  assignChronologicalSplits,
  calibrationFor,
  directionalStats,
  gapAnalysis,
  getCalibrationMeta,
  isSupportedPropType,
  leakageFlags,
  metricsByModel,
  scoreOpportunity,
  type BookPregameLine,
  type EvalGameLog,
  type FeatureDefinition,
  type MetricBlock,
  type ModelId,
  type ScoredOpportunity,
  type SupportedPropType,
} from '../lib/betting/player-projection-eval';

const SUPPORTED_SET = new Set<string>(SUPPORTED_PROP_TYPES);

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
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

function compactMetrics(m: MetricBlock) {
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

function printModelTable(title: string, rows: ScoredOpportunity[]) {
  console.log(`\n${title}`);
  console.log(
    ['Model', 'MAE', 'RMSE', 'Bias', 'MedAE', 'Cover', 'N']
      .map((h, i) => h.padEnd(i === 0 ? 14 : 10))
      .join('')
  );
  const byModel = metricsByModel(rows);
  for (const id of MODEL_IDS) {
    const m = byModel[id];
    console.log(
      [
        MODEL_LABEL[id].padEnd(14),
        fmt(m.mae).padEnd(10),
        fmt(m.rmse).padEnd(10),
        fmt(m.bias).padEnd(10),
        fmt(m.medianAe).padEnd(10),
        pct(m.coverage).padEnd(10),
        String(m.nScored).padEnd(10),
      ].join('')
    );
  }
}

type LineRow = {
  game_id: string;
  player_id: string;
  player_name: string | null;
  prop_type: string;
  sportsbook: string;
  line_value: string | number;
  odds_american: number | null;
  odds_decimal: string | number | null;
  decision_at: Date | string;
  game_start_time: Date | string;
  season: string;
  actual: string | number | null;
};

type LogRow = {
  player_id: string;
  game_id: string;
  start_time: Date | string | null;
  season: string;
  minutes: string | number | null;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  three_pointers_made: number | null;
};

function iso(v: Date | string | null | undefined): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
}

function numOrNull(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function summarizeDefinition(rows: ScoredOpportunity[]) {
  const byPropFull: Record<string, Record<ModelId, ReturnType<typeof compactMetrics>>> = {};
  const trackAvsB: Record<
    string,
    { trackAMae: number | null; trackBMae: number | null; trackBMinusTrackA: number | null }
  > = {};
  const vsMarket: Record<
    string,
    { ccMae: number | null; marketMae: number | null; delta: number | null; n: number }
  > = {};
  const bySample: Record<string, Record<ModelId, ReturnType<typeof compactMetrics>>> = {};
  const bySplit: Record<string, Record<ModelId, ReturnType<typeof compactMetrics>>> = {};
  const bySeason: Record<string, Record<ModelId, ReturnType<typeof compactMetrics>>> = {};
  const confidence: Record<
    string,
    {
      n: number;
      mae: number | null;
      rmse: number | null;
      directionalHitRate: number | null;
      coverage: number | null;
    }
  > = {};

  for (const prop of SUPPORTED_PROP_TYPES) {
    const subset = rows.filter((r) => r.propType === prop);
    const m = metricsByModel(subset);
    byPropFull[PROP_TYPE_LABEL[prop]] = {
      season_avg: compactMetrics(m.season_avg),
      l10: compactMetrics(m.l10),
      l5: compactMetrics(m.l5),
      track_a: compactMetrics(m.track_a),
      track_b: compactMetrics(m.track_b),
      market_line: compactMetrics(m.market_line),
    };
    const a = m.track_a.mae;
    const b = m.track_b.mae;
    trackAvsB[PROP_TYPE_LABEL[prop]] = {
      trackAMae: round4(a),
      trackBMae: round4(b),
      trackBMinusTrackA: a != null && b != null ? round4(b - a) : null,
    };
    const withMarket = subset.filter((r) => r.marketLine != null && r.projections.track_b != null);
    const cc = metricsByModel(withMarket);
    vsMarket[PROP_TYPE_LABEL[prop]] = {
      ccMae: round4(cc.track_b.mae),
      marketMae: round4(cc.market_line.mae),
      delta:
        cc.track_b.mae != null && cc.market_line.mae != null
          ? round4(cc.track_b.mae - cc.market_line.mae)
          : null,
      n: withMarket.length,
    };
  }

  for (const bucket of SAMPLE_BUCKETS) {
    const subset = rows.filter((r) => r.sampleBucket === bucket);
    const m = metricsByModel(subset);
    bySample[bucket] = Object.fromEntries(
      MODEL_IDS.map((id) => [id, compactMetrics(m[id])])
    ) as Record<ModelId, ReturnType<typeof compactMetrics>>;
  }

  for (const split of ['development', 'holdout'] as const) {
    const subset = rows.filter((r) => r.split === split);
    const m = metricsByModel(subset);
    bySplit[split] = Object.fromEntries(
      MODEL_IDS.map((id) => [id, compactMetrics(m[id])])
    ) as Record<ModelId, ReturnType<typeof compactMetrics>>;
  }

  const seasons = [...new Set(rows.map((r) => r.season))].sort();
  for (const season of seasons) {
    const subset = rows.filter((r) => r.season === season);
    const m = metricsByModel(subset);
    bySeason[season] = Object.fromEntries(
      MODEL_IDS.map((id) => [id, compactMetrics(m[id])])
    ) as Record<ModelId, ReturnType<typeof compactMetrics>>;
  }

  for (const tier of ['high', 'medium', 'low'] as const) {
    const subset = rows.filter((r) => r.confidenceTier === tier);
    const m = metricsByModel(subset);
    const dir = directionalStats(subset, 'track_b');
    confidence[tier] = {
      n: subset.length,
      mae: round4(m.track_b.mae),
      rmse: round4(m.track_b.rmse),
      directionalHitRate: round4(dir.directionalHitRate),
      coverage: round4(m.track_b.coverage),
    };
  }

  const overall = metricsByModel(rows);
  const dir = directionalStats(rows, 'track_b');
  const gaps = gapAnalysis(rows, 'track_b');
  const calRaw = calibrationFor(rows, 'pRaw');
  const calCal = calibrationFor(rows, 'pCalibrated');
  const calAnch = calibrationFor(rows, 'pAnchored');

  return {
    nOpportunities: rows.length,
    overall: Object.fromEntries(MODEL_IDS.map((id) => [id, compactMetrics(overall[id])])),
    byProp: byPropFull,
    bySampleBucket: bySample,
    byChronologicalSplit: bySplit,
    bySeason,
    trackAVsTrackB: trackAvsB,
    vsMarket,
    gapAnalysis: gaps,
    directional: {
      ...dir,
      directionalHitRate: round4(dir.directionalHitRate),
      overHitRate: round4(dir.overHitRate),
      underHitRate: round4(dir.underHitRate),
    },
    confidenceTiers: confidence,
    calibration: {
      raw: { brier: round4(calRaw.brier), ece: round4(calRaw.ece), n: calRaw.n },
      calibrated: { brier: round4(calCal.brier), ece: round4(calCal.ece), n: calCal.n },
      anchored: { brier: round4(calAnch.brier), ece: round4(calAnch.ece), n: calAnch.n },
    },
  };
}

async function main() {
  const seasonFilter = argValue('--season');
  const propFilterRaw = argValue('--prop-type');
  const from = argValue('--from');
  const to = argValue('--to');
  const limitRaw = argValue('--limit');
  const limit = limitRaw != null ? Number.parseInt(limitRaw, 10) : null;
  const featureArg = (argValue('--feature-definition') ?? 'both') as
    | FeatureDefinition
    | 'both';
  const outPath =
    argValue('--out') ?? join(process.cwd(), 'reports/model-validation/player-projection-baseline.json');

  const propFilter =
    propFilterRaw != null
      ? propFilterRaw
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter((s) => isSupportedPropType(s))
      : [...SUPPORTED_PROP_TYPES];

  const definitions: FeatureDefinition[] =
    featureArg === 'both' ? ['active_season', 'career'] : [featureArg];

  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) throw new Error('Missing SUPABASE_DB_URL');

  const pool = new Pool({
    connectionString: dbUrl,
    ssl: dbUrl.includes('supabase') ? { rejectUnauthorized: false } : undefined,
    statement_timeout: 180000,
  });

  const runAt = new Date().toISOString();
  console.log('Player projection baseline evaluation');
  console.log(`Run: ${runAt}`);
  console.log(`Feature definitions: ${definitions.join(', ')}`);
  console.log(`Prop types: ${propFilter.join(', ')}`);

  try {
    const lineParams: unknown[] = [propFilter];
    let lineSql = `
      SELECT
        d.game_id::text AS game_id,
        d.player_id::text AS player_id,
        d.player_name,
        lower(d.prop_type) AS prop_type,
        d.sportsbook,
        d.line_value,
        d.odds_american,
        d.odds_decimal,
        d.decision_at,
        g.start_time AS game_start_time,
        g.season,
        CASE lower(d.prop_type)
          WHEN 'points' THEN l.points
          WHEN 'rebounds' THEN l.rebounds
          WHEN 'assists' THEN l.assists
          WHEN 'threes' THEN l.three_pointers_made
          WHEN 'points_rebounds_assists' THEN coalesce(l.points,0)+coalesce(l.rebounds,0)+coalesce(l.assists,0)
          WHEN 'points_assists' THEN coalesce(l.points,0)+coalesce(l.assists,0)
          WHEN 'points_rebounds' THEN coalesce(l.points,0)+coalesce(l.rebounds,0)
          WHEN 'rebounds_assists' THEN coalesce(l.rebounds,0)+coalesce(l.assists,0)
          ELSE NULL
        END AS actual
      FROM research.prop_decision_lines d
      JOIN analytics.games g ON g.game_id = d.game_id
      JOIN analytics.player_game_logs l
        ON l.game_id = d.game_id AND l.player_id = d.player_id
      WHERE g.status = 'Final'
        AND g.start_time IS NOT NULL
        AND d.decision_at < g.start_time
        AND lower(d.side) = 'over'
        AND lower(d.prop_type) = ANY($1::text[])
    `;
    if (seasonFilter) {
      lineParams.push(seasonFilter);
      lineSql += ` AND g.season = $${lineParams.length}`;
    }
    if (from) {
      lineParams.push(from);
      lineSql += ` AND g.start_time >= $${lineParams.length}::timestamptz`;
    }
    if (to) {
      lineParams.push(to);
      lineSql += ` AND g.start_time < $${lineParams.length}::timestamptz`;
    }

    const lineRes = await pool.query<LineRow>(lineSql, lineParams);
    console.log(`Loaded ${lineRes.rows.length} pregame OVER book-rows`);

    type OppKey = string;
    const byOpp = new Map<
      OppKey,
      {
        gameId: string;
        playerId: string;
        propType: SupportedPropType;
        season: string;
        startTime: string;
        actual: number;
        lines: BookPregameLine[];
      }
    >();

    for (const row of lineRes.rows) {
      if (!SUPPORTED_SET.has(row.prop_type)) continue;
      const actual = numOrNull(row.actual);
      if (actual == null) continue;
      const startTime = iso(row.game_start_time);
      const key = `${row.game_id}|${row.player_id}|${row.prop_type}`;
      let opp = byOpp.get(key);
      if (!opp) {
        opp = {
          gameId: row.game_id,
          playerId: row.player_id,
          propType: row.prop_type as SupportedPropType,
          season: String(row.season),
          startTime,
          actual,
          lines: [],
        };
        byOpp.set(key, opp);
      }
      const lineValue = numOrNull(row.line_value);
      if (lineValue == null) continue;
      opp.lines.push({
        sportsbook: row.sportsbook,
        lineValue,
        oddsAmerican: row.odds_american,
        oddsDecimal: numOrNull(row.odds_decimal),
        decisionAt: iso(row.decision_at),
      });
    }

    let opportunities = [...byOpp.values()].sort(
      (a, b) => Date.parse(a.startTime) - Date.parse(b.startTime)
    );
    if (limit != null && Number.isFinite(limit) && limit > 0) {
      opportunities = opportunities.slice(0, limit);
    }
    console.log(`Unique opportunities: ${opportunities.length}`);

    const playerIds = [...new Set(opportunities.map((o) => o.playerId))];
    const logRes = await pool.query<LogRow>(
      `
      SELECT
        l.player_id::text AS player_id,
        l.game_id::text AS game_id,
        COALESCE(g.start_time, l.game_date::timestamptz) AS start_time,
        l.season,
        l.minutes,
        l.points,
        l.rebounds,
        l.assists,
        l.three_pointers_made
      FROM analytics.player_game_logs l
      JOIN analytics.games g ON g.game_id = l.game_id
      WHERE g.status = 'Final'
        AND l.player_id = ANY($1::text[])
      `,
      [playerIds]
    );
    console.log(`Loaded ${logRes.rows.length} Final game logs for ${playerIds.length} players`);

    const gamesByPlayer = new Map<string, EvalGameLog[]>();
    let duplicateLogs = 0;
    const seenLog = new Set<string>();
    for (const row of logRes.rows) {
      const k = `${row.player_id}|${row.game_id}`;
      if (seenLog.has(k)) {
        duplicateLogs += 1;
        continue;
      }
      seenLog.add(k);
      if (!row.start_time) continue;
      const list = gamesByPlayer.get(row.player_id) ?? [];
      list.push({
        game_id: row.game_id,
        player_id: row.player_id,
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

    const splitMap = assignChronologicalSplits(opportunities.map((o) => o.startTime));

    const marketInvestigation = await pool.query<{
      n: string;
      min_tip: string | null;
      max_tip: string | null;
      books: string;
      p10: string | null;
      p50: string | null;
      p90: string | null;
      after_tip: string;
    }>(`
      SELECT
        count(*)::text AS n,
        min(game_start_time)::text AS min_tip,
        max(game_start_time)::text AS max_tip,
        count(distinct sportsbook)::text AS books,
        percentile_cont(0.10) WITHIN GROUP (ORDER BY extract(epoch FROM (game_start_time - decision_at))/60)::text AS p10,
        percentile_cont(0.50) WITHIN GROUP (ORDER BY extract(epoch FROM (game_start_time - decision_at))/60)::text AS p50,
        percentile_cont(0.90) WITHIN GROUP (ORDER BY extract(epoch FROM (game_start_time - decision_at))/60)::text AS p90,
        count(*) FILTER (WHERE decision_at >= game_start_time)::text AS after_tip
      FROM research.prop_decision_lines
    `);

    const scoredByDef: Record<FeatureDefinition, ScoredOpportunity[]> = {
      active_season: [],
      career: [],
    };

    for (const definition of definitions) {
      console.log(`Scoring ${definition}...`);
      for (const opp of opportunities) {
        scoredByDef[definition].push(
          scoreOpportunity({
            gameId: opp.gameId,
            playerId: opp.playerId,
            propType: opp.propType,
            season: opp.season,
            startTime: opp.startTime,
            split: splitMap.get(opp.startTime) ?? 'holdout',
            actual: opp.actual,
            featureDefinition: definition,
            allPlayerGames: gamesByPlayer.get(opp.playerId) ?? [],
            pregameLines: opp.lines,
          })
        );
      }
    }

    const primaryDef: FeatureDefinition = definitions.includes('active_season')
      ? 'active_season'
      : definitions[0];
    const primary = scoredByDef[primaryDef];

    const summaries: Record<string, ReturnType<typeof summarizeDefinition>> = {};
    for (const definition of definitions) {
      summaries[definition] = summarizeDefinition(scoredByDef[definition]);
    }

    const trainServe: Record<
      string,
      {
        maeDiffCareerMinusActive: number | null;
        brierDiffCareerMinusActive: number | null;
        eceDiffCareerMinusActive: number | null;
      }
    > = {};
    if (definitions.includes('active_season') && definitions.includes('career')) {
      for (const prop of SUPPORTED_PROP_TYPES) {
        const a = scoredByDef.active_season.filter((r) => r.propType === prop);
        const c = scoredByDef.career.filter((r) => r.propType === prop);
        const aM = metricsByModel(a).track_b;
        const cM = metricsByModel(c).track_b;
        const aCal = calibrationFor(a, 'pRaw');
        const cCal = calibrationFor(c, 'pRaw');
        trainServe[PROP_TYPE_LABEL[prop]] = {
          maeDiffCareerMinusActive:
            aM.mae != null && cM.mae != null ? round4(cM.mae - aM.mae) : null,
          brierDiffCareerMinusActive:
            aCal.brier != null && cCal.brier != null ? round4(cCal.brier - aCal.brier) : null,
          eceDiffCareerMinusActive:
            aCal.ece != null && cCal.ece != null ? round4(cCal.ece - aCal.ece) : null,
        };
      }
    }

    const leakage = leakageFlags(primary, gamesByPlayer);
    const inv = marketInvestigation.rows[0];

    const report = {
      meta: {
        runAt,
        modelVersion: EVAL_MODEL_VERSION,
        calibrationVersion: getCalibrationMeta(),
        primaryFeatureDefinition: primaryDef,
        featureDefinitions: definitions,
        dateRange: {
          from: from ?? inv?.min_tip ?? null,
          to: to ?? inv?.max_tip ?? null,
        },
        seasons: [...new Set(opportunities.map((o) => o.season))].sort(),
        propTypes: propFilter,
        sampleCounts: {
          bookRows: lineRes.rows.length,
          uniqueOpportunities: opportunities.length,
          players: playerIds.length,
          gameLogsLoaded: logRes.rows.length,
        },
        marketLineRule: {
          label: 'latest available pregame line',
          notProvenClosing: true,
          source: 'research.prop_decision_lines',
          side: 'over',
          aggregation: 'median of latest pregame line per sportsbook',
          consensusWhenBooksGte: 3,
          preferredBookOrder: ['betmgm', 'fanduel', 'draftkings'],
        },
        chronologicalSplit:
          'unique game start_times sorted ascending; first 70% development, last 30% holdout',
        productionUnchanged: true,
      },
      marketLineInvestigation: {
        timestampsExist: true,
        multipleSnapshotsExistInRawV2: false,
        rawV2RowCount: 0,
        multipleBooksExist: Number(inv?.books ?? 0) > 1,
        bookCount: Number(inv?.books ?? 0),
        postTipRowsInDecisionTable: Number(inv?.after_tip ?? 0),
        minutesBeforeTip: {
          p10: inv?.p10 != null ? Number(inv.p10) : null,
          p50: inv?.p50 != null ? Number(inv.p50) : null,
          p90: inv?.p90 != null ? Number(inv.p90) : null,
        },
        window: { minTip: inv?.min_tip ?? null, maxTip: inv?.max_tip ?? null },
        note:
          'True closing lines cannot be proven. Median snapshot is ~5.5 hours before tip; p10 is ~1 hour. Label is latest available pregame line, not closing line.',
      },
      leakage: {
        ...leakage,
        duplicateGameLogsSkipped: duplicateLogs,
        onlyFinalGames: true,
        seasonAveragesTableNotUsed: true,
        injuryTablesNotUsed: true,
      },
      results: summaries,
      trainServeComparison: trainServe,
    };

    mkdirSync(join(outPath, '..'), { recursive: true });
    writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
    console.log(`Wrote ${outPath}`);

    console.log('\n========== PRIMARY: ACTIVE-SEASON-AS-OF-GAME ==========');
    for (const prop of propFilter) {
      if (!isSupportedPropType(prop)) continue;
      printModelTable(
        PROP_TYPE_LABEL[prop],
        primary.filter((r) => r.propType === prop)
      );
    }

    console.log('\nTrack B MAE − Track A MAE (negative => Track B better)');
    for (const prop of propFilter) {
      if (!isSupportedPropType(prop)) continue;
      const rec = summaries[primaryDef].trackAVsTrackB[PROP_TYPE_LABEL[prop]];
      console.log(
        `  ${PROP_TYPE_LABEL[prop].padEnd(5)} A=${fmt(rec.trackAMae)}  B=${fmt(rec.trackBMae)}  Δ=${fmt(rec.trackBMinusTrackA)}`
      );
    }

    console.log('\nCourt Context Track B vs market (delta = CC MAE − market MAE; negative => CC better)');
    for (const prop of propFilter) {
      if (!isSupportedPropType(prop)) continue;
      const rec = summaries[primaryDef].vsMarket[PROP_TYPE_LABEL[prop]];
      console.log(
        `  ${PROP_TYPE_LABEL[prop].padEnd(5)} CC=${fmt(rec.ccMae)}  Mkt=${fmt(rec.marketMae)}  Δ=${fmt(rec.delta)}  n=${rec.n}`
      );
    }

    if (definitions.includes('career')) {
      console.log('\n========== RESEARCH: CAREER-AS-OF-GAME ==========');
      for (const prop of ['points'] as SupportedPropType[]) {
        printModelTable(
          `PTS (career)`,
          scoredByDef.career.filter((r) => r.propType === prop)
        );
      }
    }

    console.log('\nDone. Production formulas were not modified.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
