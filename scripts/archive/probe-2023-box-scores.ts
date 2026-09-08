/**
 * Step 4D: two historical `/v1/box_scores?date=` probes for 2023 mismatch games.
 * Does not fetch the other 7 mismatch dates. Does not materialize Postgres.
 *
 *   BDL_TRIAL_MODE=1 npx tsx scripts/archive/probe-2023-box-scores.ts --dry-run
 *   BDL_TRIAL_MODE=1 npx tsx scripts/archive/probe-2023-box-scores.ts --execute
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { S3Storage } from '@/lib/aws/s3';
import { acquireBdlAcquisitionLock, bdlAcquisitionLockStatus } from '@/lib/balldontlie/acquisition-lock';
import { BdlArchiveClient, BDL_BASE_URL, readBdlApiKey, type BdlEnvelope } from '@/lib/balldontlie/archive-client';
import { archiveJsonObjectToS3 } from '@/lib/archive/resumable-s3-archive';
import { parseExecuteFlag, rawEntityPrefix } from '@/lib/archive/trial-archive-plan';
import {
  assertTrialExecuteAllowed,
  BDL_TRIAL_MIN_DELAY_MS,
  resolveBdlRequestDelayMs,
} from '@/lib/balldontlie/trial-limiter';
import { buildServingBackfillPlan } from '@/lib/ingestion/historical-serving/plan';
import pool from '@/lib/db';
import { readIngestionMode } from '@/lib/runtime/ingestion-mode';
import { getAnalyticsSeason } from '@/lib/season';

const SEASON = 2023;
const DATES = ['2024-02-07', '2024-03-08'] as const;
const TARGET_GAMES = [
  { gameId: '1038319', date: '2024-02-07' as const },
  { gameId: '1038322', date: '2024-02-07' as const },
  { gameId: '1038504', date: '2024-03-08' as const },
] as const;
const ORIGINAL_STATS_PAGES = [267, 268, 331];
const ORIGINAL_GAMES_PAGES = [8, 9, 10];
const ALL_MISMATCH_DATES = [
  '2024-02-07',
  '2024-02-10',
  '2024-02-12',
  '2024-02-14',
  '2024-02-27',
  '2024-02-28',
  '2024-03-01',
  '2024-03-06',
  '2024-03-08',
];
const OUT_JSON = 'reports/trial/2023-box-score-probe.json';
const OUT_MD = 'reports/trial/2023-box-score-probe.md';
const BOX_ID = '18447793';
const EXPECTED = {
  games2024: 1321,
  logs2024: 46150,
  tgs2024: 2642,
  psa2024: 587,
  tsa2024: 30,
  inferred2024: 699,
  games2025: 1323,
  logs2025: 46056,
  tgs2025: 2644,
  rawPgs: 46056,
  games2026: 1200,
  logs2026: 0,
  stints2026: 578,
  boxHome: 109,
  boxAway: 118,
};

type ResultClass =
  | 'BOX_SCORE_FIXES_STATS_ANOMALY'
  | 'BOX_SCORE_MATCHES_STATS_ANOMALY'
  | 'BOX_SCORE_PARTIALLY_DIFFERS'
  | 'BOX_SCORE_MISSING_GAME'
  | 'BOX_SCORE_STRUCTURAL_ISSUE'
  | 'OTHER';

type StatRow = {
  id?: unknown;
  pts?: number | null;
  player?: { id?: unknown } | null;
  team?: { id?: unknown } | null;
  game?: { id?: unknown } | null;
};

type GameMeta = {
  gameId: string;
  date: string;
  homeId: string;
  awayId: string;
  homeAbbr: string;
  awayAbbr: string;
  homeScore: number | null;
  awayScore: number | null;
};

function sid(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

function toNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function setEq(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function ptsMap(rows: Array<{ playerId: string; pts: number }>): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.playerId, (m.get(r.playerId) ?? 0) + r.pts);
  return m;
}

async function snapshotPostgres() {
  const client = await pool.connect();
  try {
    await client.query('begin read only');
    const r = await client.query(
      `select
         (select count(*)::int from analytics.games where season = '2023') as games_2023,
         (select count(*)::int from analytics.player_game_logs where season = '2023') as logs_2023,
         (select count(*)::int from analytics.team_game_stats where season = '2023') as tgs_2023,
         (select count(*)::int from analytics.player_season_averages where season = '2023') as psa_2023,
         (select count(*)::int from analytics.team_season_averages where season = '2023') as tsa_2023,
         (select count(*)::int from analytics.player_team_stints where season = '2023') as stints_2023,
         (select count(*)::int from raw.player_game_stats) as raw_pgs,
         (select count(*)::int
            from raw.player_game_stats s
            join analytics.games g on g.game_id = s.game_id::text
           where g.season = '2023') as raw_pgs_2023,
         (select count(*)::int from analytics.games where season = '2024') as games_2024,
         (select count(*)::int from analytics.player_game_logs where season = '2024') as logs_2024,
         (select count(*)::int from analytics.team_game_stats where season = '2024') as tgs_2024,
         (select count(*)::int from analytics.player_season_averages where season = '2024') as psa_2024,
         (select count(*)::int from analytics.team_season_averages where season = '2024') as tsa_2024,
         (select count(*)::int from analytics.player_team_stints
           where season = '2024' and source = 'inferred_pgl') as inferred_2024,
         (select count(*)::int from analytics.games where season = '2025') as games_2025,
         (select count(*)::int from analytics.player_game_logs where season = '2025') as logs_2025,
         (select count(*)::int from analytics.team_game_stats where season = '2025') as tgs_2025,
         (select count(*)::int from analytics.games where season = '2026') as games_2026,
         (select count(*)::int from analytics.player_game_logs where season = '2026') as logs_2026,
         (select count(*)::int from analytics.player_team_stints where season = '2026') as stints_2026`
    );
    const box = await client.query(
      `select home_score, away_score from analytics.games where game_id = $1`,
      [BOX_ID]
    );
    await client.query('commit');
    const row = r.rows[0]!;
    const n = (k: string) => Number(row[k]);
    return {
      games_2023: n('games_2023'),
      logs_2023: n('logs_2023'),
      tgs_2023: n('tgs_2023'),
      psa_2023: n('psa_2023'),
      tsa_2023: n('tsa_2023'),
      stints_2023: n('stints_2023'),
      raw_pgs: n('raw_pgs'),
      raw_pgs_2023: n('raw_pgs_2023'),
      games_2024: n('games_2024'),
      logs_2024: n('logs_2024'),
      tgs_2024: n('tgs_2024'),
      psa_2024: n('psa_2024'),
      tsa_2024: n('tsa_2024'),
      inferred_2024: n('inferred_2024'),
      games_2025: n('games_2025'),
      logs_2025: n('logs_2025'),
      tgs_2025: n('tgs_2025'),
      games_2026: n('games_2026'),
      logs_2026: n('logs_2026'),
      stints_2026: n('stints_2026'),
      box184: box.rows[0]
        ? { home: Number(box.rows[0].home_score), away: Number(box.rows[0].away_score) }
        : null,
    };
  } catch (err) {
    try {
      await client.query('rollback');
    } catch {
      // ignore
    }
    throw err;
  } finally {
    client.release();
  }
}

function summarizeStats(args: {
  rows: StatRow[];
  homeId: string;
  awayId: string;
  officialHome: number | null;
  officialAway: number | null;
  expectedGameId: string;
}) {
  const playerIds = new Set<string>();
  let homePts = 0;
  let awayPts = 0;
  const playerRows: Array<{ playerId: string; teamId: string; pts: number }> = [];
  for (const row of args.rows) {
    const pid = sid(row.player?.id);
    const tid = sid(row.team?.id);
    const pts = typeof row.pts === 'number' ? row.pts : 0;
    if (pid) playerIds.add(pid);
    playerRows.push({ playerId: pid, teamId: tid, pts });
    if (tid === args.homeId) homePts += pts;
    else if (tid === args.awayId) awayPts += pts;
  }
  const scoreOk =
    args.officialHome != null &&
    args.officialAway != null &&
    homePts === args.officialHome &&
    awayPts === args.officialAway;
  return {
    rowCount: args.rows.length,
    playerIdCount: playerIds.size,
    playerIds: [...playerIds].sort(),
    homePts,
    awayPts,
    deltaHome: args.officialHome == null ? null : homePts - args.officialHome,
    deltaAway: args.officialAway == null ? null : awayPts - args.officialAway,
    scoreOk,
    playerRows,
  };
}

function teamSide(raw: unknown): {
  id: string;
  abbr: string;
  players: Array<Record<string, unknown>>;
} {
  const side = (raw ?? {}) as Record<string, unknown>;
  const nested =
    side.team && typeof side.team === 'object' ? (side.team as Record<string, unknown>) : side;
  const players = Array.isArray(side.players) ? (side.players as Array<Record<string, unknown>>) : [];
  return { id: sid(nested.id), abbr: sid(nested.abbreviation), players };
}

function summarizeBoxScore(args: {
  box: Record<string, unknown> | null;
  homeId: string;
  awayId: string;
  officialHome: number | null;
  officialAway: number | null;
}) {
  if (!args.box) {
    return {
      found: false,
      matchMethod: null as string | null,
      boxGameId: null as string | null,
      rowCount: 0,
      playerIdCount: 0,
      playerIds: [] as string[],
      homePts: 0,
      awayPts: 0,
      deltaHome: null as number | null,
      deltaAway: null as number | null,
      scoreOk: false,
      suppliedHomeScore: null as number | null,
      suppliedAwayScore: null as number | null,
      suppliedScoresMatchOfficial: false,
      bothTeams: false,
      dupPlayer: 0,
      missingPlayer: 0,
      structuralOk: false,
      playerRows: [] as Array<{ playerId: string; teamId: string; pts: number }>,
    };
  }
  const home = teamSide(args.box.home_team);
  const away = teamSide(args.box.visitor_team);
  const suppliedHome = toNum(args.box.home_team_score);
  const suppliedAway = toNum(args.box.visitor_team_score);
  const boxGameId = sid(args.box.id) || sid((args.box.game as { id?: unknown } | undefined)?.id) || null;
  const playerIds = new Set<string>();
  const dup = new Map<string, number>();
  let missingPlayer = 0;
  let homePts = 0;
  let awayPts = 0;
  const playerRows: Array<{ playerId: string; teamId: string; pts: number }> = [];
  const ingest = (teamId: string, players: Array<Record<string, unknown>>) => {
    for (const p of players) {
      const player = (p.player ?? null) as Record<string, unknown> | null;
      const pid = sid(player?.id);
      const pts = typeof p.pts === 'number' ? p.pts : 0;
      if (!pid) missingPlayer += 1;
      else {
        playerIds.add(pid);
        dup.set(pid, (dup.get(pid) ?? 0) + 1);
      }
      playerRows.push({ playerId: pid, teamId, pts });
      if (teamId === args.homeId) homePts += pts;
      else if (teamId === args.awayId) awayPts += pts;
    }
  };
  ingest(home.id, home.players);
  ingest(away.id, away.players);
  const dupPlayer = [...dup.values()].filter((n) => n > 1).length;
  const bothTeams = home.id === args.homeId && away.id === args.awayId && home.players.length > 0 && away.players.length > 0;
  const scoreOk =
    args.officialHome != null &&
    args.officialAway != null &&
    homePts === args.officialHome &&
    awayPts === args.officialAway;
  const structuralOk = bothTeams && dupPlayer === 0 && missingPlayer === 0;
  return {
    found: true,
    matchMethod: boxGameId ? 'game_id_or_date_teams' : 'date_home_visitor_team_ids',
    boxGameId,
    rowCount: home.players.length + away.players.length,
    playerIdCount: playerIds.size,
    playerIds: [...playerIds].sort(),
    homePts,
    awayPts,
    deltaHome: args.officialHome == null ? null : homePts - args.officialHome,
    deltaAway: args.officialAway == null ? null : awayPts - args.officialAway,
    scoreOk,
    suppliedHomeScore: suppliedHome,
    suppliedAwayScore: suppliedAway,
    suppliedScoresMatchOfficial:
      suppliedHome === args.officialHome && suppliedAway === args.officialAway,
    bothTeams,
    dupPlayer,
    missingPlayer,
    structuralOk,
    playerRows,
    homeAbbr: home.abbr,
    awayAbbr: away.abbr,
  };
}

function classify(args: {
  boxFound: boolean;
  boxStructuralOk: boolean;
  boxScoreOk: boolean;
  statsScoreOk: boolean;
  boxHomePts: number;
  boxAwayPts: number;
  statsHomePts: number;
  statsAwayPts: number;
  samePlayers: boolean;
}): ResultClass {
  if (!args.boxFound) return 'BOX_SCORE_MISSING_GAME';
  if (!args.boxStructuralOk) return 'BOX_SCORE_STRUCTURAL_ISSUE';
  if (args.boxScoreOk && !args.statsScoreOk) return 'BOX_SCORE_FIXES_STATS_ANOMALY';
  if (
    !args.boxScoreOk &&
    args.boxHomePts === args.statsHomePts &&
    args.boxAwayPts === args.statsAwayPts &&
    args.samePlayers
  ) {
    return 'BOX_SCORE_MATCHES_STATS_ANOMALY';
  }
  if (!args.boxScoreOk && (args.boxHomePts !== args.statsHomePts || args.boxAwayPts !== args.statsAwayPts || !args.samePlayers)) {
    return 'BOX_SCORE_PARTIALLY_DIFFERS';
  }
  return 'OTHER';
}

function playerDiffs(
  statsRows: Array<{ playerId: string; pts: number }>,
  boxRows: Array<{ playerId: string; pts: number }>
) {
  const s = ptsMap(statsRows);
  const b = ptsMap(boxRows);
  const ids = new Set([...s.keys(), ...b.keys()]);
  const changed: Array<{ playerId: string; statsPts: number | null; boxPts: number | null }> = [];
  const onlyStats: string[] = [];
  const onlyBox: string[] = [];
  for (const id of [...ids].sort()) {
    const sp = s.has(id) ? s.get(id)! : null;
    const bp = b.has(id) ? b.get(id)! : null;
    if (sp == null) onlyBox.push(id);
    else if (bp == null) onlyStats.push(id);
    else if (sp !== bp) changed.push({ playerId: id, statsPts: sp, boxPts: bp });
  }
  return { changedPlayerPoints: changed, onlyInStats: onlyStats, onlyInBox: onlyBox };
}

function assertDiagnosticKey(key: string) {
  if (key.includes('/entity=games/') || /entity=player_stats\/(page=|game_id=|_manifest)/.test(key)) {
    throw new Error(`refusing to overwrite season archive ${key}`);
  }
}

function findBoxGame(
  boxes: Array<Record<string, unknown>>,
  meta: GameMeta
): { box: Record<string, unknown> | null; method: string | null } {
  const byId = boxes.find((b) => {
    const id = sid(b.id) || sid((b.game as { id?: unknown } | undefined)?.id);
    return id === meta.gameId;
  });
  if (byId) return { box: byId, method: 'provider_game_id' };
  const byTeams = boxes.find((b) => {
    const date = sid(b.date);
    const home = teamSide(b.home_team);
    const away = teamSide(b.visitor_team);
    return date === meta.date && home.id === meta.homeId && away.id === meta.awayId;
  });
  if (byTeams) return { box: byTeams, method: 'date_home_visitor_team_ids' };
  const byAbbr = boxes.find((b) => {
    const date = sid(b.date);
    const home = teamSide(b.home_team);
    const away = teamSide(b.visitor_team);
    return date === meta.date && home.abbr === meta.homeAbbr && away.abbr === meta.awayAbbr;
  });
  if (byAbbr) return { box: byAbbr, method: 'date_home_visitor_abbreviations' };
  return { box: null, method: null };
}

async function main() {
  const { execute, dryRun } = parseExecuteFlag(process.argv.slice(2));
  const generatedAt = new Date().toISOString();
  const mode = readIngestionMode();
  const pin = getAnalyticsSeason();
  const delay = resolveBdlRequestDelayMs();
  const lockIdle = bdlAcquisitionLockStatus();
  const unsafe: string[] = [];
  if (!delay.trialMode) unsafe.push('BDL_TRIAL_MODE is not 1');
  if (delay.delayMs !== 13_000) unsafe.push(`spacing ${delay.delayMs}ms`);
  if (delay.delayMs < BDL_TRIAL_MIN_DELAY_MS) unsafe.push('spacing below 12000');
  if (delay.concurrency !== 1) unsafe.push(`concurrency=${delay.concurrency}`);
  if (mode.dataMode !== 'replay') unsafe.push(`DATA_MODE=${mode.dataMode || '(empty)'}`);
  if (!mode.offseason) unsafe.push('OFFSEASON_MODE not 1');
  if (!mode.cronDryRun) unsafe.push('CRON_DRY_RUN not 1');
  if (pin !== '2025') unsafe.push(`season pin=${pin}`);
  if (lockIdle.active) unsafe.push(`BDL lock already active pid=${lockIdle.pid}`);
  if (DATES.length !== 2) unsafe.push('date queue is not exactly 2');

  const pgBefore = await snapshotPostgres();
  if (
    pgBefore.games_2023 !== 0 ||
    pgBefore.logs_2023 !== 0 ||
    pgBefore.tgs_2023 !== 0 ||
    pgBefore.psa_2023 !== 0 ||
    pgBefore.tsa_2023 !== 0 ||
    pgBefore.stints_2023 !== 0 ||
    pgBefore.raw_pgs_2023 !== 0
  ) {
    unsafe.push('2023 serving/raw not empty');
  }
  if (
    pgBefore.games_2024 !== EXPECTED.games2024 ||
    pgBefore.logs_2024 !== EXPECTED.logs2024 ||
    pgBefore.tgs_2024 !== EXPECTED.tgs2024 ||
    pgBefore.psa_2024 !== EXPECTED.psa2024 ||
    pgBefore.tsa_2024 !== EXPECTED.tsa2024 ||
    pgBefore.inferred_2024 !== EXPECTED.inferred2024
  ) {
    unsafe.push('2024 isolation unexpected');
  }
  if (pgBefore.games_2025 !== EXPECTED.games2025 || pgBefore.logs_2025 !== EXPECTED.logs2025 || pgBefore.tgs_2025 !== EXPECTED.tgs2025) {
    unsafe.push('2025 isolation unexpected');
  }
  if (pgBefore.box184?.home !== EXPECTED.boxHome || pgBefore.box184?.away !== EXPECTED.boxAway) {
    unsafe.push('18447793 unexpected');
  }
  if (pgBefore.games_2026 !== EXPECTED.games2026 || pgBefore.logs_2026 !== EXPECTED.logs2026 || pgBefore.stints_2026 !== EXPECTED.stints2026) {
    unsafe.push('2026 isolation unexpected');
  }
  if (pgBefore.raw_pgs !== EXPECTED.rawPgs) unsafe.push(`raw.player_game_stats ${pgBefore.raw_pgs}`);

  const safety = {
    bdlTrialMode: delay.trialMode,
    delayMs: delay.delayMs,
    concurrency: delay.concurrency,
    lockIdleBefore: !lockIdle.active,
    dataMode: mode.dataMode,
    offseasonMode: mode.offseason,
    cronDryRun: mode.cronDryRun,
    frozen: true,
    currentAnalyticsSeason: pin,
    postgresMaterialize: false,
    servingBefore: pgBefore,
  };

  const diagnosticPrefix = rawEntityPrefix(process.env.NBA_RAW_PREFIX ?? 'raw', SEASON, 'box_scores_diagnostic');
  const urls = DATES.map((d) => `${BDL_BASE_URL}/box_scores?date=${d}`);
  const keys = DATES.map((d) => `${diagnosticPrefix}/date=${d}.json`);

  if (unsafe.length) {
    const stopped = {
      generatedAt,
      step: '4D',
      stopped: true,
      reason: 'safety preflight failed',
      unsafe,
      safety,
      dates: [...DATES],
      verdict: 'RED — endpoint/limiter result requires investigation',
    };
    mkdirSync('reports/trial', { recursive: true });
    writeFileSync(OUT_JSON, JSON.stringify(stopped, null, 2) + '\n');
    console.log(JSON.stringify(stopped, null, 2));
    process.exit(2);
  }

  console.log('=== Step 4D historical Box Scores probe (2 dates) ===');
  console.log(`  dates: ${DATES.join(', ')}`);
  console.log(`  games: ${TARGET_GAMES.map((g) => g.gameId).join(', ')}`);
  console.log(`  diagnostic prefix: ${diagnosticPrefix}`);
  console.log('  will not overwrite: games archive, player_stats page=N.json, or game_id repair objects');

  if (dryRun || !execute) {
    const payload = {
      generatedAt,
      step: '4D',
      dryRun: true,
      safety,
      dates: [...DATES],
      targetGames: TARGET_GAMES,
      plannedRequests: 2,
      urls: urls.map((u) => u.replace(/https:\/\/api\.balldontlie\.io/, 'https://api.balldontlie.io')),
      diagnosticKeys: keys,
      remainingMismatchDatesIfUseful: ALL_MISMATCH_DATES.filter((d) => !DATES.includes(d as (typeof DATES)[number])),
      note: 'Safety GREEN. Rerun with BDL_TRIAL_MODE=1 --execute. Two date-scoped Box Scores requests only. No Postgres writes.',
    };
    mkdirSync('reports/trial', { recursive: true });
    writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2) + '\n');
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const plan = buildServingBackfillPlan({
    season: SEASON,
    rawPrefix: process.env.NBA_RAW_PREFIX,
    blockedReason: null,
  });
  const bucket = process.env.NBA_DATA_BUCKET?.trim();
  if (!bucket) throw new Error('Missing NBA_DATA_BUCKET');
  const s3 = new S3Storage({ bucket });
  const statsPrefix = plan.s3StatsPrefix;

  const games = new Map<string, GameMeta>();
  for (const n of ORIGINAL_GAMES_PAGES) {
    const env = await s3.getJson<BdlEnvelope>(`${plan.s3GamesPrefix}/page=${n}.json`);
    for (const raw of env?.data ?? []) {
      const g = raw as Record<string, unknown>;
      const id = sid(g.id);
      const wanted = TARGET_GAMES.find((t) => t.gameId === id);
      if (!wanted) continue;
      const home = (g.home_team ?? null) as Record<string, unknown> | null;
      const vis = (g.visitor_team ?? null) as Record<string, unknown> | null;
      games.set(id, {
        gameId: id,
        date: sid(g.date) || wanted.date,
        homeId: sid(home?.id),
        awayId: sid(vis?.id),
        homeAbbr: sid(home?.abbreviation),
        awayAbbr: sid(vis?.abbreviation),
        homeScore: toNum(g.home_team_score),
        awayScore: toNum(g.visitor_team_score),
      });
    }
  }
  const missingGames = TARGET_GAMES.filter((g) => !games.has(g.gameId));
  if (missingGames.length) {
    throw new Error(`target games missing from archived games pages: ${missingGames.map((g) => g.gameId).join(',')}`);
  }

  const originalRows = new Map<string, StatRow[]>();
  const freshRows = new Map<string, StatRow[]>();
  for (const g of TARGET_GAMES) {
    originalRows.set(g.gameId, []);
    freshRows.set(g.gameId, []);
  }
  for (const n of ORIGINAL_STATS_PAGES) {
    const env = await s3.getJson<BdlEnvelope>(`${statsPrefix}/page=${n}.json`);
    for (const raw of env?.data ?? []) {
      const s = raw as StatRow;
      const gid = sid(s.game?.id);
      if (!originalRows.has(gid)) continue;
      originalRows.get(gid)!.push(s);
    }
  }
  for (const g of TARGET_GAMES) {
    const repair = await s3.getJson<{ pages?: BdlEnvelope[] }>(`${statsPrefix}/game_id=${g.gameId}.json`);
    const rows = (repair?.pages ?? []).flatMap((p) => (Array.isArray(p.data) ? (p.data as StatRow[]) : []));
    freshRows.set(g.gameId, rows);
  }

  assertTrialExecuteAllowed();
  const lock = acquireBdlAcquisitionLock();
  console.log(`  lock: acquired ${lock.path}`);
  const client = new BdlArchiveClient({ apiKey: readBdlApiKey() });
  const wallStart = Date.now();
  const dateResults: Array<Record<string, unknown>> = [];
  const statuses: number[] = [];

  try {
    for (let i = 0; i < DATES.length; i++) {
      const date = DATES[i]!;
      const url = urls[i]!;
      const key = keys[i]!;
      assertDiagnosticKey(key);
      const res = await client.fetchWithRetry(url);
      statuses.push(res.status);
      if (!res.ok) {
        const text = await res.text().catch(() => '<unreadable>');
        throw new Error(`BDL /v1/box_scores?date=${date} returned ${res.status}: ${text.slice(0, 300)}`);
      }
      const body = (await res.json()) as { data?: unknown };
      await archiveJsonObjectToS3({
        s3,
        key,
        body: {
          schemaVersion: 1,
          source: 'balldontlie',
          endpoint: '/v1/box_scores',
          season: SEASON,
          date,
          kind: 'historical_box_scores_probe',
          body,
          fetchedAt: new Date().toISOString(),
        },
      });
      const boxes = Array.isArray(body.data) ? (body.data as Array<Record<string, unknown>>) : [];
      dateResults.push({
        date,
        url: `${BDL_BASE_URL}/box_scores?date=${date}`,
        status: res.status,
        s3Key: key,
        gameCount: boxes.length,
        games: boxes.map((b) => {
          const home = teamSide(b.home_team);
          const away = teamSide(b.visitor_team);
          return {
            boxId: sid(b.id) || null,
            date: sid(b.date),
            homeId: home.id,
            awayId: away.id,
            homeAbbr: home.abbr,
            awayAbbr: away.abbr,
            homeScore: toNum(b.home_team_score),
            awayScore: toNum(b.visitor_team_score),
            homePlayers: home.players.length,
            awayPlayers: away.players.length,
          };
        }),
        boxes,
      });
    }
    await archiveJsonObjectToS3({
      s3,
      key: `${diagnosticPrefix}/_probe_2date_manifest.json`,
      overwrite: true,
      body: {
        schemaVersion: 1,
        entity: 'box_scores_diagnostic',
        season: SEASON,
        kind: 'historical_box_scores_probe_2date',
        dates: [...DATES],
        targetGames: TARGET_GAMES,
        overwritesSeasonGames: false,
        overwritesSeasonStatsPages: false,
        overwritesGameScopedRepairs: false,
        postgresMaterialize: false,
        fetchedAt: new Date().toISOString(),
      },
    });
  } finally {
    lock.release();
    console.log('  lock: released');
  }

  const metrics = client.getMetrics();
  const spacingBetween = metrics.spacingSamplesMs[0] ?? null;
  const minSample = metrics.spacingSamplesMs.length ? Math.min(...metrics.spacingSamplesMs) : null;
  const limiterOk =
    spacingBetween != null &&
    spacingBetween >= BDL_TRIAL_MIN_DELAY_MS &&
    (minSample == null || minSample >= BDL_TRIAL_MIN_DELAY_MS);

  const perGame = TARGET_GAMES.map((t) => {
    const meta = games.get(t.gameId)!;
    const datePayload = dateResults.find((d) => d.date === t.date) as
      | { boxes?: Array<Record<string, unknown>>; date?: string }
      | undefined;
    const boxes = datePayload?.boxes ?? [];
    const matched = findBoxGame(boxes, meta);
    const orig = summarizeStats({
      rows: originalRows.get(t.gameId) ?? [],
      homeId: meta.homeId,
      awayId: meta.awayId,
      officialHome: meta.homeScore,
      officialAway: meta.awayScore,
      expectedGameId: t.gameId,
    });
    const fresh = summarizeStats({
      rows: freshRows.get(t.gameId) ?? [],
      homeId: meta.homeId,
      awayId: meta.awayId,
      officialHome: meta.homeScore,
      officialAway: meta.awayScore,
      expectedGameId: t.gameId,
    });
    const box = summarizeBoxScore({
      box: matched.box,
      homeId: meta.homeId,
      awayId: meta.awayId,
      officialHome: meta.homeScore,
      officialAway: meta.awayScore,
    });
    const samePlayers = setEq(new Set(fresh.playerIds), new Set(box.playerIds));
    const result = classify({
      boxFound: box.found,
      boxStructuralOk: box.structuralOk,
      boxScoreOk: box.scoreOk,
      statsScoreOk: fresh.scoreOk,
      boxHomePts: box.homePts,
      boxAwayPts: box.awayPts,
      statsHomePts: fresh.homePts,
      statsAwayPts: fresh.awayPts,
      samePlayers,
    });
    const diffs = playerDiffs(fresh.playerRows, box.playerRows);
    return {
      gameId: t.gameId,
      date: meta.date,
      matchup: `${meta.homeAbbr} vs ${meta.awayAbbr}`,
      matchMethod: matched.method,
      official: { home: meta.homeScore, away: meta.awayScore },
      originalStats: {
        rowCount: orig.rowCount,
        playerIdCount: orig.playerIdCount,
        homePts: orig.homePts,
        awayPts: orig.awayPts,
        deltaHome: orig.deltaHome,
        deltaAway: orig.deltaAway,
        scoreOk: orig.scoreOk,
      },
      freshStats: {
        rowCount: fresh.rowCount,
        playerIdCount: fresh.playerIdCount,
        homePts: fresh.homePts,
        awayPts: fresh.awayPts,
        deltaHome: fresh.deltaHome,
        deltaAway: fresh.deltaAway,
        scoreOk: fresh.scoreOk,
      },
      boxScores: {
        found: box.found,
        matchMethod: matched.method,
        boxGameId: box.boxGameId,
        rowCount: box.rowCount,
        playerIdCount: box.playerIdCount,
        playerIds: box.playerIds,
        homePts: box.homePts,
        awayPts: box.awayPts,
        deltaHome: box.deltaHome,
        deltaAway: box.deltaAway,
        scoreOk: box.scoreOk,
        suppliedHomeScore: box.suppliedHomeScore,
        suppliedAwayScore: box.suppliedAwayScore,
        suppliedScoresMatchOfficial: box.suppliedScoresMatchOfficial,
        bothTeams: box.bothTeams,
        dupPlayer: box.dupPlayer,
        missingPlayer: box.missingPlayer,
        structuralOk: box.structuralOk,
      },
      playerDiffs: diffs,
      idsAlign: samePlayers && diffs.onlyInBox.length === 0 && diffs.onlyInStats.length === 0,
      result,
    };
  });

  const fixes = perGame.filter((g) => g.result === 'BOX_SCORE_FIXES_STATS_ANOMALY');
  const matchesAnomaly = perGame.filter((g) => g.result === 'BOX_SCORE_MATCHES_STATS_ANOMALY');
  const remainingDates = ALL_MISMATCH_DATES.filter((d) => !DATES.includes(d as (typeof DATES)[number]));

  let doesFix: 'A_FIXES' | 'B_SAME_ANOMALY' | 'C_DIFFERS' | 'UNCLEAR';
  if (fixes.length === 3) doesFix = 'A_FIXES';
  else if (matchesAnomaly.length === 3) doesFix = 'B_SAME_ANOMALY';
  else if (perGame.every((g) => g.result === 'BOX_SCORE_PARTIALLY_DIFFERS')) doesFix = 'C_DIFFERS';
  else doesFix = 'UNCLEAR';

  let verdict:
    | 'GREEN — Box Scores resolves sampled anomalies; fetch remaining mismatch dates'
    | 'YELLOW — Box Scores confirms persistent provider anomaly; decide serving policy'
    | 'RED — endpoint/limiter result requires investigation';
  if (!limiterOk || statuses.some((s) => s !== 200) || perGame.some((g) => g.result === 'BOX_SCORE_MISSING_GAME' || g.result === 'BOX_SCORE_STRUCTURAL_ISSUE' || g.result === 'OTHER')) {
    verdict = 'RED — endpoint/limiter result requires investigation';
  } else if (doesFix === 'A_FIXES') {
    verdict = 'GREEN — Box Scores resolves sampled anomalies; fetch remaining mismatch dates';
  } else if (doesFix === 'B_SAME_ANOMALY') {
    verdict = 'YELLOW — Box Scores confirms persistent provider anomaly; decide serving policy';
  } else {
    verdict = 'RED — endpoint/limiter result requires investigation';
  }

  const additionalIfUseful = doesFix === 'A_FIXES' ? remainingDates.length : 0;
  const pgAfter = await snapshotPostgres();
  const postgresUnchanged =
    pgAfter.games_2023 === 0 &&
    pgAfter.logs_2023 === 0 &&
    pgAfter.tgs_2023 === 0 &&
    pgAfter.psa_2023 === 0 &&
    pgAfter.tsa_2023 === 0 &&
    pgAfter.stints_2023 === 0 &&
    pgAfter.raw_pgs_2023 === 0 &&
    pgAfter.games_2024 === pgBefore.games_2024 &&
    pgAfter.logs_2025 === pgBefore.logs_2025 &&
    pgAfter.games_2026 === pgBefore.games_2026;

  const recommendedNext =
    verdict.startsWith('GREEN')
      ? 'Do not materialize 2023. Box Scores appears suitable as a repair source for the sampled games. Next authorized step may fetch the remaining 7 unique mismatch dates. Do not fetch them from 4D.'
      : verdict.startsWith('YELLOW')
        ? 'Do not keep hitting BDL. Anomaly likely exists in BDL historical box-score data, not only /v1/stats. Later options: materialize structurally valid stats with a provider-quality flag; exclude the 10 games from score-sensitive analytics; verify against a separately trusted source. Do not fabricate player points.'
        : 'STOP. Investigate endpoint/limiter before any further Box Scores dates. Do not materialize 2023.';

  const dateSummaries = dateResults.map((d) => {
    const { boxes: _boxes, ...rest } = d as { boxes?: unknown; [k: string]: unknown };
    return rest;
  });

  const report = {
    generatedAt,
    step: '4D',
    dryRun: false,
    safety: { ...safety, lockAcquiredDuringExecute: true, servingAfter: pgAfter },
    trialLimiter: {
      configuredDelayMs: delay.delayMs,
      concurrency: delay.concurrency,
      waitInFetchWithRetry: true,
      plannedRequests: 2,
      actualRequests: metrics.httpAttempts,
      http200s: metrics.httpSuccess,
      statuses,
      status429: metrics.status429,
      retries: metrics.retries,
      retryAfterUsed: metrics.retryAfterUsed,
      spacingSamplesMs: metrics.spacingSamplesMs,
      msBetweenRequest1And2: spacingBetween,
      minSpacingMs: minSample,
      limiterOk,
      note: limiterOk
        ? 'Spacing between the two date-scoped requests was >=12s.'
        : 'BURST: spacing below 12s. Remediating fetchWithRetry wait was not sufficient; stop larger date-scoped batches.',
    },
    feb7: dateSummaries.find((d) => d.date === '2024-02-07') ?? null,
    mar8: dateSummaries.find((d) => d.date === '2024-03-08') ?? null,
    perGame,
    doesBoxScoresFixProviderAnomaly: doesFix,
    additionalRequestsNeededIfUseful: additionalIfUseful,
    remainingMismatchDatesIfUseful: remainingDates,
    s3DiagnosticArchive: {
      prefix: diagnosticPrefix,
      objects: keys,
      manifest: `${diagnosticPrefix}/_probe_2date_manifest.json`,
      seasonGamesUntouched: true,
      seasonStatsPagesUntouched: true,
      gameScopedRepairsUntouched: true,
    },
    postgresUnchanged: { ok: postgresUnchanged, before: pgBefore, after: pgAfter },
    recommendedNextStep: recommendedNext,
    verdict,
    wallClockMs: Date.now() - wallStart,
  };

  mkdirSync('reports/trial', { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify(report, null, 2) + '\n');
  writeFileSync(
    OUT_MD,
    [
      '# 2023 Box Scores probe (Step 4D)',
      '',
      `Generated: ${generatedAt}`,
      '',
      `**${verdict}**`,
      '',
      `- dates: ${DATES.join(', ')}`,
      `- HTTP: ${metrics.httpAttempts} attempts / statuses ${statuses.join(', ')} / 429s ${metrics.status429}`,
      `- spacing request1→request2: ${spacingBetween} ms (min 12000)`,
      `- doesFix: ${doesFix}`,
      `- Postgres 2023 still empty: ${postgresUnchanged}`,
      '',
      recommendedNext,
      '',
    ].join('\n')
  );
  console.log(
    JSON.stringify(
      {
        verdict,
        doesFix,
        limiterOk,
        msBetweenRequest1And2: spacingBetween,
        results: perGame.map((g) => ({ gameId: g.gameId, result: g.result, boxPts: `${g.boxScores.homePts}-${g.boxScores.awayPts}` })),
      },
      null,
      2
    )
  );
  if (verdict.startsWith('RED')) process.exitCode = 2;
  else if (verdict.startsWith('YELLOW')) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error('[fatal]', err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });
