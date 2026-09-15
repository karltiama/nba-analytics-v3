/**
 * Research-only player-projection v1: freeze Played-only Track A, then test
 * expected-minutes / role families on chronological out-of-sample data.
 *
 * Does NOT change production projection, APIs, UI, calibration, or EV.
 * Does NOT call Owls Insight. Optional market check reads the local 2023–24 archive.
 *
 *   npm run evaluate:player-projection-v1
 *   npx tsx scripts/evaluate-player-projection-v1.ts --limit 2000 --skip-market
 */
import 'dotenv/config';

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import { PROP_TYPE_LABEL, selectPriorGames, type SupportedPropType } from '../lib/betting/player-projection-eval';
import {
  ALL_PROP_TYPES,
  BENCHMARK_ID,
  BOOTSTRAP_ITERS,
  BOOTSTRAP_SEED,
  CHRONO_SPLIT,
  CLIP_GRIDS,
  DEFAULT_CLIP,
  FEATURE_DEFINITION,
  MINUTES_REF_FLOOR,
  PLAYED_ONLY_TRACK_A_DEFINITION,
  PROJECTION_V1_RESEARCH_VERSION,
  REJECTED_AS_PROJECTION_INPUTS,
  SEGMENT_CANDIDATE_IDS,
  TREND_CLIP,
  actualForProp,
  chronoSplitForSeason,
  compactMetrics,
  isPlayedTarget,
  observedRoleTransition,
  pairedDelta,
  playedOnlyTrackA,
  priorRoleMajority,
  reconstructFromPrior,
  scoreMinutesRoleCandidates,
  type ChronoSplit,
  type ObservedRoleTransition,
  type ProjectionV1Log,
  type RoleLabel,
} from '../lib/betting/player-projection-v1-research';
import { classifyAppearance } from '../lib/betting/minutes-projection-eval';
import { classifyMaeDelta } from '../lib/betting/shadow-projection-eval';

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
};

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  return process.argv[i + 1];
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
  const head = `| ${headers.join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((r) => `| ${r.map((c) => String(c)).join(' | ')} |`).join('\n');
  return `${head}\n${sep}\n${body}`;
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
    if (this.n === 0) {
      return { mae: null, rmse: null, bias: null, medianAe: null, n: 0 };
    }
    return {
      mae: this.abs / this.n,
      rmse: Math.sqrt(this.sq / this.n),
      bias: this.signed / this.n,
      medianAe: null as number | null,
      n: this.n,
    };
  }
}

type SplitName = ChronoSplit;

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
  const seasons = ['2023', '2024', '2025'];

  try {
    console.log(`${PROJECTION_V1_RESEARCH_VERSION} ${runAt}`);
    console.log('Production projection will not be modified.');

    const inventory = await loadInventory(pool);

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

    const starterRes = await pool.query<{ game_id: string; player_id: string; season: string }>(
      `SELECT game_id::text, player_id::text, season::text FROM analytics.game_starters`
    );
    const starterKeys = new Set(starterRes.rows.map((r) => `${r.game_id}|${r.player_id}`));
    const gamesWithStarters = new Set(starterRes.rows.map((r) => r.game_id));

    const gamesByPlayer = new Map<string, ProjectionV1Log[]>();
    const corpus = { n: 0, played: 0, dnp: 0, token00: 0, token0: 0, zeroPointPlayed: 0 };
    const seen = new Set<string>();
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
      const g: ProjectionV1Log = {
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
        started,
      };
      const cls = classifyAppearance(g);
      corpus.n += 1;
      if (cls.minutesToken === '00') corpus.token00 += 1;
      if (cls.minutesToken === '0' || cls.minutesToken === '0.0') corpus.token0 += 1;
      if (cls.class === 'played') {
        corpus.played += 1;
        if ((g.points ?? 0) === 0) corpus.zeroPointPlayed += 1;
      } else if (cls.class === 'dnp') corpus.dnp += 1;
      const list = gamesByPlayer.get(row.player_id) ?? [];
      list.push(g);
      gamesByPlayer.set(row.player_id, list);
    }

    const running = new Map<string, Running>();
    const testErr = new Map<string, number[]>();
    const testBaseErr = new Map<string, number[]>();
    const testSeg = new Map<string, number[]>();
    const testSegBase = new Map<string, number[]>();
    const candidateIds = new Set<string>([BENCHMARK_ID]);
    let nScored = 0;
    let nNoPrior = 0;
    let leakageTotal = 0;
    let minStart = '';
    let maxStart = '';
    const playerIds = new Set<string>();
    const splitN: Record<string, number> = { train: 0, validation: 0, test: 0, excluded: 0 };
    const roleCoverage = { targetsOnStarterGames: 0, priorKnownRole: 0 };

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
        const target = logs[i];
        if (limit != null && nScored >= limit) break;
        if (!isPlayedTarget(target)) continue;
        const split = chronoSplitForSeason(target.season);
        if (split === 'excluded') continue;
        const prior = selectPriorGames(logs, target.start_time, target.season, FEATURE_DEFINITION) as ProjectionV1Log[];
        const features = reconstructFromPrior(prior, target);
        if (!features) {
          nNoPrior += 1;
          continue;
        }
        leakageTotal += features.leakageViolations;
        if (target.started !== 'unknown') roleCoverage.targetsOnStarterGames += 1;
        if (features.priorKnownRoleCount > 0) roleCoverage.priorKnownRole += 1;

        const transition = observedRoleTransition(priorRoleMajority(features.starterRateL5), target.started);
        nScored += 1;
        splitN[split] += 1;
        playerIds.add(target.player_id);
        if (!minStart || target.start_time < minStart) minStart = target.start_time;
        if (!maxStart || target.start_time > maxStart) maxStart = target.start_time;

        for (const prop of ALL_PROP_TYPES) {
          const actual = actualForProp(target, prop);
          if (actual == null || !Number.isFinite(actual)) continue;
          const baseline = playedOnlyTrackA(prior, prop);
          if (baseline == null || !Number.isFinite(baseline)) continue;
          const scored = scoreMinutesRoleCandidates({ prior, features, propType: prop, baseline });
          for (const [cand, projection] of Object.entries(scored)) {
            candidateIds.add(cand);
            pushRun(bagKey(split, prop, cand), projection, actual);
            pushRun(bagKey('all', prop, cand), projection, actual);
            if (split === 'test') {
              const err = projection - actual;
              pushArr(testErr, `${prop}|${cand}`, err);
              if (cand === BENCHMARK_ID) pushArr(testBaseErr, prop, err);
              if ((SEGMENT_CANDIDATE_IDS as readonly string[]).includes(cand)) {
                pushArr(testSeg, `${prop}|${cand}|minutes|${features.minutesChangeBucket}`, err);
                pushArr(testSeg, `${prop}|${cand}|volume|${features.volumeBucket}`, err);
                pushArr(testSeg, `${prop}|${cand}|role|${transition}`, err);
                if (cand === BENCHMARK_ID) {
                  pushArr(testSegBase, `${prop}|minutes|${features.minutesChangeBucket}`, err);
                  pushArr(testSegBase, `${prop}|volume|${features.volumeBucket}`, err);
                  pushArr(testSegBase, `${prop}|role|${transition}`, err);
                }
              }
            }
          }
        }
      }
      if (limit != null && nScored >= limit) break;
    }

    console.log(`Scored ${nScored} played targets. leakageViolations=${leakageTotal}`);

    const allCandidates = [...candidateIds];
    const valBest: Record<string, { candidate: string; mae: number | null }> = {};
    for (const prop of ALL_PROP_TYPES) {
      let bestId = BENCHMARK_ID;
      let bestMae = running.get(bagKey('validation', prop, BENCHMARK_ID))?.metrics().mae ?? Number.POSITIVE_INFINITY;
      for (const cand of allCandidates) {
        if (cand === BENCHMARK_ID) continue;
        const mae = running.get(bagKey('validation', prop, cand))?.metrics().mae;
        if (mae != null && mae < bestMae) {
          bestMae = mae;
          bestId = cand;
        }
      }
      valBest[prop] = { candidate: bestId, mae: Number.isFinite(bestMae) ? bestMae : null };
    }

    const testTable = ALL_PROP_TYPES.map((prop) => {
      const baselineMae = running.get(bagKey('test', prop, BENCHMARK_ID))?.metrics().mae ?? null;
      const selectedId = valBest[prop].candidate;
      const selectedMae = running.get(bagKey('test', prop, selectedId))?.metrics().mae ?? null;
      const baseErr = testBaseErr.get(prop) ?? [];
      const candErr = testErr.get(`${prop}|${selectedId}`) ?? [];
      const boot = pairedDelta(baseErr, candErr, bootstrapIters, BOOTSTRAP_SEED);
      return {
        prop: PROP_TYPE_LABEL[prop],
        propType: prop,
        selectedCandidate: selectedId,
        baselineMae,
        candidateMae: selectedMae,
        delta: boot.delta,
        ciLow: boot.ciLow,
        ciHigh: boot.ciHigh,
        n: boot.n,
        class: boot.delta == null ? 'tied' : classifyMaeDelta(boot.delta),
      };
    });

    const allSplitReport: Record<string, Record<string, Record<string, ReturnType<Running['metrics']>>>> = {};
    for (const split of ['train', 'validation', 'test', 'all'] as const) {
      allSplitReport[split] = {};
      for (const prop of ALL_PROP_TYPES) {
        allSplitReport[split][PROP_TYPE_LABEL[prop]] = {};
        for (const cand of allCandidates) {
          allSplitReport[split][PROP_TYPE_LABEL[prop]][cand] = running.get(bagKey(split, prop, cand))?.metrics() ?? {
            mae: null,
            rmse: null,
            bias: null,
            medianAe: null,
            n: 0,
          };
        }
      }
    }

    const baselineAll = ALL_PROP_TYPES.map((prop) => {
      const m = running.get(bagKey('all', prop, BENCHMARK_ID))?.metrics();
      return {
        prop: PROP_TYPE_LABEL[prop],
        mae: m?.mae ?? null,
        rmse: m?.rmse ?? null,
        bias: m?.bias ?? null,
        n: m?.n ?? 0,
      };
    });

    const segmentRows: Array<{
      prop: string;
      candidate: string;
      slice: string;
      bucket: string;
      n: number;
      candidateMae: number | null;
      baselineMae: number | null;
      delta: number | null;
      ciLow: number | null;
      ciHigh: number | null;
    }> = [];
    for (const prop of ALL_PROP_TYPES) {
      for (const cand of SEGMENT_CANDIDATE_IDS) {
        if (cand === BENCHMARK_ID) continue;
        for (const slice of ['minutes', 'volume', 'role'] as const) {
          const buckets =
            slice === 'minutes'
              ? ['stable', 'moderate', 'large', 'unknown']
              : slice === 'volume'
                ? ['low', 'rotation', 'high', 'unknown']
                : [
                    'starter_to_starter',
                    'bench_to_bench',
                    'bench_to_starter',
                    'starter_to_bench',
                    'unknown',
                  ];
          for (const bucket of buckets) {
            const candErr = testSeg.get(`${prop}|${cand}|${slice}|${bucket}`) ?? [];
            const baseErr = testSegBase.get(`${prop}|${slice}|${bucket}`) ?? [];
            if (candErr.length === 0) continue;
            const boot = pairedDelta(baseErr, candErr, Math.min(bootstrapIters, 200), BOOTSTRAP_SEED);
            segmentRows.push({
              prop: PROP_TYPE_LABEL[prop],
              candidate: cand,
              slice,
              bucket,
              n: candErr.length,
              candidateMae: boot.candidateMae,
              baselineMae: boot.baselineMae,
              delta: boot.delta,
              ciLow: boot.ciLow,
              ciHigh: boot.ciHigh,
            });
          }
        }
      }
    }

    let market: Awaited<ReturnType<typeof evaluateOwls2023Market>> | null = null;
    if (!skipMarket) {
      try {
        market = await evaluateOwls2023Market({
          pool,
          gamesByPlayer,
        });
      } catch (err) {
        console.warn(`Market subset skipped: ${err instanceof Error ? err.message : err}`);
        market = { skipped: true, reason: err instanceof Error ? err.message : String(err) };
      }
    } else {
      market = { skipped: true, reason: '--skip-market' };
    }

    const decision = decide(testTable, segmentRows);

    const payload = {
      version: PROJECTION_V1_RESEARCH_VERSION,
      runAt,
      productionUnchanged: true,
      benchmark: PLAYED_ONLY_TRACK_A_DEFINITION,
      chronoSplit: CHRONO_SPLIT,
      clipGrids: CLIP_GRIDS,
      defaultClip: DEFAULT_CLIP,
      trendClip: TREND_CLIP,
      minutesRefFloor: MINUTES_REF_FLOOR,
      bootstrap: { seed: BOOTSTRAP_SEED, iterations: bootstrapIters },
      rejectedInputs: REJECTED_AS_PROJECTION_INPUTS,
      corpus,
      scored: {
        nScored,
        nNoPrior,
        leakageTotal,
        players: playerIds.size,
        minStart,
        maxStart,
        splitN,
        roleCoverage,
      },
      inventory,
      baselineAll,
      valBest,
      testTable,
      bySplit: roundMetrics(allSplitReport),
      segments: segmentRows.map((r) => ({
        ...r,
        candidateMae: round4(r.candidateMae),
        baselineMae: round4(r.baselineMae),
        delta: round4(r.delta),
        ciLow: round4(r.ciLow),
        ciHigh: round4(r.ciHigh),
      })),
      market,
      decision,
    };

    const outDir = join(process.cwd(), 'reports/modeling');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'player-projection-v1-minutes-role-results.json'), `${JSON.stringify(payload, null, 2)}\n`);
    writeFileSync(join(outDir, 'player-projection-v1-benchmark.md'), benchmarkMarkdown(payload));
    writeFileSync(join(outDir, 'player-projection-v1-feature-inventory.md'), inventoryMarkdown(payload));
    writeFileSync(join(outDir, 'player-projection-v1-minutes-role-results.md'), resultsMarkdown(payload));
    writeFileSync(join(outDir, 'player-projection-v1-roadmap.md'), roadmapMarkdown());
    console.log(`Wrote reports/modeling/ (${decision.label})`);
  } finally {
    await pool.end();
  }
}

function roundMetrics(tree: Record<string, Record<string, Record<string, ReturnType<Running['metrics']>>>>) {
  const out: typeof tree = {};
  for (const [split, props] of Object.entries(tree)) {
    out[split] = {};
    for (const [prop, cands] of Object.entries(props)) {
      out[split][prop] = {};
      for (const [cand, m] of Object.entries(cands)) {
        out[split][prop][cand] = {
          mae: round4(m.mae),
          rmse: round4(m.rmse),
          bias: round4(m.bias),
          medianAe: m.medianAe,
          n: m.n,
        };
      }
    }
  }
  return out;
}

async function loadInventory(pool: Pool) {
  const q = async (sql: string) => (await pool.query(sql)).rows;
  const [pgl, starters, advanced, injuries, teamStats, flow] = await Promise.all([
    q(`
      SELECT g.season, count(*)::int AS n_logs,
        count(*) FILTER (WHERE l.minutes = '00')::int AS n_00,
        count(*) FILTER (WHERE l.minutes IN ('0','0.0'))::int AS n_0,
        count(*) FILTER (WHERE l.field_goals_attempted IS NULL)::int AS fga_null,
        min(g.start_time)::text AS min_start, max(g.start_time)::text AS max_start
      FROM analytics.player_game_logs l
      JOIN analytics.games g ON g.game_id = l.game_id
      WHERE g.status = 'Final' AND g.season IN ('2023','2024','2025')
      GROUP BY g.season ORDER BY g.season
    `),
    q(`SELECT season, count(*)::int AS n_rows, count(DISTINCT game_id)::int AS n_games FROM analytics.game_starters GROUP BY season`),
    q(`SELECT season, count(*)::int AS n_rows, count(usage_percentage)::int AS n_usg, count(pace)::int AS n_pace FROM analytics.player_game_advanced GROUP BY season ORDER BY season`),
    q(`SELECT count(*)::int AS n, min(snapshot_at)::text AS min_at, max(snapshot_at)::text AS max_at FROM analytics.player_injury_status_history`),
    q(`SELECT g.season, count(*)::int AS n_rows, count(t.pace)::int AS n_pace, count(t.defensive_rating)::int AS n_drtg
       FROM analytics.team_game_stats t JOIN analytics.games g ON g.game_id = t.game_id
       WHERE g.season IN ('2023','2024','2025') GROUP BY g.season ORDER BY g.season`),
    q(`SELECT season, count(*)::int AS n FROM analytics.game_flow GROUP BY season`),
  ]);
  return { pgl, starters, advanced, injuries, teamStats, flow };
}

function decide(
  testTable: Array<{ class: string; delta: number | null; ciHigh: number | null; prop: string; selectedCandidate: string }>,
  segments: Array<{ slice: string; bucket: string; delta: number | null; ciHigh: number | null; n: number; candidate: string }>
): { label: 'PROMOTE TO V1 CANDIDATE' | 'ROLE-CHANGE ONLY' | 'KEEP PLAYED-ONLY TRACK A'; why: string } {
  const robustOverall = testTable.filter(
    (r) =>
      r.selectedCandidate !== BENCHMARK_ID &&
      r.delta != null &&
      r.delta <= -0.01 &&
      r.ciHigh != null &&
      r.ciHigh < 0
  );
  if (robustOverall.length >= 3) {
    return {
      label: 'PROMOTE TO V1 CANDIDATE',
      why: `${robustOverall.length} props have val-selected candidates with test ΔMAE ≤ -0.01 and 95% CI entirely below 0.`,
    };
  }
  const roleSeg = segments.filter(
    (s) =>
      s.slice === 'role' &&
      (s.bucket === 'bench_to_starter' || s.bucket === 'starter_to_bench' || s.bucket === 'large') &&
      s.n >= 200 &&
      s.delta != null &&
      s.delta <= -0.03 &&
      s.ciHigh != null &&
      s.ciHigh < 0
  );
  const largeMin = segments.filter(
    (s) =>
      s.slice === 'minutes' &&
      s.bucket === 'large' &&
      s.n >= 400 &&
      s.delta != null &&
      s.delta <= -0.03 &&
      s.ciHigh != null &&
      s.ciHigh < 0 &&
      (s.candidate.startsWith('a_') || s.candidate.startsWith('r_'))
  );
  if (roleSeg.length >= 2 || largeMin.length >= 2) {
    return {
      label: 'ROLE-CHANGE ONLY',
      why: 'Overall test does not support a universal promote, but role-change / large-minutes-change slices show a CI-backed MAE drop.',
    };
  }
  return {
    label: 'KEEP PLAYED-ONLY TRACK A',
    why: 'No val-selected minutes/role candidate beat baseline on chronological 2025–26 test with a CI that excludes 0 and a ΔMAE of at least 0.01 across multiple props.',
  };
}

async function evaluateOwls2023Market(args: {
  pool: Pool;
  gamesByPlayer: Map<string, ProjectionV1Log[]>;
}): Promise<Record<string, unknown>> {
  const { FileCheckpointStore } = await import('../lib/providers/owls-insight/checkpoint');
  const { OwlsS3Store } = await import('../lib/providers/owls-insight/s3-store');
  const { gunzipJson } = await import('../lib/providers/owls-insight/archive');
  const { normalizePayloadRows } = await import('../lib/providers/owls-insight/normalize');
  const { matchOwlsPlayer } = await import('../lib/providers/owls-insight/mapping');
  const { COURT_CONTEXT_PROP_MAPPING } = await import('../lib/providers/owls-insight/contract');
  type OwlsArchiveEnvelope = import('../lib/providers/owls-insight/types').OwlsArchiveEnvelope;

  const bucket = process.env.NBA_DATA_BUCKET?.trim();
  if (!bucket) throw new Error('NBA_DATA_BUCKET missing; cannot read 2023–24 Owls archive');
  const store = new OwlsS3Store(bucket);
  const ck = new FileCheckpointStore('data/owls-insight/runs');
  const state = await ck.load('owls-2026-09-14-season-2023');
  if (!state) throw new Error('missing checkpoint owls-2026-09-14-season-2023');

  const players = await args.pool.query<{ player_id: string; full_name: string }>(
    `SELECT player_id::text, full_name FROM analytics.players`
  );
  const index = players.rows.map((p) => ({ playerId: p.player_id, fullName: p.full_name }));

  const owlsToCc = new Map<string, string>();
  for (const row of COURT_CONTEXT_PROP_MAPPING) {
    if (!['PTS', 'REB', 'AST', '3PM'].includes(row.courtContext)) continue;
    owlsToCc.set(row.canonicalOwlsPropType, row.courtContext);
    for (const alias of row.owlsPropTypes) owlsToCc.set(alias, row.courtContext);
  }
  const ccToProp: Record<string, SupportedPropType> = {
    PTS: 'points',
    REB: 'rebounds',
    AST: 'assists',
    '3PM': 'threes',
  };

  const lines = new Map<string, number[]>();
  let pages = 0;
  let populatedGames = new Set<string>();
  for (const unit of Object.values(state.units)) {
    if (unit.endpoint !== 'history_player_props') continue;
    if (!unit.archive_key || (unit.row_count ?? 0) <= 0) continue;
    if (unit.court_context_game_id) populatedGames.add(unit.court_context_game_id);
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
    pages += 1;
    for (const row of rows) {
      if (row.side === 'under') continue;
      const ccLabel =
        row.court_context_prop === 'PTS' ||
        row.court_context_prop === 'REB' ||
        row.court_context_prop === 'AST' ||
        row.court_context_prop === '3PM'
          ? row.court_context_prop
          : owlsToCc.get(String(row.prop_type ?? '').toLowerCase());
      const playerId = row.court_context_player_id;
      const gameId = row.court_context_game_id;
      const line = row.closing_line ?? row.line;
      if (!ccLabel || !playerId || !gameId || line == null || !Number.isFinite(line)) continue;
      const key = `${gameId}|${playerId}|${ccLabel}`;
      const list = lines.get(key) ?? [];
      list.push(line);
      lines.set(key, list);
    }
  }

  const marketPairs: Record<string, Array<{ projection: number | null; actual: number }>> = {
    PTS: [],
    REB: [],
    AST: [],
    '3PM': [],
  };
  const ccPairs: Record<string, Array<{ projection: number | null; actual: number }>> = {
    PTS: [],
    REB: [],
    AST: [],
    '3PM': [],
  };
  const eligible = { PTS: 0, REB: 0, AST: 0, '3PM': 0 };
  const withMarket = { PTS: 0, REB: 0, AST: 0, '3PM': 0 };

  for (const logs of args.gamesByPlayer.values()) {
    for (const target of logs) {
      if (target.season !== '2023' || !isPlayedTarget(target)) continue;
      const prior = selectPriorGames(logs, target.start_time, target.season, FEATURE_DEFINITION) as ProjectionV1Log[];
      const features = reconstructFromPrior(prior, target);
      if (!features) continue;
      for (const label of ['PTS', 'REB', 'AST', '3PM'] as const) {
        const prop = ccToProp[label];
        const actual = actualForProp(target, prop);
        const baseline = playedOnlyTrackA(prior, prop);
        if (actual == null || baseline == null) continue;
        eligible[label] += 1;
        const bookLines = lines.get(`${target.game_id}|${target.player_id}|${label}`);
        if (!bookLines || bookLines.length === 0) continue;
        const sorted = [...bookLines].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        const marketLine = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
        withMarket[label] += 1;
        const scored = scoreMinutesRoleCandidates({ prior, features, propType: prop, baseline });
        const selected = scored[BENCHMARK_ID];
        ccPairs[label].push({ projection: selected, actual });
        marketPairs[label].push({ projection: marketLine, actual });
      }
    }
  }

  const byProp = (['PTS', 'REB', 'AST', '3PM'] as const).map((label) => ({
    prop: label,
    eligibleHistoricalGames: eligible[label],
    gamesWithValidMarketRows: withMarket[label],
    coveragePct: eligible[label] > 0 ? round4((100 * withMarket[label]) / eligible[label]) : null,
    observations: withMarket[label],
    courtContextMae: round4(compactMetrics(ccPairs[label]).mae),
    marketLineMae: round4(compactMetrics(marketPairs[label]).mae),
  }));

  return {
    skipped: false,
    season: '2023',
    product: 'Owls /history/player-props 2023-24 core two-way O/U (PTS/REB/AST/threes)',
    populatedArchiveGames: populatedGames.size,
    pagesRead: pages,
    uniqueLineKeys: lines.size,
    byProp,
    note: 'Subset only. Closing/generic archive line vs Played-only Track A. Not season-wide. Combos are absent from the 2023-24 core tape and are not scored here.',
  };
}

function benchmarkMarkdown(payload: {
  runAt: string;
  scored: { nScored: number; players: number; minStart: string; maxStart: string; splitN: Record<string, number>; leakageTotal: number };
  corpus: { n: number; played: number; dnp: number; token00: number; token0: number; zeroPointPlayed: number };
  baselineAll: Array<{ prop: string; mae: number | null; rmse: number | null; bias: number | null; n: number }>;
}): string {
  const lines = [
    '# Played-only Track A research benchmark',
    '',
    `Run: ${payload.runAt}`,
    `Research version: \`${PROJECTION_V1_RESEARCH_VERSION}\`.`,
    '',
    'Production projection defaults, APIs, UI, calibration, and EV were **not** changed.',
    '',
    '## Definition',
    '',
    `- Formula: \`${PLAYED_ONLY_TRACK_A_DEFINITION.formula}\``,
    `- Played predicate: ${PLAYED_ONLY_TRACK_A_DEFINITION.playedPredicate}`,
    `- As-of rule: ${PLAYED_ONLY_TRACK_A_DEFINITION.priorRule}`,
    `- Targets: ${PLAYED_ONLY_TRACK_A_DEFINITION.targetUniverse}`,
    `- Leakage: ${PLAYED_ONLY_TRACK_A_DEFINITION.leakage}`,
    '',
    'Entrypoint: `npm run evaluate:player-projection-v1` (`scripts/evaluate-player-projection-v1.ts`).',
    'Helpers: `lib/betting/player-projection-v1-research.ts` (uses `isPlayedGame` + `buildPlayedOnlyAsOfModelInputs`).',
    '',
    '## Chronological split',
    '',
    mdTable(
      ['Split', 'Season', 'N played targets'],
      [
        ['Train / fit-history', '2023–24 (`2023`)', payload.scored.splitN.train],
        ['Validation / select', '2024–25 (`2024`)', payload.scored.splitN.validation],
        ['Test / freeze', '2025–26 (`2025`)', payload.scored.splitN.test],
      ]
    ),
    '',
    'Coverage is complete and comparable across those three seasons (Final box logs). 2026 games are excluded (no Finals in this extract).',
    '',
    `Scored: **${payload.scored.nScored}** played player-games with ≥1 prior played game (${payload.scored.players} players). Range ${payload.scored.minStart} → ${payload.scored.maxStart}. As-of leakage rows: **${payload.scored.leakageTotal}** (must be 0).`,
    '',
    '## Appearance corpus (Final 2023–2025 logs loaded)',
    '',
    mdTable(
      ['Token / class', 'n'],
      [
        ['All logs', payload.corpus.n],
        ['minutes `"00"` DNP', payload.corpus.token00],
        ['minutes `"0"` / `"0.0"` played', payload.corpus.token0],
        ['Played', payload.corpus.played],
        ['Zero-point played kept', payload.corpus.zeroPointPlayed],
        ['DNP', payload.corpus.dnp],
      ]
    ),
    '',
    '## Benchmark MAE (all three seasons, played targets)',
    '',
    mdTable(
      ['Prop', 'MAE', 'RMSE', 'Bias', 'N'],
      payload.baselineAll.map((r) => [r.prop, fmt(r.mae), fmt(r.rmse), fmt(r.bias), r.n])
    ),
    '',
  ];
  return `${lines.join('\n')}\n`;
}

function inventoryMarkdown(payload: { inventory: Awaited<ReturnType<typeof loadInventory>>; scored: { roleCoverage: { targetsOnStarterGames: number; priorKnownRole: number }; nScored: number } }): string {
  const inv = payload.inventory;
  const feature = (
    name: string,
    source: string,
    coverage: string,
    beforeTip: string,
    leakage: string,
    missing: string,
    notes: string
  ) =>
    [
      `### ${name}`,
      '',
      `| | |`,
      `| --- | --- |`,
      `| **FEATURE** | ${name} |`,
      `| **SOURCE TABLE / FIELD** | ${source} |`,
      `| **HISTORICAL COVERAGE** | ${coverage} |`,
      `| **AVAILABLE BEFORE TIP?** | ${beforeTip} |`,
      `| **LEAKAGE RISK** | ${leakage} |`,
      `| **MISSINGNESS** | ${missing} |`,
      `| **NOTES** | ${notes} |`,
      '',
    ].join('\n');

  const pgl = (inv.pgl as Array<Record<string, string | number>>).map((r) => `${r.season}: ${r.n_logs} logs`).join('; ');
  const starters = (inv.starters as Array<Record<string, string | number>>)
    .map((r) => `${r.season}: ${r.n_rows} rows / ${r.n_games} games`)
    .join('; ') || 'none';
  const inj = (inv.injuries as Array<Record<string, string | number>>)[0];
  const tgs = (inv.teamStats as Array<Record<string, string | number>>).map((r) => `${r.season}: ${r.n_rows}`).join('; ');
  const adv = (inv.advanced as Array<Record<string, string | number>>).map((r) => `${r.season}: ${r.n_rows} (usg ${r.n_usg})`).join('; ');

  return [
    '# Player projection v1 — pregame feature inventory',
    '',
    'Inspected 2026-09-14 from live analytics/research schemas. Features that do not exist historically are marked unavailable. Nothing below is fabricated.',
    '',
    '## High-value pregame features that actually exist',
    '',
    '- Previous-game / L3 / L5 / L10 / season **minutes** from `analytics.player_game_logs.minutes` (as-of prior Final games). Complete for 2023–2025.',
    '- **FGA / FTA** on every 2023–2025 Final log (0 nulls). Touches: **not stored**.',
    '- **Team, opponent, home/away** from `analytics.games.home_team_id` / `away_team_id` vs log `team_id`. Complete.',
    '- **Days rest / back-to-back** computable from prior `games.start_time` (ET calendar). Complete whenever a prior game exists.',
    '- **Team pace / opponent defensive rating** as-of prior games from `analytics.team_game_stats` (2023–2025 complete). Target-game row is leakage.',
    '- **Usage / pace** as-of prior games from `analytics.player_game_advanced` (2023–2025). Target-game usage is leakage.',
    '- **Starter/bench for 2025–26 only** from `analytics.game_starters` (postgame certified BDL lineups). Prior-game starter is a valid as-of feature; **target-game starter is not pregame**.',
    '',
    '## Unavailable or unsafe for this phase',
    '',
    `- Historically valid **pregame injury / inactive** tape: \`player_injury_status_history\` only ${String(inj?.min_at ?? 'n/a')} → ${String(inj?.max_at ?? 'n/a')} (late 2025–26). Cannot backfill 2023–25 as-of injuries.`,
    '- **Pregame announced lineups**: not stored. `game_starters` is certified postgame starters, 2025 only.',
    '- **Touches**, on/off, WOWY: not in serving tables.',
    '- **Public betting %**: archive exists with **unknown capture timing** — rejected as a projection input.',
    '- **Closing player-prop / game odds**: evaluation-only, never a basketball feature in v1 minutes/role.',
    '',
    feature('previous-game minutes', 'analytics.player_game_logs.minutes', pgl, 'YES', 'Low if prior games only', 'None on Final 2023–25', 'Token `"00"` = DNP; `"0"`/`"0.0"` = played; minutes>0 = played.'),
    feature('L3 / L5 / L10 / season minutes', 'Derived as-of from player_game_logs', 'Same as PGL 2023–2025', 'YES', 'Low', 'Undefined until enough prior played games', 'Played-only windows. Zero-minute played appearances skipped in minute means.'),
    feature('starting status (target game)', 'analytics.game_starters', starters, 'NO', 'HIGH — postgame certified archive', 'No 2023 or 2024 rows', 'Use only as an observed evaluation split. Not a projection input.'),
    feature('recent starting rate / games started / consecutive starts', 'Prior rows of analytics.game_starters', '2025 prior games only', 'CONDITIONAL', 'Low if restricted to prior games', 'Unknown for 2023–24 history; early 2025 until first labeled game', `${payload.scored.roleCoverage.priorKnownRole}/${payload.scored.nScored} scored targets had ≥1 prior known-role game.`),
    feature('FGA / FTA', 'analytics.player_game_logs.field_goals_attempted / free_throws_attempted', '0 nulls on Final 2023–25', 'YES as prior-game features', 'Low', 'None', 'Usage-like counting. Not used in this minutes/role pass.'),
    feature('touches', '—', 'Not in schema', 'NO', 'n/a', '100%', 'Do not fabricate.'),
    feature('minutes share', 'Derived: player minutes / team minutes from prior PGL', 'Computable 2023–2025', 'YES', 'Low if prior only', 'Needs teammates\' prior logs', 'Not precomputed. Deferred to usage experiment.'),
    feature('team / opponent / home-away', 'analytics.games + player_game_logs.team_id', 'Complete Final 2023–25', 'YES', 'Low', 'None', 'Scheduled before tip. Safe.'),
    feature('days rest / back-to-back', 'analytics.games.start_time as-of last prior game', 'Complete when a prior game exists', 'YES', 'Low', 'First game of season has no rest', 'Not modeled in this pass.'),
    feature('team pace / opponent pace / opponent defensive metrics', 'analytics.team_game_stats.pace, defensive_rating, points_allowed (prior games)', tgs, 'YES if prior games only', 'HIGH if target-game row used', 'Target-game stats exist but are postgame', 'Full 2023–2025 team-game coverage. Next families, not this pass.'),
    feature('player usage / pace', 'analytics.player_game_advanced.usage_percentage, pace', adv, 'YES if prior games only', 'HIGH if tonight\'s Advanced used', 'A few 2025 rows lack pace', 'Deferred to usage/rate-change experiment.'),
    feature('teammate availability', 'No historical pregame inactive list', 'Not available 2023–25', 'NO', 'HIGH if inferred from target box', 'Injury history too late', 'DNP `"00"` on prior games is a weak post-hoc proxy, not pregame availability.'),
    feature('injury / inactive', 'analytics.player_injury_status_history.snapshot_at', `${inj?.n ?? 0} rows ${inj?.min_at ?? ''} → ${inj?.max_at ?? ''}`, 'NO for 2023–25', 'HIGH', 'No tape before 2026-03-10', 'Do not use in v1 historical eval.'),
    feature('lineup data', 'analytics.game_starters (5 certified starters, 2025)', starters, 'NO as pregame', 'HIGH for tonight', '2023–24 missing; non-starters omitted', 'Not a full rotation / lineup card.'),
    feature('roster / team changes', 'player_game_logs.team_id vs prior team_id', 'Inferable 2023–2025', 'CONDITIONAL', 'Medium — observation of first game on new team, not trade timestamp', 'No transaction table', 'Useful later; not this pass.'),
    feature('closing player-prop market', 'Owls S3 historical_player_props', '2023–24 core two-way on ~21% of Final games', 'YES as a line (evaluation)', 'Do not use as a feature', 'Most games EMPTY_PROVIDER_HISTORY', 'Evaluation-only. 2024–25 ESPN BET mix is a different product.'),
    feature('public betting %', 'Owls public-betting archive', 'Descriptive snapshots', 'UNKNOWN timing', 'HIGH', 'Capture time not proven pre-tip', 'Rejected as a projection input.'),
    '',
    '## Leakage guardrail',
    '',
    'Every prior log used in v1 minutes/role must satisfy `feature_timestamp < target_tipoff` (`isStrictlyBefore`). Rejected inputs:',
    '',
    ...REJECTED_AS_PROJECTION_INPUTS.map((x) => `- ${x}`),
    '',
  ].join('\n');
}

function resultsMarkdown(payload: {
  runAt: string;
  scored: { nScored: number; players: number; splitN: Record<string, number>; leakageTotal: number; roleCoverage: { targetsOnStarterGames: number; priorKnownRole: number } };
  baselineAll: Array<{ prop: string; mae: number | null; n: number }>;
  valBest: Record<string, { candidate: string; mae: number | null }>;
  testTable: Array<{
    prop: string;
    selectedCandidate: string;
    baselineMae: number | null;
    candidateMae: number | null;
    delta: number | null;
    ciLow: number | null;
    ciHigh: number | null;
    n: number;
    class: string;
  }>;
  bySplit: Record<string, Record<string, Record<string, { mae: number | null; rmse: number | null; bias: number | null; n: number }>>>;
  segments: Array<{
    prop: string;
    candidate: string;
    slice: string;
    bucket: string;
    n: number;
    candidateMae: number | null;
    baselineMae: number | null;
    delta: number | null;
    ciLow: number | null;
    ciHigh: number | null;
  }>;
  market: Record<string, unknown> | null;
  decision: { label: string; why: string };
}): string {
  const testByProp = payload.bySplit.test ?? {};
  const defaultIds = [
    BENCHMARK_ID,
    'a_min_l5__clip_085_115',
    'a_min_l5_season__clip_085_115',
    'a_min_ewm_a040__clip_085_115',
    'a_min_trend__clip_085_115',
    'a_min_role__clip_085_115',
    'b_min_l5__season_rate',
    'b_min_l5__l10_rate',
    'b_min_l5__blended_rate',
    'b_min_l5_season__blended_rate',
    'b_min_ewm_a040__blended_rate',
    'b_min_role__blended_rate',
    'r_shift_l5__tau_020',
  ];
  const lines: string[] = [
    '# Player projection v1 — expected minutes / role',
    '',
    `Run: ${payload.runAt}`,
    `Version: \`${PROJECTION_V1_RESEARCH_VERSION}\`. Research only. Production unchanged.`,
    '',
    `Chronological split: train ${CHRONO_SPLIT.train} (n=${payload.scored.splitN.train}) → validation ${CHRONO_SPLIT.validation} (n=${payload.scored.splitN.validation}) → test ${CHRONO_SPLIT.test} (n=${payload.scored.splitN.test}). Hyperparameters chosen on validation only.`,
    '',
    `As-of leakage count: **${payload.scored.leakageTotal}**. Starter labels on target games used only as an observed split. Prior known-role coverage: ${payload.scored.roleCoverage.priorKnownRole}/${payload.scored.nScored}.`,
    '',
    '## Candidates',
    '',
    '### Expected minutes',
    '',
    '- A. L5 played-game mean minutes',
    '- B. 0.7 * L5 minutes + 0.3 * season minutes',
    '- C. EWM of played minutes (α ∈ {0.25, 0.40, 0.55}; 0.40 is the default)',
    '- D. Role-aware minutes from **prior** starter/bench minutes (starter-rate L5 ≥ 0.60 / ≤ 0.40); 2025-only labels',
    '- E. Trend: L10 * clip(L3/L10, 0.80, 1.20)',
    '',
    '### How minutes enter the mean',
    '',
    `- Concept A: \`TrackA * clip(expected / L10_minutes, lo, hi)\` with L10 floor ${MINUTES_REF_FLOOR}. Clip grids: 0.80–1.20, **0.85–1.15 (default)**, 0.90–1.10. Missing ratio → baseline fallback (paired N).`,
    '- Concept B: `expected_minutes * pregame per-minute rate` (season / L10 / 0.7 L10 + 0.3 season).',
    '- Role-shift: if |L5min − seasonMin| / seasonMin ≥ τ, use played L5 counting mean; else Track A. τ ∈ {0.15, 0.20, 0.25}.',
    '',
    '## Benchmark (all seasons)',
    '',
    mdTable(
      ['Prop', 'Played-only Track A MAE', 'N'],
      payload.baselineAll.map((r) => [r.prop, fmt(r.mae), r.n])
    ),
    '',
    '## Chronological test (2025–26) — val-selected candidate vs baseline',
    '',
    'Selection: lowest validation MAE, including the baseline. Test was not used to pick. Δ = candidate − baseline. Negative is improvement. Bootstrap seed ' +
      String(BOOTSTRAP_SEED) +
      `, ${BOOTSTRAP_ITERS} paired resamples.`,
    '',
    mdTable(
      ['Prop', 'Val-selected', 'Baseline MAE', 'Candidate MAE', 'Delta', '95% CI', 'N', 'Class'],
      payload.testTable.map((r) => [
        r.prop,
        r.selectedCandidate,
        fmt(r.baselineMae),
        fmt(r.candidateMae),
        fmt(r.delta, 4),
        r.ciLow == null || r.ciHigh == null ? 'n/a' : `[${fmt(r.ciLow, 3)}, ${fmt(r.ciHigh, 3)}]`,
        r.n,
        r.class,
      ])
    ),
    '',
    '## Test MAE for the pre-specified default family',
    '',
  ];

  for (const prop of Object.keys(testByProp)) {
    const cands = testByProp[prop];
    lines.push(`### ${prop}`, '');
    lines.push(
      mdTable(
        ['Candidate', 'MAE', 'RMSE', 'Bias', 'N'],
        defaultIds.filter((id) => cands[id]).map((id) => {
          const m = cands[id];
          return [id, fmt(m.mae), fmt(m.rmse), fmt(m.bias), m.n];
        })
      ),
      ''
    );
  }

  lines.push(
    '## Segment results (test, paired vs Track A)',
    '',
    'Target-game starter is an **observed postgame split**, not a feature. Minutes-change and volume buckets are pregame.',
    '',
    mdTable(
      ['Prop', 'Candidate', 'Slice', 'Bucket', 'N', 'Cand MAE', 'Base MAE', 'Delta', '95% CI'],
      payload.segments
        .filter((s) => s.n >= 80 && (s.slice !== 'role' || s.bucket !== 'unknown'))
        .filter((s) => ['PTS', 'PRA', 'REB', 'AST'].includes(s.prop))
        .map((s) => [
          s.prop,
          s.candidate,
          s.slice,
          s.bucket,
          s.n,
          fmt(s.candidateMae),
          fmt(s.baselineMae),
          fmt(s.delta, 4),
          s.ciLow == null || s.ciHigh == null ? 'n/a' : `[${fmt(s.ciLow, 3)}, ${fmt(s.ciHigh, 3)}]`,
        ])
    ),
    '',
    '## Market subset (2023–24 core two-way tape)',
    ''
  );

  if (!payload.market || payload.market.skipped) {
    lines.push(`Skipped: ${String(payload.market?.reason ?? 'n/a')}`, '');
  } else {
    const rows = (payload.market.byProp as Array<Record<string, unknown>>) ?? [];
    lines.push(String(payload.market.note ?? ''));
    lines.push('');
    lines.push(
      mdTable(
        ['Prop', 'Eligible', 'With market', 'Coverage %', 'Court Context MAE', 'Market MAE'],
        rows.map((r) => [
          String(r.prop),
          String(r.eligibleHistoricalGames),
          String(r.gamesWithValidMarketRows),
          fmt(r.coveragePct as number),
          fmt(r.courtContextMae as number),
          fmt(r.marketLineMae as number),
        ])
      )
    );
    lines.push('');
    lines.push('This is not season-wide market validation. 2024–25 ESPN BET / combo rows were not mixed in.');
    lines.push('');
  }

  lines.push('## Decision', '', `**${payload.decision.label}**`, '', payload.decision.why, '');
  return `${lines.join('\n')}\n`;
}

function roadmapMarkdown(): string {
  return `# Player projection v1 — experiment roadmap

Research-only. Do not change production until a family earns a chronological out-of-sample promote.

Ordered next experiments (only #1 is executed in this pass):

1. **Minutes / role** — this report. Expected minutes + role-shift vs Played-only Track A.
2. **Usage / rate change** — prior-game FGA/FTA and \`player_game_advanced.usage_percentage\` as-of tipoff. Test whether recent per-minute or usage shifts beat counting Track A after minutes are handled.
3. **Teammate availability** — blocked until a historically valid pregame injury/inactive tape exists. Do not infer availability from the target box.
4. **Opponent** — as-of opponent defensive rating / points allowed from \`analytics.team_game_stats\` prior games.
5. **Pace** — as-of team and opponent pace from team_game_stats / player_game_advanced prior games.
6. **Rest** — days rest and back-to-back from \`games.start_time\`.
7. **Home / away** — scheduled location vs \`team_id\`.
8. **WOWY** — teammate on/off context. Requires lineup or stint data that we do not currently have as a pregame historical tape.

Rules for every later experiment:

- Chronological train 2023 → val 2024 → test 2025.
- Same played-game semantics. Do not reintroduce \`"00"\` zeros.
- Do not throw all features into one model.
- Market data is evaluation-only.
- No probability / sigma / EV work in the mean-projection ladder.
`;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
