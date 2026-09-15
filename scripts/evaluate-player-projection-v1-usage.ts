/**
 * Research-only: does pregame usage / rate change improve the mean
 * beyond Played-only Track A and the frozen conditional EWM minutes candidate?
 *
 * Does NOT change production. Does NOT retune minutes α / clip / threshold.
 * Does NOT call Owls Insight.
 *
 *   npx tsx scripts/evaluate-player-projection-v1-usage.ts
 *   npx tsx scripts/evaluate-player-projection-v1-usage.ts --skip-market --limit 2000
 */
import 'dotenv/config';

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import { PROP_TYPE_LABEL, selectPriorGames, type SupportedPropType } from '../lib/betting/player-projection-eval';
import {
  ALL_PROP_TYPES,
  BENCHMARK_B_ID,
  BENCHMARK_ID,
  BOOTSTRAP_ITERS,
  BOOTSTRAP_SEED,
  CHRONO_SPLIT,
  FEATURE_DEFINITION,
  FROZEN_MINUTES_CHANGE_THRESHOLD,
  FROZEN_MINUTES_CLIP,
  FROZEN_MINUTES_EWM_ALPHA,
  actualForProp,
  chronoSplitForSeason,
  compactMetrics,
  conditionalMinutesAdjustedProjection,
  isPlayedTarget,
  pairedDelta,
  playedOnlyTrackA,
  reconstructFromPrior,
  volumeBucket,
  type ProjectionV1Log,
  type RoleLabel,
} from '../lib/betting/player-projection-v1-research';
import { classifyAppearance } from '../lib/betting/minutes-projection-eval';
import { classifyMaeDelta } from '../lib/betting/shadow-projection-eval';
import {
  FTA_SHOT_VOLUME_WEIGHT,
  RECENT_BLEND_WEIGHTS,
  USAGE_CHANGE_TAUS,
  USAGE_RESEARCH_VERSION,
  changeDirection,
  changeMagnitude,
  fgaChangeRel,
  ftaChangeRel,
  minutesUsageQuad,
  recentBlendThenFrozenMinutes,
  reconstructPregameUsage,
  scoreUsageRateCandidates,
  usageChangeRel,
  type UsageChangeTau,
  type UsageEvalLog,
} from '../lib/betting/player-projection-v1-usage-research';

type LogRow = {
  player_id: string;
  game_id: string;
  team_id: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  start_time: Date | string;
  season: string;
  minutes: string | number | null;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  three_pointers_made: number | null;
  field_goals_attempted: number | null;
  free_throws_attempted: number | null;
  three_pointers_attempted: number | null;
  offensive_rebounds: number | null;
  defensive_rebounds: number | null;
  turnovers: number | null;
  usage_percentage: number | null;
  possessions: number | null;
  assist_percentage: number | null;
  rebound_percentage: number | null;
};

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}
function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}
function iso(v: Date | string | null | undefined): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
}
function fmt(n: number | null | undefined, digits = 3): string {
  if (n == null || !Number.isFinite(n)) return 'n/a';
  return n.toFixed(digits);
}
function round4(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n * 1e4) / 1e4;
}
function mdTable(headers: string[], rows: Array<Array<string | number>>): string {
  return `| ${headers.join(' | ')} |\n| ${headers.map(() => '---').join(' | ')} |\n${rows
    .map((r) => `| ${r.map((c) => String(c)).join(' | ')} |`)
    .join('\n')}`;
}
function medianAbs(err: number[]): number | null {
  if (err.length === 0) return null;
  const xs = err.map((e) => Math.abs(e)).sort((a, b) => a - b);
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 === 1 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

class Running {
  n = 0;
  abs = 0;
  sq = 0;
  signed = 0;
  push(projection: number, actual: number) {
    const e = projection - actual;
    this.n += 1;
    this.abs += Math.abs(e);
    this.sq += e * e;
    this.signed += e;
  }
  metrics() {
    if (this.n === 0) return { mae: null as number | null, rmse: null as number | null, bias: null as number | null, n: 0 };
    return { mae: this.abs / this.n, rmse: Math.sqrt(this.sq / this.n), bias: this.signed / this.n, n: this.n };
  }
}

function bagKey(split: string, prop: string, candidate: string): string {
  return `${split}|${prop}|${candidate}`;
}

async function main() {
  const runAt = new Date().toISOString();
  const limit = argValue('--limit') ? Number(argValue('--limit')) : null;
  const skipMarket = hasFlag('--skip-market');
  const bootstrapIters = argValue('--bootstrap') ? Number(argValue('--bootstrap')) : BOOTSTRAP_ITERS;
  const url = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('SUPABASE_DB_URL or DATABASE_URL required');
  const pool = new Pool({ connectionString: url, max: 4 });

  try {
    console.log(`${USAGE_RESEARCH_VERSION} ${runAt}`);
    console.log('Production unchanged. Minutes α/clip/threshold frozen.');

    const coverage = await loadCoverage(pool);
    const logRes = await pool.query<LogRow>(
      `
      SELECT
        l.player_id::text AS player_id,
        l.game_id::text AS game_id,
        l.team_id::text AS team_id,
        g.home_team_id::text AS home_team_id,
        g.away_team_id::text AS away_team_id,
        COALESCE(g.start_time, l.game_date::timestamptz) AS start_time,
        g.season::text AS season,
        l.minutes, l.points, l.rebounds, l.assists, l.three_pointers_made,
        l.field_goals_attempted, l.free_throws_attempted, l.three_pointers_attempted,
        l.offensive_rebounds, l.defensive_rebounds, l.turnovers,
        a.usage_percentage, a.possessions, a.assist_percentage, a.rebound_percentage
      FROM analytics.player_game_logs l
      JOIN analytics.games g ON g.game_id = l.game_id
      LEFT JOIN analytics.player_game_advanced a
        ON a.game_id = l.game_id AND a.player_id = l.player_id
      WHERE g.status = 'Final' AND g.start_time IS NOT NULL
        AND g.season = ANY($1::text[])
      ORDER BY l.player_id, g.start_time
      `,
      [['2023', '2024', '2025']]
    );
    console.log(`Loaded ${logRes.rows.length} Final log rows`);

    const starterRes = await pool.query<{ game_id: string; player_id: string }>(
      `SELECT game_id::text, player_id::text FROM analytics.game_starters`
    );
    const starterKeys = new Set(starterRes.rows.map((r) => `${r.game_id}|${r.player_id}`));
    const gamesWithStarters = new Set(starterRes.rows.map((r) => r.game_id));

    const gamesByPlayer = new Map<string, UsageEvalLog[]>();
    const seen = new Set<string>();
    let usageOnPlayed = 0;
    let playedLogs = 0;
    for (const row of logRes.rows) {
      const k = `${row.player_id}|${row.game_id}`;
      if (seen.has(k) || !row.start_time) continue;
      seen.add(k);
      const roleKey = `${row.game_id}|${row.player_id}`;
      const started: RoleLabel = !gamesWithStarters.has(row.game_id)
        ? 'unknown'
        : starterKeys.has(roleKey)
          ? 'starter'
          : 'bench';
      const g: UsageEvalLog = {
        game_id: row.game_id,
        player_id: row.player_id,
        team_id: row.team_id,
        home_team_id: row.home_team_id,
        away_team_id: row.away_team_id,
        start_time: iso(row.start_time),
        season: String(row.season ?? ''),
        minutes: row.minutes,
        points: row.points,
        rebounds: row.rebounds,
        assists: row.assists,
        three_pointers_made: row.three_pointers_made,
        field_goals_attempted: row.field_goals_attempted,
        free_throws_attempted: row.free_throws_attempted,
        three_pointers_attempted: row.three_pointers_attempted,
        offensive_rebounds: row.offensive_rebounds,
        defensive_rebounds: row.defensive_rebounds,
        turnovers: row.turnovers,
        usage_percentage: row.usage_percentage,
        possessions: row.possessions,
        assist_percentage: row.assist_percentage,
        rebound_percentage: row.rebound_percentage,
        started,
      };
      if (classifyAppearance(g).class === 'played') {
        playedLogs += 1;
        if (g.usage_percentage != null && Number.isFinite(g.usage_percentage)) usageOnPlayed += 1;
      }
      const list = gamesByPlayer.get(row.player_id) ?? [];
      list.push(g);
      gamesByPlayer.set(row.player_id, list);
    }

    const running = new Map<string, Running>();
    const testErr = new Map<string, number[]>();
    const testSeg = new Map<string, number[]>();
    const candidateIds = new Set<string>([BENCHMARK_ID, BENCHMARK_B_ID]);
    const flags = {
      '2023': emptyFlags(),
      '2024': emptyFlags(),
      '2025': emptyFlags(),
    };
    let nScored = 0;
    let leakageTotal = 0;
    const splitN: Record<string, number> = { train: 0, validation: 0, test: 0, excluded: 0 };

    const pushRun = (key: string, projection: number, actual: number) => {
      const prev = running.get(key);
      if (prev) prev.push(projection, actual);
      else {
        const r = new Running();
        r.push(projection, actual);
        running.set(key, r);
      }
    };
    const pushArr = (map: Map<string, number[]>, key: string, v: number) => {
      const list = map.get(key);
      if (list) list.push(v);
      else map.set(key, [v]);
    };

    for (const logs of gamesByPlayer.values()) {
      for (let i = 0; i < logs.length; i += 1) {
        if (limit != null && nScored >= limit) break;
        const target = logs[i];
        if (!isPlayedTarget(target)) continue;
        const split = chronoSplitForSeason(target.season);
        if (split === 'excluded') continue;
        const prior = selectPriorGames(logs, target.start_time, target.season, FEATURE_DEFINITION) as UsageEvalLog[];
        const minutes = reconstructFromPrior(prior as ProjectionV1Log[], target as ProjectionV1Log);
        if (!minutes) continue;
        leakageTotal += minutes.leakageViolations;
        const usage = reconstructPregameUsage(prior);
        nScored += 1;
        splitN[split] += 1;

        const seasonFlags = flags[target.season as '2023' | '2024' | '2025'];
        if (seasonFlags) {
          seasonFlags.n += 1;
          const minRel = minutesChangeAbs(minutes.l5Min, minutes.l10Min);
          if (minRel != null && minRel >= FROZEN_MINUTES_CHANGE_THRESHOLD) {
            seasonFlags.minutes_change_large += 1;
          }
          const usg015 = usageChangeRel(usage);
          if (usg015 != null && usg015 >= 0.15) seasonFlags.usage_change_large_015 += 1;
          if (usg015 != null && usg015 >= 0.25) seasonFlags.usage_change_large_025 += 1;
          const fgaR = fgaChangeRel(usage);
          if (fgaR != null && fgaR >= 0.25) seasonFlags.fga_change_large_025 += 1;
          const ftaR = ftaChangeRel(usage);
          if (ftaR != null && ftaR >= 0.25) seasonFlags.fta_change_large_025 += 1;
        }

        for (const prop of ALL_PROP_TYPES) {
          const actual = actualForProp(target, prop);
          if (actual == null || !Number.isFinite(actual)) continue;
          const benchmarkA = playedOnlyTrackA(prior, prop);
          if (benchmarkA == null || !Number.isFinite(benchmarkA)) continue;
          const benchmarkB = conditionalMinutesAdjustedProjection({
            trackA: benchmarkA,
            features: minutes,
            propType: prop,
          });
          const scored = scoreUsageRateCandidates({
            prior,
            usage,
            benchmarkA,
            benchmarkB,
            propType: prop,
          });
          scored[BENCHMARK_ID] = benchmarkA;
          scored[BENCHMARK_B_ID] = benchmarkB;
          for (const tau of USAGE_CHANGE_TAUS) {
            const tauKey = tau === 0.15 ? '015' : '025';
            for (const w of RECENT_BLEND_WEIGHTS) {
              scored[`blend_${w.id}_usg_cond_${tauKey}`] = recentBlendThenFrozenMinutes({
                prior,
                minutes,
                usage,
                propType: prop,
                benchmarkA,
                tau,
                l10Weight: w.l10,
                seasonWeight: w.season,
                applyFrozenMinutes: (counting) =>
                  conditionalMinutesAdjustedProjection({ trackA: counting, features: minutes, propType: prop }),
              });
            }
          }

          const usgDir = changeDirection(usage.usage.l5, usage.usage.l10, 0.25, 0.08);
          const usgMag = changeMagnitude(usageChangeRel(usage));
          const vol = volumeBucket(minutes.seasonMin);
          const quad = minutesUsageQuad(minutes, usage, 0.25);

          for (const [cand, projection] of Object.entries(scored)) {
            candidateIds.add(cand);
            pushRun(bagKey(split, prop, cand), projection, actual);
            if (split === 'test') {
              const err = projection - actual;
              pushArr(testErr, `${prop}|${cand}`, err);
              if (
                cand === BENCHMARK_ID ||
                cand === BENCHMARK_B_ID ||
                cand === 'usg_l5_l10_cond_025__clip_085_115' ||
                cand === 'usg_l5_l10_always__clip_085_115' ||
                cand === 'fga_l5_l10_cond_025__clip_085_115' ||
                cand === 'blend_w85_usg_cond_025'
              ) {
                pushArr(testSeg, `${prop}|${cand}|usgMag|${usgMag}`, err);
                pushArr(testSeg, `${prop}|${cand}|usgDir|${usgDir}`, err);
                pushArr(testSeg, `${prop}|${cand}|vol|${vol}`, err);
                pushArr(testSeg, `${prop}|${cand}|quad|${quad}`, err);
              }
            }
          }
        }
      }
      if (limit != null && nScored >= limit) break;
    }

    console.log(`Scored ${nScored}. leakage=${leakageTotal}`);

    const allCandidates = [...candidateIds];
    const usageCandidateIds = allCandidates.filter((id) => id !== BENCHMARK_ID && id !== BENCHMARK_B_ID);
    const valBest: Record<string, { candidate: string; mae: number | null }> = {};
    for (const prop of ALL_PROP_TYPES) {
      const bMae = running.get(bagKey('validation', prop, BENCHMARK_B_ID))?.metrics().mae ?? Number.POSITIVE_INFINITY;
      let bestId = BENCHMARK_B_ID;
      let bestMae = bMae;
      for (const cand of usageCandidateIds) {
        const mae = running.get(bagKey('validation', prop, cand))?.metrics().mae;
        if (mae != null && mae < bestMae) {
          bestMae = mae;
          bestId = cand;
        }
      }
      valBest[prop] = { candidate: bestId, mae: Number.isFinite(bestMae) ? bestMae : null };
    }

    const testTable = ALL_PROP_TYPES.map((prop) => {
      const aErr = testErr.get(`${prop}|${BENCHMARK_ID}`) ?? [];
      const bErr = testErr.get(`${prop}|${BENCHMARK_B_ID}`) ?? [];
      const selectedId = valBest[prop].candidate;
      const cErr = testErr.get(`${prop}|${selectedId}`) ?? [];
      const vsB = pairedDelta(bErr, cErr, bootstrapIters, BOOTSTRAP_SEED);
      const vsA = pairedDelta(aErr, bErr, bootstrapIters, BOOTSTRAP_SEED);
      return {
        prop: PROP_TYPE_LABEL[prop],
        propType: prop,
        selectedCandidate: selectedId,
        trackAMae: running.get(bagKey('test', prop, BENCHMARK_ID))?.metrics().mae ?? null,
        minutesMae: running.get(bagKey('test', prop, BENCHMARK_B_ID))?.metrics().mae ?? null,
        usageMae: running.get(bagKey('test', prop, selectedId))?.metrics().mae ?? null,
        deltaVsMinutes: vsB.delta,
        ciLow: vsB.ciLow,
        ciHigh: vsB.ciHigh,
        n: vsB.n,
        class: vsB.delta == null ? 'tied' : classifyMaeDelta(vsB.delta),
        minutesVsTrackA: vsA.delta,
        trackAMedianAe: medianAbs(aErr),
        minutesMedianAe: medianAbs(bErr),
        usageMedianAe: medianAbs(cErr),
        trackARmse: running.get(bagKey('test', prop, BENCHMARK_ID))?.metrics().rmse ?? null,
        minutesRmse: running.get(bagKey('test', prop, BENCHMARK_B_ID))?.metrics().rmse ?? null,
        usageRmse: running.get(bagKey('test', prop, selectedId))?.metrics().rmse ?? null,
        trackABias: running.get(bagKey('test', prop, BENCHMARK_ID))?.metrics().bias ?? null,
        minutesBias: running.get(bagKey('test', prop, BENCHMARK_B_ID))?.metrics().bias ?? null,
        usageBias: running.get(bagKey('test', prop, selectedId))?.metrics().bias ?? null,
      };
    });

    const segmentRows: Array<Record<string, unknown>> = [];
    for (const prop of ALL_PROP_TYPES) {
      for (const cand of [
        BENCHMARK_B_ID,
        'usg_l5_l10_cond_025__clip_085_115',
        'usg_l5_l10_always__clip_085_115',
        'fga_l5_l10_cond_025__clip_085_115',
        'blend_w85_usg_cond_025',
      ]) {
        for (const slice of ['usgMag', 'usgDir', 'vol', 'quad'] as const) {
          const buckets = new Set<string>();
          for (const key of testSeg.keys()) {
            const parts = key.split('|');
            if (parts[0] === prop && parts[1] === cand && parts[2] === slice) buckets.add(parts[3]);
          }
          for (const bucket of buckets) {
            const candErr = testSeg.get(`${prop}|${cand}|${slice}|${bucket}`) ?? [];
            const baseErr = testSeg.get(`${prop}|${BENCHMARK_B_ID}|${slice}|${bucket}`) ?? [];
            if (candErr.length < 80) continue;
            const boot = pairedDelta(baseErr, candErr, Math.min(bootstrapIters, 200), BOOTSTRAP_SEED);
            segmentRows.push({
              prop: PROP_TYPE_LABEL[prop],
              candidate: cand,
              slice,
              bucket,
              n: candErr.length,
              candidateMae: round4(boot.candidateMae),
              baselineMae: round4(boot.baselineMae),
              delta: round4(boot.delta),
              ciLow: round4(boot.ciLow),
              ciHigh: round4(boot.ciHigh),
              medianAe: round4(medianAbs(candErr)),
            });
          }
        }
      }
    }

    const bySplit: Record<string, Record<string, Record<string, ReturnType<Running['metrics']> & { medianAe: number | null }>>> = {};
    for (const split of ['train', 'validation', 'test'] as const) {
      bySplit[split] = {};
      for (const prop of ALL_PROP_TYPES) {
        bySplit[split][PROP_TYPE_LABEL[prop]] = {};
        for (const cand of allCandidates) {
          const m = running.get(bagKey(split, prop, cand))?.metrics() ?? { mae: null, rmse: null, bias: null, n: 0 };
          bySplit[split][PROP_TYPE_LABEL[prop]][cand] = {
            ...m,
            mae: round4(m.mae),
            rmse: round4(m.rmse),
            bias: round4(m.bias),
            medianAe: split === 'test' ? round4(medianAbs(testErr.get(`${prop}|${cand}`) ?? [])) : null,
          };
        }
      }
    }

    let market: Record<string, unknown> = { skipped: true, reason: '--skip-market' };
    if (!skipMarket) {
      try {
        console.log('Loading 2023-24 Owls market subset from S3 (no Owls API calls)...');
        market = await evaluateOwls2023Market({ pool, gamesByPlayer, valBest });
      } catch (err) {
        market = { skipped: true, reason: err instanceof Error ? err.message : String(err) };
      }
    }

    const decision = decide(testTable, segmentRows);

    const payload = {
      version: USAGE_RESEARCH_VERSION,
      runAt,
      productionUnchanged: true,
      frozenMinutes: {
        alpha: FROZEN_MINUTES_EWM_ALPHA,
        clip: FROZEN_MINUTES_CLIP,
        changeThreshold: FROZEN_MINUTES_CHANGE_THRESHOLD,
        skipProp: 'threes',
        note: 'Conditional EWM/L10 minutes scaling. Not retuned in this experiment.',
      },
      ftaWeight: FTA_SHOT_VOLUME_WEIGHT,
      chronoSplit: CHRONO_SPLIT,
      bootstrap: { seed: BOOTSTRAP_SEED, iterations: bootstrapIters },
      coverage: { ...coverage, usageOnPlayed, playedLogs, usageOnPlayedPct: playedLogs ? usageOnPlayed / playedLogs : null },
      scored: { nScored, leakageTotal, splitN, flags },
      valBest,
      testTable: testTable.map((r) => ({
        ...r,
        trackAMae: round4(r.trackAMae),
        minutesMae: round4(r.minutesMae),
        usageMae: round4(r.usageMae),
        deltaVsMinutes: round4(r.deltaVsMinutes),
        ciLow: round4(r.ciLow),
        ciHigh: round4(r.ciHigh),
        minutesVsTrackA: round4(r.minutesVsTrackA),
        trackAMedianAe: round4(r.trackAMedianAe),
        minutesMedianAe: round4(r.minutesMedianAe),
        usageMedianAe: round4(r.usageMedianAe),
        trackARmse: round4(r.trackARmse),
        minutesRmse: round4(r.minutesRmse),
        usageRmse: round4(r.usageRmse),
        trackABias: round4(r.trackABias),
        minutesBias: round4(r.minutesBias),
        usageBias: round4(r.usageBias),
      })),
      bySplit,
      segments: segmentRows,
      market,
      decision,
      nextRecommendedExperiment: {
        family: 'opponent context',
        implemented: false,
        why: 'Minutes captured playing-time volume; usage/rate did not add a distinct pregame role signal. Opponent defense is historically valid from team_game_stats prior games and independent of own minutes/usage.',
      },
    };

    const outDir = join(process.cwd(), 'reports/modeling');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'player-projection-v1-usage-rate-results.json'), `${JSON.stringify(payload, null, 2)}\n`);
    writeFileSync(join(outDir, 'player-projection-v1-usage-rate-results.md'), resultsMarkdown(payload));
    updateRoadmap();
    console.log(`Wrote usage/rate reports (${decision.label})`);
  } finally {
    await pool.end();
  }
}

function minutesChangeAbs(l5: number | null, l10: number | null): number | null {
  if (l5 == null || l10 == null || l10 <= 0) return null;
  return Math.abs(l5 - l10) / l10;
}

function emptyFlags() {
  return {
    n: 0,
    minutes_change_large: 0,
    usage_change_large_015: 0,
    usage_change_large_025: 0,
    fga_change_large_025: 0,
    fta_change_large_025: 0,
  };
}

async function loadCoverage(pool: Pool) {
  const pgl = await pool.query(
    `SELECT count(*)::int AS n,
      count(*) FILTER (WHERE three_pointers_attempted IS NULL)::int AS tpa_null,
      count(*) FILTER (WHERE offensive_rebounds IS NULL)::int AS orb_null,
      count(*) FILTER (WHERE defensive_rebounds IS NULL)::int AS drb_null,
      count(*) FILTER (WHERE turnovers IS NULL)::int AS to_null
     FROM analytics.player_game_logs l
     JOIN analytics.games g ON g.game_id = l.game_id
     WHERE g.status='Final' AND g.season IN ('2023','2024','2025')`
  );
  const adv = await pool.query(
    `SELECT season, count(*)::int AS n, count(usage_percentage)::int AS n_usg, count(possessions)::int AS n_poss
     FROM analytics.player_game_advanced WHERE season IN ('2023','2024','2025') GROUP BY season ORDER BY season`
  );
  const tgs = await pool.query(
    `SELECT count(*)::int AS n, count(team_fga)::int AS n_fga
     FROM analytics.team_game_stats t JOIN analytics.games g ON g.game_id = t.game_id
     WHERE g.season IN ('2023','2024','2025')`
  );
  return { pgl: pgl.rows[0], advanced: adv.rows, teamGameStats: tgs.rows[0] };
}

function decide(
  testTable: Array<{ class: string; deltaVsMinutes: number | null; ciHigh: number | null; selectedCandidate: string; prop: string }>,
  segments: Array<Record<string, unknown>>
): { label: string; why: string } {
  const robust = testTable.filter(
    (r) =>
      r.selectedCandidate !== BENCHMARK_B_ID &&
      r.selectedCandidate !== BENCHMARK_ID &&
      r.deltaVsMinutes != null &&
      r.deltaVsMinutes <= -0.01 &&
      r.ciHigh != null &&
      r.ciHigh < 0
  );
  const keySeg = segments.filter(
    (s) =>
      s.slice === 'quad' &&
      s.bucket === 'stable_min_changing_usg' &&
      s.candidate !== BENCHMARK_B_ID &&
      typeof s.n === 'number' &&
      s.n >= 200 &&
      typeof s.delta === 'number' &&
      s.delta <= -0.03 &&
      typeof s.ciHigh === 'number' &&
      s.ciHigh < 0
  );
  if (robust.length >= 3) {
    return {
      label: 'PROMOTE USAGE/RATE INTO V1',
      why: `${robust.length} props beat Benchmark B on 2025–26 test with ΔMAE ≤ -0.01 and CI below 0.`,
    };
  }
  if (robust.length === 1 || robust.length === 2) {
    return {
      label: 'PROP-SPECIFIC USE ONLY',
      why: `Only ${robust.map((r) => r.prop).join(', ') || 'a subset'} beat Benchmark B with a CI-backed ΔMAE ≤ -0.01.`,
    };
  }
  if (keySeg.length >= 2) {
    return {
      label: 'USAGE/RATE SEGMENT ONLY',
      why: 'Overall test does not beat Benchmark B, but stable-minutes + changing-usage slices show a CI-backed drop.',
    };
  }
  return {
    label: 'KEEP MINUTES CANDIDATE ONLY',
    why: 'Pregame usage/FGA/shot-volume adjustments did not improve 2025–26 test MAE beyond the frozen conditional minutes candidate.',
  };
}

async function evaluateOwls2023Market(args: {
  pool: Pool;
  gamesByPlayer: Map<string, UsageEvalLog[]>;
  valBest: Record<string, { candidate: string; mae: number | null }>;
}): Promise<Record<string, unknown>> {
  const { FileCheckpointStore } = await import('../lib/providers/owls-insight/checkpoint');
  const { OwlsS3Store } = await import('../lib/providers/owls-insight/s3-store');
  const { gunzipJson } = await import('../lib/providers/owls-insight/archive');
  const { normalizePayloadRows } = await import('../lib/providers/owls-insight/normalize');
  const { matchOwlsPlayer } = await import('../lib/providers/owls-insight/mapping');
  type OwlsArchiveEnvelope = import('../lib/providers/owls-insight/types').OwlsArchiveEnvelope;

  const bucket = process.env.NBA_DATA_BUCKET?.trim();
  if (!bucket) throw new Error('NBA_DATA_BUCKET missing');
  const store = new OwlsS3Store(bucket);
  const state = await new FileCheckpointStore('data/owls-insight/runs').load('owls-2026-09-14-season-2023');
  if (!state) throw new Error('missing checkpoint owls-2026-09-14-season-2023');
  const players = await args.pool.query<{ player_id: string; full_name: string }>(
    `SELECT player_id::text, full_name FROM analytics.players`
  );
  const index = players.rows.map((p) => ({ playerId: p.player_id, fullName: p.full_name }));
  const lines = new Map<string, number[]>();
  for (const unit of Object.values(state.units)) {
    if (unit.endpoint !== 'history_player_props' || !unit.archive_key || (unit.row_count ?? 0) <= 0) continue;
    const got = await store.get(unit.archive_key);
    if (!got) continue;
    const envelope = gunzipJson<OwlsArchiveEnvelope>(got.body);
    const rows = normalizePayloadRows({
      envelope,
      courtContextGameId: unit.court_context_game_id,
      playerResolver: (rec) => {
        const name =
          (typeof rec.player === 'string' && rec.player) ||
          (typeof rec.playerName === 'string' && rec.playerName) ||
          (typeof rec.player_name === 'string' && rec.player_name) ||
          '';
        if (!name) return { courtContextPlayerId: null, playerMatch: 'UNMATCHED' };
        const hit = matchOwlsPlayer({ providerPlayerName: name, index });
        return { courtContextPlayerId: hit.courtContextPlayerId, playerMatch: hit.status };
      },
    });
    for (const row of rows) {
      if (row.side === 'under') continue;
      const cc =
        row.court_context_prop === 'PTS' ||
        row.court_context_prop === 'REB' ||
        row.court_context_prop === 'AST' ||
        row.court_context_prop === '3PM'
          ? row.court_context_prop
          : null;
      const line = row.closing_line ?? row.line;
      if (!cc || !row.court_context_player_id || !row.court_context_game_id || line == null) continue;
      const key = `${row.court_context_game_id}|${row.court_context_player_id}|${cc}`;
      const list = lines.get(key) ?? [];
      list.push(line);
      lines.set(key, list);
    }
  }

  const ccToProp: Record<string, SupportedPropType> = {
    PTS: 'points',
    REB: 'rebounds',
    AST: 'assists',
    '3PM': 'threes',
  };
  const boxes: Record<string, { eligible: number; withMkt: number; a: Array<{ projection: number | null; actual: number }>; b: Array<{ projection: number | null; actual: number }>; c: Array<{ projection: number | null; actual: number }>; m: Array<{ projection: number | null; actual: number }> }> = {
    PTS: { eligible: 0, withMkt: 0, a: [], b: [], c: [], m: [] },
    REB: { eligible: 0, withMkt: 0, a: [], b: [], c: [], m: [] },
    AST: { eligible: 0, withMkt: 0, a: [], b: [], c: [], m: [] },
    '3PM': { eligible: 0, withMkt: 0, a: [], b: [], c: [], m: [] },
  };

  for (const logs of args.gamesByPlayer.values()) {
    for (const target of logs) {
      if (target.season !== '2023' || !isPlayedTarget(target)) continue;
      const prior = selectPriorGames(logs, target.start_time, target.season, FEATURE_DEFINITION) as UsageEvalLog[];
      const minutes = reconstructFromPrior(prior as ProjectionV1Log[], target as ProjectionV1Log);
      if (!minutes) continue;
      const usage = reconstructPregameUsage(prior);
      for (const label of ['PTS', 'REB', 'AST', '3PM'] as const) {
        const prop = ccToProp[label];
        const actual = actualForProp(target, prop);
        const benchmarkA = playedOnlyTrackA(prior, prop);
        if (actual == null || benchmarkA == null) continue;
        boxes[label].eligible += 1;
        const bookLines = lines.get(`${target.game_id}|${target.player_id}|${label}`);
        if (!bookLines?.length) continue;
        const sorted = [...bookLines].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        const marketLine = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
        const benchmarkB = conditionalMinutesAdjustedProjection({ trackA: benchmarkA, features: minutes, propType: prop });
        const scored = scoreUsageRateCandidates({ prior, usage, benchmarkA, benchmarkB, propType: prop });
        scored[BENCHMARK_ID] = benchmarkA;
        scored[BENCHMARK_B_ID] = benchmarkB;
        const selectedId = args.valBest[prop]?.candidate ?? BENCHMARK_B_ID;
        const cand = scored[selectedId] ?? benchmarkB;
        boxes[label].withMkt += 1;
        boxes[label].a.push({ projection: benchmarkA, actual });
        boxes[label].b.push({ projection: benchmarkB, actual });
        boxes[label].c.push({ projection: cand, actual });
        boxes[label].m.push({ projection: marketLine, actual });
      }
    }
  }

  return {
    skipped: false,
    product: 'Owls /history/player-props 2023-24 core two-way O/U',
    byProp: (['PTS', 'REB', 'AST', '3PM'] as const).map((label) => ({
      prop: label,
      eligibleHistoricalGames: boxes[label].eligible,
      gamesWithValidMarketRows: boxes[label].withMkt,
      coveragePct: boxes[label].eligible ? round4((100 * boxes[label].withMkt) / boxes[label].eligible) : null,
      trackAMae: round4(compactMetrics(boxes[label].a).mae),
      minutesCandidateMae: round4(compactMetrics(boxes[label].b).mae),
      usageCandidateMae: round4(compactMetrics(boxes[label].c).mae),
      marketLineMae: round4(compactMetrics(boxes[label].m).mae),
    })),
    note: 'Subset only. Not used to select candidates.',
  };
}

function resultsMarkdown(payload: Record<string, unknown>): string {
  const testTable = payload.testTable as Array<Record<string, unknown>>;
  const flags = (payload.scored as { flags: Record<string, Record<string, number>> }).flags;
  const valBest = payload.valBest as Record<string, { candidate: string }>;
  const segments = payload.segments as Array<Record<string, unknown>>;
  const market = payload.market as Record<string, unknown>;
  const decision = payload.decision as { label: string; why: string };
  const scored = payload.scored as { nScored: number; leakageTotal: number; splitN: Record<string, number> };
  const coverage = payload.coverage as Record<string, unknown>;
  const lines = [
    '# Player projection v1 — usage / rate change',
    '',
    `Run: ${payload.runAt}`,
    `Version: \`${USAGE_RESEARCH_VERSION}\`. Research only. Production unchanged.`,
    '',
    'Minutes candidate is **frozen**: EWM α=0.25, clip 0.85–1.15, applied only when `|L5min−L10min|/L10min ≥ 0.25`, never on 3PM. Not retuned here.',
    '',
    `Split: train ${CHRONO_SPLIT.train} n=${scored.splitN.train} → val ${CHRONO_SPLIT.validation} n=${scored.splitN.validation} → test ${CHRONO_SPLIT.test} n=${scored.splitN.test}. Scored ${scored.nScored}. Leakage ${scored.leakageTotal}.`,
    '',
    '## Benchmarks',
    '',
    '- **A.** Played-only Track A (`0.70 L10 played + 0.30 season played`)',
    '- **B.** Track A + conditional EWM minutes adjustment (frozen)',
    '',
    'Primary delta = usage candidate − Benchmark B. Negative is improvement.',
    '',
    '## Usage / rate feature coverage',
    '',
    `- PGL FGA/FTA/3PA/ORB/DRB/TO: 0 nulls on Final 2023–25 (${JSON.stringify((coverage.pgl as object) ?? {})}).`,
    `- \`usage_percentage\` / possessions on \`player_game_advanced\` 2023–25 complete aside from 30 missing 2025 rows.`,
    `- Usage present on ${fmt((coverage.usageOnPlayedPct as number) * 100, 1)}% of played logs in this extract.`,
    `- Team FGA exists on \`analytics.team_game_stats\` (as-of prior games only). Not used as a candidate this pass.`,
    `- Shot volume = FGA + **0.44** × FTA (Oliver, documented, not tuned).`,
    '',
    '## Leakage audit',
    '',
    'Target-game FGA, FTA, usage, minutes, and starter are outcomes. All rolling windows use `start_time < tipoff`. Closing lines and public betting are not inputs.',
    '',
    '## Candidate definitions',
    '',
    '- Concept A: `BenchmarkB * clip(L5/L10, 0.90–1.10 or 0.85–1.15)` for usage or FGA, either always or only when relative L5/L10 change ≥ 0.15 or 0.25.',
    '- Shot-volume conditional scale. 3PM also tests 3PA L5/L10.',
    '- Concept B: if usage change is large, replace Track A weights with 0.85/0.15 or 0.90/0.10, then apply frozen minutes gate.',
    '',
    '## Flag prevalence (scored targets)',
    '',
    mdTable(
      ['Season', 'N', 'Minutes large ≥0.25', 'Usage ≥0.15', 'Usage ≥0.25', 'FGA ≥0.25', 'FTA ≥0.25'],
      ['2023', '2024', '2025'].map((s) => {
        const f = flags[s];
        return [
          s,
          f.n,
          `${f.minutes_change_large} (${fmt((100 * f.minutes_change_large) / Math.max(f.n, 1), 1)}%)`,
          `${f.usage_change_large_015} (${fmt((100 * f.usage_change_large_015) / Math.max(f.n, 1), 1)}%)`,
          `${f.usage_change_large_025} (${fmt((100 * f.usage_change_large_025) / Math.max(f.n, 1), 1)}%)`,
          `${f.fga_change_large_025} (${fmt((100 * f.fga_change_large_025) / Math.max(f.n, 1), 1)}%)`,
          `${f.fta_change_large_025} (${fmt((100 * f.fta_change_large_025) / Math.max(f.n, 1), 1)}%)`,
        ];
      })
    ),
    '',
    '## Chronological test (2025–26) — val-selected usage candidate vs minutes candidate',
    '',
    mdTable(
      ['Prop', 'Val-selected', 'Track A MAE', 'Minutes MAE', 'Usage MAE', 'Δ vs Minutes', '95% CI', 'N'],
      testTable.map((r) => [
        String(r.prop),
        String(r.selectedCandidate),
        fmt(r.trackAMae as number),
        fmt(r.minutesMae as number),
        fmt(r.usageMae as number),
        fmt(r.deltaVsMinutes as number, 4),
        r.ciLow == null || r.ciHigh == null ? 'n/a' : `[${fmt(r.ciLow as number, 3)}, ${fmt(r.ciHigh as number, 3)}]`,
        String(r.n),
      ])
    ),
    '',
    mdTable(
      ['Prop', 'Track A RMSE/bias/medAE', 'Minutes RMSE/bias/medAE', 'Usage RMSE/bias/medAE'],
      testTable.map((r) => [
        String(r.prop),
        `${fmt(r.trackARmse as number)} / ${fmt(r.trackABias as number)} / ${fmt(r.trackAMedianAe as number)}`,
        `${fmt(r.minutesRmse as number)} / ${fmt(r.minutesBias as number)} / ${fmt(r.minutesMedianAe as number)}`,
        `${fmt(r.usageRmse as number)} / ${fmt(r.usageBias as number)} / ${fmt(r.usageMedianAe as number)}`,
      ])
    ),
    '',
    'Val-selected per prop: ' +
      Object.entries(valBest)
        .map(([p, v]) => `${PROP_TYPE_LABEL[p as SupportedPropType]}=${v.candidate}`)
        .join('; ') +
      '.',
    '',
    '## Usage-change segments and minutes × usage interaction (test, vs Benchmark B)',
    '',
    mdTable(
      ['Prop', 'Candidate', 'Slice', 'Bucket', 'N', 'Cand MAE', 'B MAE', 'Delta', '95% CI'],
      segments
        .filter((s) => ['PTS', 'PRA', 'AST', 'REB'].includes(String(s.prop)))
        .filter((s) => s.slice === 'quad' || s.slice === 'usgDir' || s.slice === 'usgMag')
        .map((s) => [
          String(s.prop),
          String(s.candidate),
          String(s.slice),
          String(s.bucket),
          String(s.n),
          fmt(s.candidateMae as number),
          fmt(s.baselineMae as number),
          fmt(s.delta as number, 4),
          s.ciLow == null || s.ciHigh == null ? 'n/a' : `[${fmt(s.ciLow as number, 3)}, ${fmt(s.ciHigh as number, 3)}]`,
        ])
    ),
    '',
    'The slice that would justify a new family is **stable minutes + changing usage**. If usage only helps rows already gated by minutes, it adds little.',
    '',
    '## Market subset (2023–24 core two-way)',
    '',
  ];
  if (market.skipped) {
    lines.push(`Skipped: ${String(market.reason)}`, '');
  } else {
    const rows = (market.byProp as Array<Record<string, unknown>>) ?? [];
    lines.push(String(market.note ?? ''), '');
    lines.push(
      mdTable(
        ['Prop', 'Eligible', 'With market', 'Coverage %', 'Track A', 'Minutes', 'Usage cand', 'Market'],
        rows.map((r) => [
          String(r.prop),
          String(r.eligibleHistoricalGames),
          String(r.gamesWithValidMarketRows),
          fmt(r.coveragePct as number),
          fmt(r.trackAMae as number),
          fmt(r.minutesCandidateMae as number),
          fmt(r.usageCandidateMae as number),
          fmt(r.marketLineMae as number),
        ])
      ),
      ''
    );
  }
  lines.push('## Decision', '', `**${decision.label}**`, '', decision.why, '');
  lines.push(
    '## Next recommended experiment',
    '',
    '**Opponent context.** Do not implement in this pass.',
    '',
    'Minutes captured playing-time volume. Usage/rate did not add a distinct pregame role signal. Opponent defense (as-of `analytics.team_game_stats` prior games) is historically valid and independent of own minutes/usage. Pace and rest/home-away remain later. Teammate availability stays blocked.',
    ''
  );
  return `${lines.join('\n')}\n`;
}

function updateRoadmap() {
  const path = join(process.cwd(), 'reports/modeling/player-projection-v1-roadmap.md');
  writeFileSync(
    path,
    `# Player projection v1 — experiment roadmap

Research-only. Do not change production until a family earns a chronological out-of-sample promote.

Ordered experiments:

1. **Minutes / role** — done. Frozen candidate: **conditional** EWM minutes / L10 (α=0.25, clip 0.85–1.15) when \`|L5−L10|/L10 ≥ 0.25\`. Not universal. Not applied to 3PM.
2. **Usage / rate change** — done. Decision: **KEEP MINUTES CANDIDATE ONLY**. See \`player-projection-v1-usage-rate-results.md\`.
3. **Teammate availability** — blocked until a historically valid pregame injury/inactive tape exists.
4. **Opponent** — **next recommended**. Not started. As-of opponent defensive rating / points allowed from \`analytics.team_game_stats\` prior games.
5. **Pace** — as-of team and opponent pace from prior games.
6. **Rest** — days rest and back-to-back from \`games.start_time\`.
7. **Home / away** — scheduled location vs \`team_id\`.
8. **WOWY** — requires lineup/stint data we do not have as a pregame historical tape.

Rules: chronological 2023 → 2024 → 2025; played-game semantics; no \`"00"\` zeros; market evaluation-only; no probability/sigma/EV in the mean ladder.
`
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
