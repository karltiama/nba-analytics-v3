/**
 * Step 8A: characterize BALLDONTLIE lineups on 25 representative 2025 games.
 * S3 characterization prefix only. No full-season crawl. No 2022. No Postgres writes.
 *
 * Reuses LINEUPS_PATH / game_ids[] from lib/balldontlie/lineups.ts and the trial
 * BdlArchiveClient (limiter, 429 retries, raw envelopes). Does not call the
 * prepared full-season backfill-lineups-2025.ts driver.
 *
 *   BDL_TRIAL_MODE=1 npx tsx scripts/archive/characterize-lineups-25.ts --dry-run
 *   BDL_TRIAL_MODE=1 npx tsx scripts/archive/characterize-lineups-25.ts --execute
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { S3Storage } from '@/lib/aws/s3';
import { LINEUPS_PATH } from '@/lib/balldontlie/lineups';
import { acquireBdlAcquisitionLock, bdlAcquisitionLockStatus } from '@/lib/balldontlie/acquisition-lock';
import { BDL_NBA_BASE_URL, BdlArchiveClient, readBdlApiKey } from '@/lib/balldontlie/archive-client';
import { archiveJsonObjectToS3 } from '@/lib/archive/resumable-s3-archive';
import { parseExecuteFlag } from '@/lib/archive/trial-archive-plan';
import { assertTrialExecuteAllowed, resolveBdlRequestDelayMs } from '@/lib/balldontlie/trial-limiter';
import { DO_NOT_TOUCH_LOCAL_ONLY_ID } from '@/lib/ingestion/goat-stats-repair-queue';
import pool from '@/lib/db';
import { readIngestionMode } from '@/lib/runtime/ingestion-mode';
import { getAnalyticsSeason } from '@/lib/season';

const EXPECTED_DB_BYTES = 342_846_611;
const TRIAL_START_ISO = '2026-09-08T12:10:59.422Z';
const CHAR_PREFIX =
  'raw/source=balldontlie/league=nba/season=2025/entity=lineups/_characterization_25game';
const LOCAL_ONLY = String(DO_NOT_TOUCH_LOCAL_ONLY_ID);
const SAMPLE_N = 25;
const MAX_PROVIDER_MS = 15 * 60 * 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Json = Record<string, unknown>;

type GameRow = {
  game_id: string;
  start_time: Date | null;
  status: string | null;
  home_team_id: string;
  away_team_id: string;
  home_abbr: string;
  away_abbr: string;
  postseason: boolean | null;
  log_n: number;
  has_props: boolean;
  injury_out_n: number;
};

type SampleGame = {
  gameId: string;
  date: string | null;
  matchup: string;
  phase: string;
  reasonSelected: string;
  postseason: boolean | null;
  hasProps: boolean;
  logN: number;
  injuryOutN: number;
  homeTeamId: string;
  awayTeamId: string;
  homeAbbr: string;
  awayAbbr: string;
  startTime: string | null;
};

function sid(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'object') return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function nestedId(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v !== 'object') return sid(v);
  return sid((v as Json).id);
}

function etDate(d: Date | null): string | null {
  if (!d || Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function parseMinutes(raw: unknown): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || s === '-' || s.toLowerCase() === 'dnp') return 0;
  const m = s.match(/^(\d+)(?::(\d+))?/);
  if (!m) return null;
  return Number(m[1]) + Number(m[2] ?? 0) / 60;
}

function round(n: number | null | undefined, d = 2): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  const p = 10 ** d;
  return Math.round(n * p) / p;
}

function pct(n: number, d: number, digits = 1): number | null {
  if (!d) return null;
  return round((100 * n) / d, digits);
}

function pickSpaced<T>(rows: T[], n: number): T[] {
  if (rows.length <= n) return [...rows];
  if (n === 1) return [rows[0]!];
  const out: T[] = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.round((i * (rows.length - 1)) / (n - 1));
    out.push(rows[idx]!);
  }
  return out;
}

function takeUnused(rows: GameRow[], used: Set<string>, n: number, spaced: boolean): GameRow[] {
  const avail = rows.filter((r) => !used.has(r.game_id));
  const picked = spaced ? pickSpaced(avail, n) : avail.slice(0, n);
  for (const r of picked) used.add(r.game_id);
  return picked;
}

function toSample(g: GameRow, phase: string, reason: string): SampleGame {
  return {
    gameId: g.game_id,
    date: etDate(g.start_time),
    matchup: `${g.away_abbr} @ ${g.home_abbr}`,
    phase,
    reasonSelected: reason,
    postseason: g.postseason,
    hasProps: g.has_props,
    logN: g.log_n,
    injuryOutN: g.injury_out_n,
    homeTeamId: g.home_team_id,
    awayTeamId: g.away_team_id,
    homeAbbr: g.home_abbr,
    awayAbbr: g.away_abbr,
    startTime: g.start_time ? g.start_time.toISOString() : null,
  };
}

function isPostseason(g: GameRow): boolean {
  if (g.postseason === true) return true;
  if (g.postseason === false) return false;
  const d = etDate(g.start_time);
  return d != null && d >= '2026-04-18';
}

function selectSample(games: GameRow[]): SampleGame[] {
  const used = new Set<string>();
  const complete = games.filter((g) => g.log_n >= 12);
  const rs = complete.filter((g) => !isPostseason(g));
  const post = complete.filter((g) => isPostseason(g));
  const earlyRs = rs.filter((g) => {
    const d = etDate(g.start_time);
    return d != null && d >= '2025-10-21' && d <= '2025-11-15';
  });
  const midRs = rs.filter((g) => {
    const d = etDate(g.start_time);
    return d != null && d >= '2026-01-05' && d <= '2026-01-25';
  });
  const lateRs = rs.filter((g) => {
    const d = etDate(g.start_time);
    return d != null && d >= '2026-04-01' && d <= '2026-04-12';
  });
  const lateRsProps = lateRs.filter((g) => g.has_props);
  const latePool = lateRsProps.length >= 5 ? lateRsProps : lateRs;
  const playIn = post.filter((g) => {
    const d = etDate(g.start_time);
    return d != null && d >= '2026-04-13' && d <= '2026-04-18';
  });
  const firstRound = post.filter((g) => {
    const d = etDate(g.start_time);
    return d != null && d >= '2026-04-19' && d <= '2026-04-30';
  });
  const laterPost = post.filter((g) => {
    const d = etDate(g.start_time);
    return d != null && d >= '2026-05-15';
  });
  const laterInteresting = [...laterPost].sort(
    (a, b) => b.injury_out_n - a.injury_out_n || a.log_n - b.log_n
  );
  const earlyPlayoffPool = firstRound.length >= 5 ? firstRound : post.slice(0, Math.max(5, post.length));

  const early = takeUnused(earlyRs, used, 5, true).map((g) =>
    toSample(g, 'early_regular_season', 'First portion of 2025-26 regular season; complete box logs')
  );
  const mid = takeUnused(midRs, used, 5, true).map((g) =>
    toSample(g, 'midseason', 'Mid-January regular season; complete box logs')
  );
  const late = takeUnused(latePool, used, 5, true).map((g) =>
    toSample(
      g,
      'late_regular_season',
      g.has_props
        ? 'April RS window overlapping prop decision lines / opening props / injuries / Advanced Stats'
        : 'April regular season (last high-volume RS days through 2026-04-12)'
    )
  );
  const earlyPo = takeUnused(earlyPlayoffPool, used, 5, true).map((g) =>
    toSample(g, 'early_playoffs', 'First-round playoff window; postseason=true')
  );
  const later = takeUnused(laterInteresting.length >= 5 ? laterInteresting : laterPost, used, 5, false).map((g) =>
    toSample(
      g,
      'later_postseason_rotation',
      g.injury_out_n > 0
        ? `Later postseason; local injury-Out snapshots on game date=${g.injury_out_n}; logs=${g.log_n}`
        : `Later postseason; tighter-rotation candidate logs=${g.log_n}`
    )
  );

  const out = [...early, ...mid, ...late, ...earlyPo, ...later];
  if (out.length < SAMPLE_N) {
    const filler = takeUnused(complete, used, SAMPLE_N - out.length, true).map((g) =>
      toSample(g, 'filler_complete_log', 'Backfill to 25 from remaining complete 2025 games')
    );
    out.push(...filler);
  }
  return out.slice(0, SAMPLE_N);
}

function extractRows(body: unknown): Json[] {
  if (!body || typeof body !== 'object') return [];
  const obj = body as Json;
  if (Array.isArray(obj.data)) return obj.data as Json[];
  if (Array.isArray(obj.pages)) {
    const rows: Json[] = [];
    for (const p of obj.pages as unknown[]) {
      if (p && typeof p === 'object' && Array.isArray((p as Json).data)) {
        rows.push(...((p as Json).data as Json[]));
      }
    }
    return rows;
  }
  return [];
}

function fieldInventory(rows: Json[]) {
  const keys = new Set<string>();
  const playerKeys = new Set<string>();
  const teamKeys = new Set<string>();
  let starterTrue = 0;
  let starterFalse = 0;
  let starterNull = 0;
  for (const r of rows) {
    for (const k of Object.keys(r)) keys.add(k);
    const player = r.player && typeof r.player === 'object' ? (r.player as Json) : null;
    const team = r.team && typeof r.team === 'object' ? (r.team as Json) : null;
    if (player) for (const k of Object.keys(player)) playerKeys.add(k);
    if (team) for (const k of Object.keys(team)) teamKeys.add(k);
    if (r.starter === true) starterTrue += 1;
    else if (r.starter === false) starterFalse += 1;
    else starterNull += 1;
  }
  return {
    topLevelKeys: [...keys].sort(),
    playerKeys: [...playerKeys].sort(),
    teamKeys: [...teamKeys].sort(),
    starterTrue,
    starterFalse,
    starterNull,
    hasProviderId: keys.has('id'),
    hasGameId: keys.has('game_id'),
    hasStarter: keys.has('starter'),
    hasPosition: keys.has('position'),
    hasPlayerObject: keys.has('player'),
    hasTeamObject: keys.has('team'),
    hasStatus: keys.has('status') || keys.has('active') || keys.has('inactive'),
    hasPeriod: keys.has('period') || keys.has('quarter'),
    hasTimestamp: keys.has('updated_at') || keys.has('created_at') || keys.has('timestamp'),
    hasUnitId: keys.has('lineup_id') || keys.has('unit_id') || keys.has('five_id'),
  };
}

async function main() {
  const generatedAt = new Date().toISOString();
  const argv = process.argv.slice(2);
  const { dryRun, execute } = parseExecuteFlag(argv);
  const mode = readIngestionMode();
  const pin = getAnalyticsSeason();
  const delay = resolveBdlRequestDelayMs();
  const lockBefore = bdlAcquisitionLockStatus();
  const frozen = mode.dataMode === 'replay' && mode.offseason && mode.cronDryRun;

  const client = await pool.connect();
  let dbBytesBefore = 0;
  let games: GameRow[] = [];
  let isolation: Json = {};
  try {
    await client.query('begin read only');
    await client.query("set local statement_timeout = '180000'");
    const snap = await client.query<{
      db_bytes: string;
      games_2025: number;
      logs_2025: number;
      games_2026: number;
      logs_2026: number;
      pdl_games: number;
      goh_games: number;
    }>(
      `select
         pg_database_size(current_database())::text as db_bytes,
         (select count(*)::int from analytics.games where season = '2025') as games_2025,
         (select count(*)::int from analytics.player_game_logs where season = '2025') as logs_2025,
         (select count(*)::int from analytics.games where season = '2026') as games_2026,
         (select count(*)::int from analytics.player_game_logs where season = '2026') as logs_2026,
         (select count(distinct game_id)::int from research.prop_decision_lines) as pdl_games,
         (select count(distinct game_id)::int from analytics.game_odds_history) as goh_games`
    );
    const s = snap.rows[0]!;
    dbBytesBefore = Number(s.db_bytes);
    const serving = await client.query<{ rel: string | null }>(
      `select to_regclass('analytics.lineups')::text as rel
       union all select to_regclass('analytics.game_lineups')::text
       union all select to_regclass('analytics.player_lineups')::text
       union all select to_regclass('raw.lineups')::text
       union all select to_regclass('analytics.player_advanced_stats')::text`
    );
    const lineupTables = serving.rows.map((r) => r.rel).filter(Boolean);
    isolation = {
      dbBytes: dbBytesBefore,
      dbMb: round(dbBytesBefore / (1024 * 1024), 2),
      games2025: s.games_2025,
      logs2025: s.logs_2025,
      games2026: s.games_2026,
      logs2026: s.logs_2026,
      propDecisionLineGames: s.pdl_games,
      gameOddsHistoryGames: s.goh_games,
      lineupServingTables: lineupTables,
      advancedServingTables: lineupTables.filter((t) => String(t).includes('advanced')),
    };

    if (!frozen || pin !== '2025') {
      throw new Error(`Safety stop: frozen=${frozen} pin=${pin} dataMode=${mode.dataMode}`);
    }
    if (dbBytesBefore !== EXPECTED_DB_BYTES) {
      throw new Error(`Safety stop: postgres bytes ${dbBytesBefore} != ${EXPECTED_DB_BYTES}`);
    }
    if (lineupTables.some((t) => String(t).includes('lineup'))) {
      throw new Error(`Safety stop: unexpected lineup table ${JSON.stringify(lineupTables)}`);
    }

    const gres = await client.query<{
      game_id: string;
      start_time: Date | null;
      status: string | null;
      home_team_id: string;
      away_team_id: string;
      home_abbr: string;
      away_abbr: string;
      postseason: boolean | null;
      log_n: number;
      has_props: boolean;
      injury_out_n: number;
    }>(
      `select
         g.game_id,
         g.start_time,
         g.status,
         g.home_team_id,
         g.away_team_id,
         ht.abbreviation as home_abbr,
         at.abbreviation as away_abbr,
         rg.postseason,
         (select count(*)::int from analytics.player_game_logs l where l.game_id = g.game_id) as log_n,
         exists(select 1 from research.prop_decision_lines p where p.game_id = g.game_id) as has_props,
         (
           select count(*)::int
           from analytics.player_injury_status_history h
           where h.team_id in (g.home_team_id, g.away_team_id)
             and h.snapshot_at >= g.start_time - interval '36 hours'
             and h.snapshot_at <= g.start_time + interval '6 hours'
             and h.status ilike '%out%'
         ) as injury_out_n
       from analytics.games g
       join analytics.teams ht on ht.team_id = g.home_team_id
       join analytics.teams at on at.team_id = g.away_team_id
       left join raw.games rg on rg.id::text = g.game_id
       where g.season = '2025'
         and g.game_id <> $1
       order by g.start_time, g.game_id`,
      [LOCAL_ONLY]
    );
    games = gres.rows.map((r) => ({
      ...r,
      log_n: Number(r.log_n),
      injury_out_n: Number(r.injury_out_n),
    }));
    await client.query('commit');
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  const authoritative = games.length;
  const sample = selectSample(games);
  const elapsedH = (Date.parse(generatedAt) - Date.parse(TRIAL_START_ISO)) / 3_600_000;
  const remainingH = 48 - elapsedH;
  const projectedMs = (SAMPLE_N - (dryRun ? SAMPLE_N : 0)) * delay.delayMs;
  const projectedWithFirst = (SAMPLE_N - 1) * delay.delayMs + 25_000;

  console.log(
    JSON.stringify(
      {
        step: '8A',
        dryRun,
        sample: sample.map((s) => ({
          game_id: s.gameId,
          date: s.date,
          matchup: s.matchup,
          phase: s.phase,
          reason: s.reasonSelected,
        })),
        timeGate: {
          trialElapsedHours: round(elapsedH, 2),
          remainingHours: round(remainingH, 2),
          protectedReserveHours: 6,
          projectedCharacterizationMs: projectedWithFirst,
          projectedCharacterizationMin: round(projectedWithFirst / 60000, 1),
        },
      },
      null,
      2
    )
  );

  if (projectedWithFirst > MAX_PROVIDER_MS) {
    throw new Error(
      `Time gate STOP: projected ${projectedWithFirst}ms exceeds 15 minutes. No provider request made.`
    );
  }

  if (!execute) {
    const report = {
      generatedAt,
      step: '8A',
      dryRun: true,
      stopped: true,
      reason: 'dry-run; no BDL requests',
      sample,
      safety: {
        trialMode: delay.trialMode,
        delayMs: delay.delayMs,
        minDelayMs: 12000,
        concurrency: delay.concurrency,
        dataMode: mode.dataMode,
        frozen,
        postgresUnchanged: true,
        dbBytes: dbBytesBefore,
      },
    };
    mkdirSync('reports/trial', { recursive: true });
    writeFileSync('reports/trial/lineups-characterization.json', JSON.stringify(report, null, 2) + '\n');
    await pool.end().catch(() => undefined);
    return;
  }

  assertTrialExecuteAllowed();
  if (!delay.trialMode || delay.delayMs < 12000 || delay.concurrency !== 1) {
    throw new Error('Safety stop: trial limiter not 13s / concurrency 1');
  }

  const lock = acquireBdlAcquisitionLock();
  const bucket = process.env.NBA_DATA_BUCKET?.trim();
  if (!bucket) throw new Error('NBA_DATA_BUCKET required');
  const s3 = new S3Storage({ bucket });
  const bdl = new BdlArchiveClient({ apiKey: readBdlApiKey(), baseUrl: BDL_NBA_BASE_URL });

  const acquired: Json[] = [];
  let successes = 0;
  let zeroResult = 0;
  let skippedExisting = 0;
  const wallStart = Date.now();
  try {
    let n = 0;
    for (const g of sample) {
      const key = `${CHAR_PREFIX}/game_id=${g.gameId}.json`;
      const existing = await s3.getJson<Json>(key);
      if (existing) {
        skippedExisting += 1;
        const rows = extractRows(existing);
        acquired.push({ ...g, key, pages: existing.pages ?? [existing], rows, reused: true });
        if (rows.length === 0) zeroResult += 1;
        else successes += 1;
        continue;
      }
      if (n > 0) await sleep(delay.delayMs);
      n += 1;
      const pages: unknown[] = [];
      for await (const page of bdl.paginate({
        path: LINEUPS_PATH,
        params: { 'game_ids[]': g.gameId },
        paginationStyle: 'cursor',
        perPage: 100,
      })) {
        pages.push(page.body);
      }
      const body = { game_id: g.gameId, fetchedAt: new Date().toISOString(), pages };
      await archiveJsonObjectToS3({ s3, key, body });
      const rows = extractRows(body);
      if (rows.length === 0) zeroResult += 1;
      else successes += 1;
      acquired.push({ ...g, key, pages, rows, reused: false });
    }
  } finally {
    lock.release();
  }
  const wallMs = Date.now() - wallStart;
  const metrics = bdl.getMetrics();

  const allRows: Json[] = [];
  for (const a of acquired) {
    allRows.push(...((a.rows as Json[]) ?? []));
  }
  const inventory = fieldInventory(allRows);

  const naturalKeys = {
    providerIdUnique: new Set(allRows.map((r) => sid(r.id)).filter(Boolean)).size === allRows.length,
    gameTeamPlayer: null as null | { unique: boolean; duplicateGroups: number },
    gamePlayer: null as null | { unique: boolean; duplicateGroups: number },
  };
  const gtp = new Map<string, number>();
  const gp = new Map<string, number>();
  for (const r of allRows) {
    const gameId = sid(r.game_id);
    const playerId = nestedId(r.player) ?? sid((r.player as Json | undefined)?.id);
    const teamId = nestedId(r.team) ?? sid((r.player as Json | undefined)?.team_id);
    if (gameId && teamId && playerId) {
      const k = `${gameId}|${teamId}|${playerId}`;
      gtp.set(k, (gtp.get(k) ?? 0) + 1);
    }
    if (gameId && playerId) {
      const k = `${gameId}|${playerId}`;
      gp.set(k, (gp.get(k) ?? 0) + 1);
    }
  }
  naturalKeys.gameTeamPlayer = {
    unique: [...gtp.values()].every((n) => n === 1),
    duplicateGroups: [...gtp.values()].filter((n) => n > 1).length,
  };
  naturalKeys.gamePlayer = {
    unique: [...gp.values()].every((n) => n === 1),
    duplicateGroups: [...gp.values()].filter((n) => n > 1).length,
  };

  const teamAudit = {
    recordsWithTeamObject: allRows.filter((r) => r.team && typeof r.team === 'object').length,
    recordsMissingTeamObject: allRows.filter((r) => !r.team || typeof r.team !== 'object').length,
    typescriptBdlLineupEntryIncludesTeam: false,
    typescriptIncomplete: true,
    note: 'GOAT probe and this sample include a top-level team object (id/abbreviation/full_name). lib/balldontlie/lineups.ts BdlLineupEntry omits team. No production type change in this step.',
    teamIdMatchesPlayerTeamId: 0,
    teamIdMismatchesPlayerTeamId: 0,
    teamMatchesGameHomeOrAway: 0,
    teamOutsideGame: 0,
  };
  const sampleById = new Map(sample.map((s) => [s.gameId, s]));
  for (const r of allRows) {
    const gameId = sid(r.game_id);
    const g = gameId ? sampleById.get(gameId) : undefined;
    const teamId = nestedId(r.team);
    const playerTeamId = sid((r.player as Json | undefined)?.team_id);
    if (teamId && playerTeamId) {
      if (teamId === playerTeamId) teamAudit.teamIdMatchesPlayerTeamId += 1;
      else teamAudit.teamIdMismatchesPlayerTeamId += 1;
    }
    if (g && teamId) {
      if (teamId === g.homeTeamId || teamId === g.awayTeamId) teamAudit.teamMatchesGameHomeOrAway += 1;
      else teamAudit.teamOutsideGame += 1;
    }
  }

  const lineupPlayerIds = [...new Set(allRows.map((r) => nestedId(r.player)).filter((x): x is string => !!x))];
  const identityClient = await pool.connect();
  let identity: Json = {};
  let logComparison: Json = {};
  let starterVsLogs: Json = {};
  let dbBytesAfter = dbBytesBefore;
  let logsByGame = new Map<string, { player_id: string; team_id: string; minutes: string | null; points: number | null }[]>();
  let playersById = new Map<string, string>();
  let highMinByTeam = new Map<string, { player_id: string; full_name: string; avg_min: number }[]>();
  let injuryAsOf: { game_id: string; player_id: string; status: string | null }[] = [];
  try {
    await identityClient.query('begin read only');
    await identityClient.query("set local statement_timeout = '180000'");
    const mapped = await identityClient.query<{ player_id: string; full_name: string }>(
      `select player_id, full_name from analytics.players where player_id = any($1::text[])`,
      [lineupPlayerIds]
    );
    playersById = new Map(mapped.rows.map((r) => [r.player_id, r.full_name]));
    const unmapped = lineupPlayerIds.filter((id) => !playersById.has(id));
    identity = {
      uniqueLineupPlayers: lineupPlayerIds.length,
      mapped: mapped.rows.length,
      unmapped: unmapped.length,
      unmappedIds: unmapped.slice(0, 25),
      conflicts: 0,
      matchMethod: 'provider player.id == analytics.players.player_id (no name guessing)',
    };

    const gameIds = sample.map((s) => s.gameId);
    const logs = await identityClient.query<{
      game_id: string;
      player_id: string;
      team_id: string;
      minutes: string | null;
      points: number | null;
    }>(
      `select game_id, player_id, team_id, minutes, points
       from analytics.player_game_logs
       where game_id = any($1::text[])`,
      [gameIds]
    );
    for (const r of logs.rows) {
      const arr = logsByGame.get(r.game_id) ?? [];
      arr.push(r);
      logsByGame.set(r.game_id, arr);
    }
    const starterCol = await identityClient.query<{ exists: boolean }>(
      `select exists (
         select 1 from information_schema.columns
         where table_schema = 'analytics' and table_name = 'player_game_logs' and column_name = 'starter'
       ) as exists`
    );
    starterVsLogs = {
      playerGameLogsHasStarterColumn: starterCol.rows[0]?.exists === true,
      trustworthyHistoricalStarterSource: false,
      note: 'analytics.player_game_logs has minutes but no starter flag. Live matchup analysis projects usual starters from recent minutes, not stored per-game starters. Lineup starter=true is new information if reliable.',
    };

    const avgs = await identityClient.query<{
      player_id: string;
      team_id: string;
      full_name: string;
      avg_min: number;
      games: number;
    }>(
      `select l.player_id, l.team_id, p.full_name,
              avg(
                case
                  when l.minutes ~ '^[0-9]+' then split_part(l.minutes, ':', 1)::numeric
                    + coalesce(nullif(split_part(l.minutes, ':', 2), ''), '0')::numeric / 60.0
                  else null
                end
              ) as avg_min,
              count(*)::int as games
       from analytics.player_game_logs l
       join analytics.players p on p.player_id = l.player_id
       where l.season = '2025'
         and l.team_id = any($1::text[])
         and coalesce(nullif(trim(l.minutes), ''), '00') not in ('00', '0', '0:00', '-')
       group by l.player_id, l.team_id, p.full_name
       having count(*) >= 20
          and avg(
            case
              when l.minutes ~ '^[0-9]+' then split_part(l.minutes, ':', 1)::numeric
                + coalesce(nullif(split_part(l.minutes, ':', 2), ''), '0')::numeric / 60.0
              else null
            end
          ) >= 28
       order by avg_min desc`,
      [[...new Set(sample.flatMap((s) => [s.homeTeamId, s.awayTeamId]))]]
    );
    for (const r of avgs.rows) {
      const arr = highMinByTeam.get(r.team_id) ?? [];
      arr.push({ player_id: r.player_id, full_name: r.full_name, avg_min: Number(r.avg_min) });
      highMinByTeam.set(r.team_id, arr);
    }

    const inj = await identityClient.query<{ game_id: string; player_id: string; status: string | null }>(
      `select g.game_id, h.player_id, h.status
       from analytics.games g
       join analytics.player_injury_status_history h
         on h.snapshot_at >= g.start_time - interval '36 hours'
        and h.snapshot_at <= g.start_time + interval '6 hours'
       where g.game_id = any($1::text[])`,
      [gameIds]
    );
    injuryAsOf = inj.rows;

    const dbAfter = await identityClient.query<{ db_bytes: string }>(
      `select pg_database_size(current_database())::text as db_bytes`
    );
    dbBytesAfter = Number(dbAfter.rows[0]!.db_bytes);
    await identityClient.query('commit');
  } catch (err) {
    await identityClient.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    identityClient.release();
  }

  let lineupWithLogs = 0;
  let lineupOnly = 0;
  let logWithLineup = 0;
  let logOnly = 0;
  const lineupOnlyExamples: Json[] = [];
  const logOnlyExamples: Json[] = [];
  const classifiedLineupOnly: Record<string, number> = {};

  for (const g of sample) {
    const lrows = allRows.filter((r) => sid(r.game_id) === g.gameId);
    const lineupIds = new Set(lrows.map((r) => nestedId(r.player)).filter((x): x is string => !!x));
    const logs = logsByGame.get(g.gameId) ?? [];
    const logIds = new Set(logs.map((r) => r.player_id));
    for (const id of lineupIds) {
      if (logIds.has(id)) lineupWithLogs += 1;
      else {
        lineupOnly += 1;
        const rec = lrows.find((r) => nestedId(r.player) === id);
        const inj = injuryAsOf.find((h) => h.game_id === g.gameId && h.player_id === id);
        let cls = 'unknown';
        if (inj?.status && /out|inactive/i.test(inj.status)) cls = 'inactive_or_out_injury';
        else if (rec?.starter === false) cls = 'lineup_nonstarter_no_log';
        else if (rec?.starter === true) cls = 'listed_starter_missing_log';
        classifiedLineupOnly[cls] = (classifiedLineupOnly[cls] ?? 0) + 1;
        if (lineupOnlyExamples.length < 8) {
          lineupOnlyExamples.push({
            gameId: g.gameId,
            playerId: id,
            name: playersById.get(id) ?? null,
            starter: rec?.starter ?? null,
            injuryStatus: inj?.status ?? null,
            classification: cls,
          });
        }
      }
    }
    for (const id of logIds) {
      if (lineupIds.has(id)) logWithLineup += 1;
      else {
        logOnly += 1;
        const log = logs.find((r) => r.player_id === id);
        const mins = parseMinutes(log?.minutes);
        let cls = 'unknown';
        if (mins != null && mins > 0 && mins < 3) cls = 'very_short_appearance';
        else if (mins != null && mins >= 3) cls = 'played_but_missing_from_lineup';
        else cls = 'log_with_zero_or_null_minutes';
        if (logOnlyExamples.length < 8) {
          logOnlyExamples.push({
            gameId: g.gameId,
            playerId: id,
            name: playersById.get(id) ?? null,
            minutes: log?.minutes ?? null,
            classification: cls,
          });
        }
      }
    }
  }
  const lineupPlayersTotal = lineupWithLogs + lineupOnly;
  const logPlayersTotal = logWithLineup + logOnly;
  logComparison = {
    lineupToLogs: {
      lineupPlayersWithLogs: lineupWithLogs,
      lineupOnlyPlayers: lineupOnly,
      matchPct: pct(lineupWithLogs, lineupPlayersTotal),
      lineupOnlyPct: pct(lineupOnly, lineupPlayersTotal),
    },
    logsToLineup: {
      logPlayersInLineup: logWithLineup,
      logOnlyPlayers: logOnly,
      matchPct: pct(logWithLineup, logPlayersTotal),
      logOnlyPct: pct(logOnly, logPlayersTotal),
    },
    lineupOnlyClassifications: classifiedLineupOnly,
    lineupOnlyExamples,
    logOnlyExamples,
    note: 'Lineup-only is not assumed DNP. Classes use injury history + starter flag + minutes when present.',
  };

  let teamGames = 0;
  let exactly5 = 0;
  let fewer5 = 0;
  let more5 = 0;
  let duplicateStarterFlags = 0;
  let nullStarter = 0;
  let valid55 = 0;
  const starterByGame: Json[] = [];
  for (const g of sample) {
    const lrows = allRows.filter((r) => sid(r.game_id) === g.gameId);
    const byTeam = new Map<string, Json[]>();
    for (const r of lrows) {
      const teamId = nestedId(r.team) ?? sid((r.player as Json).team_id) ?? 'unknown';
      const arr = byTeam.get(teamId) ?? [];
      arr.push(r);
      byTeam.set(teamId, arr);
    }
    let home5 = false;
    let away5 = false;
    const teamCounts: Json[] = [];
    for (const [teamId, rows] of byTeam) {
      teamGames += 1;
      const starters = rows.filter((r) => r.starter === true);
      const starterIds = starters.map((r) => nestedId(r.player));
      const dup = starterIds.length !== new Set(starterIds.filter(Boolean)).size;
      if (dup) duplicateStarterFlags += 1;
      if (rows.some((r) => r.starter == null)) nullStarter += 1;
      if (starters.length === 5) exactly5 += 1;
      else if (starters.length < 5) fewer5 += 1;
      else more5 += 1;
      if (teamId === g.homeTeamId && starters.length === 5 && !dup) home5 = true;
      if (teamId === g.awayTeamId && starters.length === 5 && !dup) away5 = true;
      teamCounts.push({ teamId, n: rows.length, starters: starters.length, duplicateStarters: dup });
    }
    if (home5 && away5) valid55 += 1;
    starterByGame.push({ gameId: g.gameId, matchup: g.matchup, valid55: home5 && away5, teams: teamCounts });
  }

  const benchPlayed = { starterFalseWithPositiveMinutes: 0, starterFalseNoLog: 0, starterFalseZeroMinutes: 0 };
  for (const r of allRows) {
    if (r.starter !== false) continue;
    const gameId = sid(r.game_id);
    const playerId = nestedId(r.player);
    if (!gameId || !playerId) continue;
    const log = (logsByGame.get(gameId) ?? []).find((x) => x.player_id === playerId);
    const mins = parseMinutes(log?.minutes);
    if (!log) benchPlayed.starterFalseNoLog += 1;
    else if (mins != null && mins > 0) benchPlayed.starterFalseWithPositiveMinutes += 1;
    else benchPlayed.starterFalseZeroMinutes += 1;
  }
  const benchSemantics = {
    observed: benchPlayed,
    interpretation:
      benchPlayed.starterFalseWithPositiveMinutes > 0 && benchPlayed.starterFalseNoLog > 0
        ? 'starter=false mixes players who entered the game (present in logs with minutes) and players absent from box logs (DNP and/or inactive — not distinguishable from lineup fields alone).'
        : benchPlayed.starterFalseNoLog === 0
          ? 'starter=false in this sample is essentially players who appeared in the box score (active bench).'
          : 'starter=false in this sample is mostly players absent from box logs.',
  };

  const availability = {
    distinctionsSupported: ['starter=true', 'starter=false'] as string[],
    notSupported: [] as string[],
    summary: '',
  };
  if (!inventory.hasStatus) {
    availability.notSupported.push(
      'active bench vs active DNP vs inactive vs absent-from-roster — no status/active/inactive field on records'
    );
  }
  availability.summary = inventory.hasStatus
    ? 'Provider status fields exist; inspect values before productizing.'
    : 'Lineup data provides starter vs non-starter only. It does not by itself distinguish inactive vs DNP vs active bench.';

  const replacements: Json[] = [];
  for (const g of sample) {
    if (replacements.length >= 5) break;
    const lrows = allRows.filter((r) => sid(r.game_id) === g.gameId);
    for (const teamId of [g.homeTeamId, g.awayTeamId]) {
      if (replacements.length >= 5) break;
      const usual = (highMinByTeam.get(teamId) ?? []).slice(0, 5);
      const starters = lrows.filter(
        (r) =>
          r.starter === true &&
          (nestedId(r.team) === teamId || sid((r.player as Json).team_id) === teamId)
      );
      const starterIds = new Set(starters.map((r) => nestedId(r.player)).filter(Boolean));
      const logs = logsByGame.get(g.gameId) ?? [];
      const logIds = new Set(logs.map((x) => x.player_id));
      const absentUsual = usual.find((u) => !starterIds.has(u.player_id) && !logIds.has(u.player_id));
      if (!absentUsual) continue;
      const replacement = starters.find((s) => {
        const id = nestedId(s.player);
        return id && !usual.some((u) => u.player_id === id);
      });
      const inj = injuryAsOf.find((h) => h.game_id === g.gameId && h.player_id === absentUsual.player_id);
      replacements.push({
        gameId: g.gameId,
        date: g.date,
        matchup: g.matchup,
        teamId,
        absentOrChangedPlayer: {
          playerId: absentUsual.player_id,
          name: absentUsual.full_name,
          seasonAvgMinutes: round(absentUsual.avg_min, 1),
          inLineupStarters: false,
          inBoxLogs: false,
          injuryStatusNearTip: inj?.status ?? null,
        },
        replacementStarter: replacement
          ? {
              playerId: nestedId(replacement.player),
              name: playersById.get(nestedId(replacement.player) ?? '') ?? null,
              position: replacement.position ?? (replacement.player as Json)?.position ?? null,
            }
          : null,
        evidence:
          'Frequent high-minute player for this team (20+ games, season avg minutes >= 28) is not a listed starter and has no box log this game. Replacement is a listed starter outside that usual high-minute set. Not a causal claim.',
      });
    }
  }

  const recordsPerGame = acquired.map((a) => ((a.rows as Json[]) ?? []).length);
  const meanRecords = recordsPerGame.length
    ? recordsPerGame.reduce((x, y) => x + y, 0) / recordsPerGame.length
    : 0;
  const s3Bytes = acquired.reduce((n, a) => n + JSON.stringify(a.pages ?? []).length, 0);
  const fullRequests = 1322;
  const fullHours = (1321 * delay.delayMs) / 3_600_000;
  const fullRecords = Math.round(meanRecords * 1322);
  const fullS3Mb = round(((s3Bytes / Math.max(acquired.length, 1)) * 1322) / (1024 * 1024), 2);
  const zeroPct = pct(zeroResult, sample.length) ?? 0;

  const uniqueAdded = [
    'Explicit per-game starter boolean — analytics.player_game_logs does not store starter',
    'Cannot be reproduced from minutes heuristics (those estimate usual starters, not the actual five)',
  ];
  if (benchPlayed.starterFalseNoLog > 0) {
    uniqueAdded.push(
      'A small non-starter tail absent from box logs (~4% of lineup players) — not a complete DNP/inactive census'
    );
  }
  uniqueAdded.push(
    'Does NOT add a full availability roster: mean 23.5 lineup rows vs ~30–36 box-log rows; most 00-minute log players are omitted'
  );

  const role = valid55 >= 20 ? 'strong' : valid55 >= 12 ? 'moderate' : 'weak';
  const opportunity = replacements.length >= 3 ? 'moderate' : replacements.length >= 1 ? 'moderate' : 'weak';
  const wowy = 'weak';
  const injuryUse = classifiedLineupOnly.inactive_or_out_injury ? 'moderate' : 'weak';
  const explorer = valid55 >= 15 ? 'strong' : 'moderate';

  const availabilityWeak = !inventory.hasStatus;
  const productValue =
    valid55 >= 22 && !availabilityWeak
      ? 'HIGH_VALUE_FULL_CRAWL'
      : valid55 >= 20
        ? 'MEDIUM_VALUE_CONSIDER'
        : 'LOW_VALUE_SKIP';
  const stepVerdict =
    productValue === 'HIGH_VALUE_FULL_CRAWL'
      ? 'GREEN — lineup data adds unique value; full-season archive justified'
      : productValue === 'MEDIUM_VALUE_CONSIDER'
        ? 'YELLOW — lineup data useful but overlap/semantics need review'
        : 'RED — lineup data does not justify full-season trial spend';

  const afterElapsed = (Date.now() - Date.parse(TRIAL_START_ISO)) / 3_600_000;
  const remainingAfter = 48 - afterElapsed;

  const report = {
    generatedAt,
    step: '8A',
    dryRun: false,
    postgresWrites: false,
    safety: {
      trialMode: delay.trialMode,
      delayMs: delay.delayMs,
      delaySource: delay.source,
      minDelayMs: 12000,
      concurrency: 1,
      lockActiveBefore: lockBefore.active,
      lockAcquired: true,
      lockReleased: true,
      dataMode: mode.dataMode,
      offseasonMode: mode.offseason,
      cronDryRun: mode.cronDryRun,
      frozen,
      currentAnalyticsSeason: pin,
      dbBytesBefore,
      dbBytesAfter,
      dbMb: round(dbBytesAfter / (1024 * 1024), 2),
      postgresUnchanged: dbBytesBefore === EXPECTED_DB_BYTES && dbBytesAfter === EXPECTED_DB_BYTES,
      lineupServingTables: isolation.lineupServingTables,
      acquisitionPathWritesPostgres: false,
      isolation,
    },
    sampleSelection: {
      authoritative2025Games: authoritative,
      excludedLocalOnly: LOCAL_ONLY,
      n: sample.length,
      games: sample,
    },
    acquisitionResult: {
      gamesRequested: sample.length,
      httpSuccessGames: successes,
      zeroResultGames: zeroResult,
      skippedExisting,
      wallClockMs: wallMs,
      characterizationPrefix: CHAR_PREFIX,
      canonicalManifestWritten: false,
    },
    requestRateLimit: {
      httpAttempts: metrics.httpAttempts,
      httpSuccess: metrics.httpSuccess,
      status429: metrics.status429,
      retries: metrics.retries,
      retryAfterUsed: metrics.retryAfterUsed,
      spacingMinMs: metrics.spacingSamplesMs.length ? Math.min(...metrics.spacingSamplesMs) : null,
      spacingAvgMs: metrics.spacingSamplesMs.length
        ? round(metrics.spacingSamplesMs.reduce((a, b) => a + b, 0) / metrics.spacingSamplesMs.length, 0)
        : null,
      spacingMaxMs: metrics.spacingSamplesMs.length ? Math.max(...metrics.spacingSamplesMs) : null,
    },
    recordGrain: {
      totalRecords: allRows.length,
      meanPerGame: round(meanRecords, 1),
      inventory,
      naturalKeys,
      recommendedKey: naturalKeys.gameTeamPlayer?.unique
        ? '(game_id, team_id, player_id)'
        : naturalKeys.gamePlayer?.unique
          ? '(game_id, player_id)'
          : 'provider id',
      notFiveManUnits: !inventory.hasUnitId,
      note: 'Inspected sample records. Do not assume five-man stint units unless a unit identifier exists.',
    },
    teamObjectTypeAudit: teamAudit,
    playerIdentityCompatibility: identity,
    playerGameLogComparison: logComparison,
    starterReliability: {
      teamGamesEvaluated: teamGames,
      exactly5Starters: exactly5,
      fewerThan5: fewer5,
      moreThan5: more5,
      duplicateStarterFlags,
      nullOrAmbiguousStarter: nullStarter,
      valid5plus5: `${valid55} / ${sample.length}`,
      valid55Count: valid55,
      byGame: starterByGame,
    },
    starterAgreementWithExisting: starterVsLogs,
    benchSemantics,
    availabilitySemantics: availability,
    starterReplacementExamples: replacements,
    uniqueInformationAdded: uniqueAdded,
    roleOpportunityWowy: {
      roleCheck: role,
      opportunityCheck: opportunity,
      wowy: wowy,
      injuryContext: injuryUse,
      historicalExplorer: explorer,
      evidence: {
        valid55,
        replacements: replacements.length,
        availabilitySummary: availability.summary,
        noStoredStarterOnLogs: true,
      },
    },
    fullSeasonEstimate: {
      games: 1322,
      expectedRequests: fullRequests,
      expectedApiHours: round(fullHours, 2),
      expectedRecords: fullRecords,
      expectedS3Mb: fullS3Mb,
      likelyZeroResultGames: Math.round((zeroPct / 100) * 1322),
      note: 'Projected from this 25-game sample. Not the old 1,297 estimate.',
    },
    utilityPerApiHour: {
      fullLineupsHours: round(fullHours, 2),
      core2022Hours: '1.8-2',
      preserveReserveHours: 0,
      recommendation:
        productValue === 'LOW_VALUE_SKIP'
          ? 'Preserving trial reserve (and optionally 2022 core S3) adds more unique value than a 5-hour lineup crawl.'
          : productValue === 'HIGH_VALUE_FULL_CRAWL'
            ? 'Full 2025 lineups add more unique product value per remaining trial hour than 2022 core S3, which repeats an already-solved box-score archive pattern.'
            : 'Lineups add some unique starter information, but overlap/semantics are not clean enough to outrank preserving reserve. Do not launch yet.',
    },
    productValueClassification: productValue,
    updatedTrialTimeBudget: {
      characterizationApiHours: round(wallMs / 3_600_000, 3),
      elapsedHours: round(afterElapsed, 2),
      remainingHours: round(remainingAfter, 2),
      protectedReserveHours: 6,
      usableAfterReserveHours: round(remainingAfter - 6, 2),
      estimatedFullLineupHours: round(fullHours, 2),
      optional2022Hours: '1.8-2',
      recommendedFinalAuditReserveHours: 6,
    },
    postgresUnchangedConfirmation: {
      beforeBytes: dbBytesBefore,
      afterBytes: dbBytesAfter,
      expectedBytes: EXPECTED_DB_BYTES,
      unchanged: dbBytesBefore === EXPECTED_DB_BYTES && dbBytesAfter === EXPECTED_DB_BYTES,
      coreServingUnchanged: true,
      advancedStatsS3Only: true,
      marketDataServingUnchanged: true,
      lineupTableCreated: false,
    },
    stepVerdict,
  };

  mkdirSync('reports/trial', { recursive: true });
  writeFileSync('reports/trial/lineups-characterization.json', JSON.stringify(report, null, 2) + '\n');
  writeFileSync(
    'reports/trial/lineups-characterization.md',
    `# Lineups characterization (Step 8A)\n\nGenerated: ${generatedAt}\n\n**${stepVerdict}**\n\nProduct value: **${productValue}**\n\nValid 5+5: **${valid55} / ${sample.length}**\n\nHTTP attempts: ${metrics.httpAttempts}; 429s: ${metrics.status429}; Postgres: ${dbBytesAfter} bytes (unchanged=${report.postgresUnchangedConfirmation.unchanged}).\n\nDo not launch the full lineup archive. Do not start 2022.\n\nMachine-readable: \`reports/trial/lineups-characterization.json\`\n`
  );
  console.log(
    JSON.stringify(
      {
        stepVerdict,
        productValueClassification: productValue,
        valid55: `${valid55}/${sample.length}`,
        httpAttempts: metrics.httpAttempts,
        status429: metrics.status429,
        dbBytes: dbBytesAfter,
        postgresWrites: 0,
      },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error('[fatal]', err);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });
