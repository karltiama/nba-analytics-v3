/**
 * Step 2D: read-only 2025–26 repair certification.
 * Uses cached BDL inventory only. No provider HTTP. No Postgres writes. No 2024.
 *
 *   npx tsx scripts/ops/certify-2025-completeness.ts
 */
import 'dotenv/config';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { S3Storage } from '@/lib/aws/s3';
import { rawEntityPrefix } from '@/lib/archive/trial-archive-plan';
import { bdlAcquisitionLockStatus } from '@/lib/balldontlie/acquisition-lock';
import {
  DO_NOT_TOUCH_LOCAL_ONLY_ID,
  GOAT_STATS_REPAIR_IDS,
  INCOMPLETE_BOX_STATS_ID,
  PLAYOFF_TAIL_MISSING_STATS_IDS,
} from '@/lib/ingestion/goat-stats-repair-queue';
import pool from '@/lib/db';
import { readIngestionMode } from '@/lib/runtime/ingestion-mode';
import { getAnalyticsSeason } from '@/lib/season';

const CACHE_PATH = 'reports/trial/bdl-games-2025.json';
const STORAGE_PREV = 'reports/storage/after-31game-materialize.json';
const OUT_JSON = 'reports/trial/2025-final-completeness-certification.json';
const OUT_MD = 'reports/trial/2025-final-completeness-certification.md';
const SEASON = '2025';
const LOCAL_ONLY = String(DO_NOT_TOUCH_LOCAL_ONLY_ID);
const BOX_ID = String(INCOMPLETE_BOX_STATS_ID);
const PLAYOFF_TAIL = PLAYOFF_TAIL_MISSING_STATS_IDS.map(String);
const REPAIR_34 = [...new Set(GOAT_STATS_REPAIR_IDS.map(String))];

type Gate = 'GREEN' | 'YELLOW' | 'RED';

type BdlGame = {
  id: number;
  date?: string | null;
  datetime?: string | null;
  status?: string | null;
  status_state?: string | null;
  home_team_score?: number | null;
  visitor_team_score?: number | null;
  home_team?: { id?: number | null } | null;
  visitor_team?: { id?: number | null } | null;
};

function sid(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

function dateOnly(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = String(v).trim();
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function etDateFromTs(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return dateOnly(iso);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function isFinalStatus(status: string | null | undefined): boolean {
  const s = (status ?? '').trim().toLowerCase();
  return s === 'final' || s.includes('final');
}

function color(ok: boolean, yellowNote?: string | null): Gate {
  if (!ok) return 'RED';
  return yellowNote ? 'YELLOW' : 'GREEN';
}

function worst(gates: Gate[]): Gate {
  if (gates.includes('RED')) return 'RED';
  if (gates.includes('YELLOW')) return 'YELLOW';
  return 'GREEN';
}

async function main() {
  const generatedAt = new Date().toISOString();
  const mode = readIngestionMode();
  const pin = getAnalyticsSeason();
  const lock = bdlAcquisitionLockStatus();
  const unsafe: string[] = [];
  if (mode.dataMode !== 'replay') unsafe.push(`DATA_MODE=${mode.dataMode || '(empty)'}`);
  if (!mode.offseason) unsafe.push('OFFSEASON_MODE not 1');
  if (!mode.cronDryRun) unsafe.push('CRON_DRY_RUN not 1');
  if (pin !== SEASON) unsafe.push(`effective season pin=${pin}`);
  if (lock.active) unsafe.push(`BDL acquisition lock active pid=${lock.pid}`);

  const safety = {
    dataMode: mode.dataMode,
    offseasonMode: mode.offseason,
    cronDryRun: mode.cronDryRun,
    frozen: mode.dataMode === 'replay' && mode.offseason && mode.cronDryRun,
    currentAnalyticsSeason: pin,
    bdlLockActive: lock.active,
    bdlLockPid: lock.pid,
    bdlHttpRequests: 0,
    postgresWrites: false,
    season2026UntouchedByThisStep: true,
    note: 'This script never imports BdlArchiveClient and opens Postgres BEGIN READ ONLY.',
  };

  if (unsafe.length) {
    const stopped = {
      generatedAt,
      step: '2D',
      stopped: true,
      reason: 'safety confirmation failed',
      unsafe,
      safety,
      verdict: 'RED — stop historical progression',
    };
    mkdirSync('reports/trial', { recursive: true });
    writeFileSync(OUT_JSON, JSON.stringify(stopped, null, 2) + '\n');
    console.log(JSON.stringify(stopped, null, 2));
    process.exit(2);
  }

  const cache = JSON.parse(readFileSync(CACHE_PATH, 'utf8')) as {
    generatedAt?: string;
    count?: number;
    games: BdlGame[];
  };
  const allCached = cache.games ?? [];
  const finals = allCached.filter((g) => isFinalStatus(g.status) || isFinalStatus(g.status_state));
  const finalIds = finals.map((g) => String(g.id));
  const finalIntIds = finals.map((g) => g.id);
  const official = new Map(finals.map((g) => [String(g.id), g]));
  const localOnlyInCache = allCached.some((g) => String(g.id) === LOCAL_ONLY);

  const client = await pool.connect();
  try {
    await client.query('begin read only');

    const games = await client.query(
      `select game_id, season, status, start_time::text as start_time,
              home_team_id, away_team_id, home_score, away_score,
              updated_at::text as updated_at
       from analytics.games
       where game_id = any($1::text[])`,
      [finalIds.concat(LOCAL_ONLY)]
    );
    const dupGames = await client.query(
      `select game_id, count(*)::int as n
       from analytics.games
       where game_id = any($1::text[])
       group by 1 having count(*) > 1`,
      [finalIds]
    );
    const byLocal = new Map(games.rows.map((r) => [String(r.game_id), r]));

    const missingGames: string[] = [];
    const lifecycle: Array<Record<string, unknown>> = [];
    const teamMismatch: Array<Record<string, unknown>> = [];
    const scoreMismatch: Array<Record<string, unknown>> = [];
    const dateMismatch: Array<Record<string, unknown>> = [];
    for (const id of finalIds) {
      const g = official.get(id)!;
      const loc = byLocal.get(id);
      if (!loc) {
        missingGames.push(id);
        continue;
      }
      if (!isFinalStatus(String(loc.status))) {
        lifecycle.push({ gameId: id, localStatus: loc.status });
      }
      if (sid(g.home_team?.id) && sid(g.home_team?.id) !== sid(loc.home_team_id)) {
        teamMismatch.push({ gameId: id, side: 'home', bdl: sid(g.home_team?.id), local: loc.home_team_id });
      }
      if (sid(g.visitor_team?.id) && sid(g.visitor_team?.id) !== sid(loc.away_team_id)) {
        teamMismatch.push({ gameId: id, side: 'visitor', bdl: sid(g.visitor_team?.id), local: loc.away_team_id });
      }
      if (
        g.home_team_score != null &&
        g.visitor_team_score != null &&
        (Number(loc.home_score) !== Number(g.home_team_score) ||
          Number(loc.away_score) !== Number(g.visitor_team_score))
      ) {
        scoreMismatch.push({
          gameId: id,
          bdl: [g.home_team_score, g.visitor_team_score],
          local: [loc.home_score, loc.away_score],
        });
      }
      const bdlDate = dateOnly(g.date) ?? dateOnly(g.datetime);
      const localDate = etDateFromTs(loc.start_time);
      if (bdlDate && localDate && bdlDate !== localDate) {
        dateMismatch.push({ gameId: id, bdlDate, localEtDate: localDate, start_time: loc.start_time });
      }
    }

    const rawAgg = await client.query(
      `select game_id::text as game_id, count(*)::int as n,
              count(distinct player_id)::int as players,
              count(*) filter (where player_id is null)::int as null_player,
              count(*) filter (where team_id is null)::int as null_team,
              count(distinct team_id)::int as teams
       from raw.player_game_stats
       where game_id = any($1::int[])
       group by 1`,
      [finalIntIds]
    );
    const rawDups = await client.query(
      `select game_id::text as game_id, player_id::text as player_id, count(*)::int as n
       from raw.player_game_stats
       where game_id = any($1::int[])
       group by 1, 2 having count(*) > 1`,
      [finalIntIds]
    );
    const rawPts = await client.query(
      `select game_id::text as game_id, team_id::text as team_id, coalesce(sum(pts),0)::int as pts
       from raw.player_game_stats
       where game_id = any($1::int[])
       group by 1, 2`,
      [finalIntIds]
    );
    const rawBy = new Map(rawAgg.rows.map((r) => [String(r.game_id), r]));
    const rawDupSet = new Set(rawDups.rows.map((r) => String(r.game_id)));
    const rawPtsBy = new Map<string, Map<string, number>>();
    for (const r of rawPts.rows) {
      const gid = String(r.game_id);
      const m = rawPtsBy.get(gid) ?? new Map<string, number>();
      m.set(String(r.team_id), Number(r.pts));
      rawPtsBy.set(gid, m);
    }

    const rawMissing: string[] = [];
    const rawScoreFail: Array<Record<string, unknown>> = [];
    const rawIdentity: Array<Record<string, unknown>> = [];
    const rawForeign: Array<Record<string, unknown>> = [];
    const rawIncomplete: string[] = [];
    let rawComplete = 0;
    for (const id of finalIds) {
      const loc = byLocal.get(id);
      const agg = rawBy.get(id);
      const off = official.get(id)!;
      const home = sid(loc?.home_team_id);
      const away = sid(loc?.away_team_id);
      if (!agg || Number(agg.n) === 0) {
        rawMissing.push(id);
        continue;
      }
      const pts = rawPtsBy.get(id) ?? new Map();
      const homePts = pts.get(home) ?? 0;
      const awayPts = pts.get(away) ?? 0;
      const bothTeams = Boolean(home && away && pts.has(home) && pts.has(away));
      for (const tid of pts.keys()) {
        if (tid !== home && tid !== away) rawForeign.push({ gameId: id, teamId: tid });
      }
      if (Number(agg.null_player) > 0 || Number(agg.null_team) > 0) {
        rawIdentity.push({ gameId: id, nullPlayer: agg.null_player, nullTeam: agg.null_team });
      }
      const scoreOk =
        Number(off.home_team_score) === homePts && Number(off.visitor_team_score) === awayPts;
      if (!scoreOk) {
        rawScoreFail.push({
          gameId: id,
          summed: { home: homePts, away: awayPts },
          official: { home: off.home_team_score, away: off.visitor_team_score },
        });
      }
      const ok =
        bothTeams &&
        scoreOk &&
        Number(agg.null_player) === 0 &&
        Number(agg.null_team) === 0 &&
        !rawDupSet.has(id) &&
        rawForeign.every((x) => x.gameId !== id);
      if (ok) rawComplete += 1;
      else rawIncomplete.push(id);
    }

    const logAgg = await client.query(
      `select l.game_id, count(*)::int as n,
              count(distinct l.player_id)::int as players,
              count(*) filter (where l.player_id is null or l.team_id is null)::int as null_ids,
              count(*) filter (where l.team_id not in (g.home_team_id, g.away_team_id))::int as foreign_n,
              coalesce(sum(l.points) filter (where l.team_id = g.home_team_id),0)::int as home_pts,
              coalesce(sum(l.points) filter (where l.team_id = g.away_team_id),0)::int as away_pts
       from analytics.player_game_logs l
       join analytics.games g on g.game_id = l.game_id
       where l.season = '2025' and l.game_id = any($1::text[])
       group by l.game_id, g.home_team_id, g.away_team_id`,
      [finalIds]
    );
    const logDups = await client.query(
      `select game_id, player_id, count(*)::int as n
       from analytics.player_game_logs
       where season = '2025' and game_id = any($1::text[])
       group by 1, 2 having count(*) > 1`,
      [finalIds]
    );
    const rawOnly = await client.query(
      `select s.game_id::text as game_id, s.player_id::text as player_id
       from raw.player_game_stats s
       where s.game_id = any($1::int[])
         and not exists (
           select 1 from analytics.player_game_logs l
           where l.season = '2025' and l.game_id = s.game_id::text and l.player_id = s.player_id::text
         )`,
      [finalIntIds]
    );
    const logOnly = await client.query(
      `select l.game_id, l.player_id
       from analytics.player_game_logs l
       where l.season = '2025' and l.game_id = any($1::text[])
         and not exists (
           select 1 from raw.player_game_stats s
           where s.game_id::text = l.game_id and s.player_id::text = l.player_id
         )`,
      [finalIds]
    );
    const logBy = new Map(logAgg.rows.map((r) => [String(r.game_id), r]));
    const logDupSet = new Set(logDups.rows.map((r) => String(r.game_id)));
    const logMissing: string[] = [];
    const logScoreFail: Array<Record<string, unknown>> = [];
    const logForeign: Array<Record<string, unknown>> = [];
    const logIncomplete: string[] = [];
    let logComplete = 0;
    for (const id of finalIds) {
      const row = logBy.get(id);
      const off = official.get(id)!;
      if (!row) {
        logMissing.push(id);
        continue;
      }
      if (Number(row.foreign_n) > 0) logForeign.push({ gameId: id, foreign: row.foreign_n });
      const scoreOk =
        Number(row.home_pts) === Number(off.home_team_score) &&
        Number(row.away_pts) === Number(off.visitor_team_score);
      if (!scoreOk) {
        logScoreFail.push({
          gameId: id,
          summed: { home: row.home_pts, away: row.away_pts },
          official: { home: off.home_team_score, away: off.visitor_team_score },
        });
      }
      const ok =
        scoreOk && Number(row.null_ids) === 0 && Number(row.foreign_n) === 0 && !logDupSet.has(id);
      if (ok) logComplete += 1;
      else logIncomplete.push(id);
    }

    const tgs = await client.query(
      `select game_id, count(*)::int as n, array_agg(team_id order by team_id) as teams
       from analytics.team_game_stats
       where season = '2025' and game_id = any($1::text[])
       group by 1`,
      [finalIds]
    );
    const tgsDups = await client.query(
      `select team_id, game_id, count(*)::int as n
       from analytics.team_game_stats
       where season = '2025' and game_id = any($1::text[])
       group by 1, 2 having count(*) > 1`,
      [finalIds]
    );
    const tgsPts = await client.query(
      `select game_id, team_id, is_home, team_points, points_allowed, result
       from analytics.team_game_stats
       where season = '2025' and game_id = any($1::text[])`,
      [finalIds]
    );
    const tgsBy = new Map(tgs.rows.map((r) => [String(r.game_id), r]));
    const tgsZero: string[] = [];
    const tgsOne: string[] = [];
    const tgsOver: string[] = [];
    const tgsWrong: Array<Record<string, unknown>> = [];
    const tgsScoreFail: Array<Record<string, unknown>> = [];
    let tgsComplete = 0;
    for (const id of finalIds) {
      const loc = byLocal.get(id);
      const row = tgsBy.get(id);
      const n = Number(row?.n ?? 0);
      if (n === 0) tgsZero.push(id);
      else if (n === 1) tgsOne.push(id);
      else if (n > 2) tgsOver.push(id);
      const teams = ((row?.teams as string[] | null) ?? []).map(String);
      const home = sid(loc?.home_team_id);
      const away = sid(loc?.away_team_id);
      if (n === 2 && home && away && teams.includes(home) && teams.includes(away)) tgsComplete += 1;
      else if (n === 2) tgsWrong.push({ gameId: id, teams, expected: [home, away] });
    }
    const tgsRowsByGame = new Map<string, Array<Record<string, unknown>>>();
    for (const r of tgsPts.rows) {
      const gid = String(r.game_id);
      const list = tgsRowsByGame.get(gid) ?? [];
      list.push(r);
      tgsRowsByGame.set(gid, list);
    }
    for (const id of finalIds) {
      const off = official.get(id)!;
      const loc = byLocal.get(id);
      const rows = tgsRowsByGame.get(id) ?? [];
      if (rows.length !== 2) continue;
      const home = rows.find((r) => Boolean(r.is_home));
      const away = rows.find((r) => !r.is_home);
      if (
        home &&
        away &&
        (Number(home.team_points) !== Number(off.home_team_score) ||
          Number(away.team_points) !== Number(off.visitor_team_score) ||
          sid(home.team_id) !== sid(loc?.home_team_id) ||
          sid(away.team_id) !== sid(loc?.away_team_id))
      ) {
        tgsScoreFail.push({
          gameId: id,
          home: { teamId: home.team_id, pts: home.team_points, result: home.result },
          away: { teamId: away.team_id, pts: away.team_points, result: away.result },
          official: { home: off.home_team_score, away: off.visitor_team_score },
        });
      }
    }
    const tgsTotal = await client.query(
      `select count(*)::int as n
       from analytics.team_game_stats
       where season = '2025' and game_id = any($1::text[])`,
      [finalIds]
    );

    const boxGame = byLocal.get(BOX_ID) ?? null;
    const boxRawPts = rawPtsBy.get(BOX_ID) ?? new Map();
    const boxLogs = logBy.get(BOX_ID) ?? null;
    const boxTgs = tgsRowsByGame.get(BOX_ID) ?? [];
    const homeId = sid(boxGame?.home_team_id);
    const awayId = sid(boxGame?.away_team_id);
    const remnant88_99 =
      Number(boxGame?.home_score) === 88 ||
      Number(boxGame?.away_score) === 99 ||
      boxRawPts.get(homeId) === 88 ||
      boxRawPts.get(awayId) === 99 ||
      Number(boxLogs?.home_pts) === 88 ||
      Number(boxLogs?.away_pts) === 99 ||
      boxTgs.some((r) => Number(r.team_points) === 88 || Number(r.team_points) === 99);
    const repaired184 =
      Number(boxGame?.home_score) === 109 &&
      Number(boxGame?.away_score) === 118 &&
      Number(boxRawPts.get(homeId)) === 109 &&
      Number(boxRawPts.get(awayId)) === 118 &&
      Number(boxLogs?.home_pts) === 109 &&
      Number(boxLogs?.away_pts) === 118 &&
      boxTgs.length === 2 &&
      boxTgs.some((r) => Boolean(r.is_home) && Number(r.team_points) === 109) &&
      boxTgs.some((r) => !r.is_home && Number(r.team_points) === 118) &&
      !remnant88_99;

    const playoffFail: string[] = [];
    let playoffRepaired = 0;
    for (const id of PLAYOFF_TAIL) {
      const logFail = logScoreFail.some((x) => x.gameId === id);
      const rawFail = rawScoreFail.some((x) => x.gameId === id);
      const ok =
        Boolean(byLocal.get(id)) &&
        rawBy.has(id) &&
        Number(rawBy.get(id)?.n) > 0 &&
        logBy.has(id) &&
        Number(tgsBy.get(id)?.n) === 2 &&
        !logFail &&
        !rawFail;
      if (ok) playoffRepaired += 1;
      else playoffFail.push(id);
    }

    const avgs = await client.query(
      `select
         (select count(*)::int from analytics.player_season_averages where season = '2025') as player_2025,
         (select count(distinct player_id)::int from analytics.player_season_averages where season = '2025') as player_2025_distinct,
         (select count(*)::int from analytics.player_season_averages where season = '2025' and player_id is null) as player_2025_null,
         (select count(*)::int from analytics.team_season_averages where season = '2025') as team_2025,
         (select count(distinct team_id)::int from analytics.team_season_averages where season = '2025') as team_2025_distinct,
         (select count(*)::int from analytics.player_season_averages where season in ('2024','2023')) as player_hist,
         (select count(*)::int from analytics.team_season_averages where season in ('2024','2023')) as team_hist,
         (select count(*)::int from analytics.player_season_averages where season = '2026') as player_2026,
         (select count(*)::int from analytics.team_season_averages where season = '2026') as team_2026`
    );
    const stints = await client.query(
      `select season, source, count(*)::int as n
       from analytics.player_team_stints
       group by 1, 2
       order by 1, 2`
    );
    const stint380 = await client.query(
      `select stint_id, season, player_id, team_id, source,
              observed_from::text as observed_from, observed_to::text as observed_to
       from analytics.player_team_stints
       where season = '2025' and player_id = '38017706' and team_id = '21'`
    );
    const isolation = await client.query(
      `select
         (select count(*)::int from analytics.games where season = '2026') as games_2026,
         (select count(*)::int from analytics.player_game_logs where season = '2026') as logs_2026,
         (select count(*)::int from analytics.team_game_stats where season = '2026') as tgs_2026,
         (select count(*)::int from analytics.player_team_stints where season = '2026') as stints_2026,
         (select count(*)::int from analytics.player_game_logs where season = '2024') as logs_2024,
         (select count(*)::int from analytics.team_game_stats where season = '2024') as tgs_2024,
         (select count(*)::int from analytics.player_game_logs where season = '2023') as logs_2023,
         (select count(*)::int from analytics.team_game_stats where season = '2023') as tgs_2023,
         pg_database_size(current_database())::bigint as db_bytes`
    );
    const localOnlyLogs = await client.query(
      `select count(*)::int as n from analytics.player_game_logs where game_id = $1`,
      [LOCAL_ONLY]
    );
    const localOnlyRaw = await client.query(
      `select count(*)::int as n from raw.player_game_stats where game_id = $1`,
      [Number(LOCAL_ONLY)]
    );
    const localOnlyTgs = await client.query(
      `select count(*)::int as n from analytics.team_game_stats where game_id = $1`,
      [LOCAL_ONLY]
    );

    await client.query('commit');

    const a = avgs.rows[0]!;
    const iso = isolation.rows[0]!;
    const dbBytes = Number(iso.db_bytes);
    const prev = JSON.parse(readFileSync(STORAGE_PREV, 'utf8')) as {
      postgres: { bytes: number; mb: number };
    };
    const mb = Math.round((dbBytes / (1024 * 1024)) * 100) / 100;
    const storage = {
      bytes: dbBytes,
      mb,
      previousCheckpointBytes: prev.postgres.bytes,
      previousCheckpointMb: prev.postgres.mb,
      deltaBytes: dbBytes - prev.postgres.bytes,
      headroomTo400Mb: Math.round(((400 * 1024 * 1024 - dbBytes) / (1024 * 1024)) * 100) / 100,
      headroomTo450Mb: Math.round(((450 * 1024 * 1024 - dbBytes) / (1024 * 1024)) * 100) / 100,
    };

    const inferred2025 = Number(stints.rows.find((r) => r.season === '2025' && r.source === 'inferred_pgl')?.n ?? 0);
    const nbaStats2025 = Number(stints.rows.find((r) => r.season === '2025' && r.source === 'nba_stats')?.n ?? 0);
    const nbaStats2026 = Number(stints.rows.find((r) => r.season === '2026' && r.source === 'nba_stats')?.n ?? 0);

    const bucket = process.env.NBA_DATA_BUCKET?.trim();
    const prefix = rawEntityPrefix(process.env.NBA_RAW_PREFIX ?? 'raw', 2025, 'player_stats');
    let s3Result: Record<string, unknown> = {
      skipped: true,
      reason: 'NBA_DATA_BUCKET missing',
      prefix,
    };
    if (bucket) {
      const s3 = new S3Storage({ bucket });
      const expectedKeys = REPAIR_34.map((id) => `${prefix}/game_id=${id}.json`);
      const missingKeys: string[] = [];
      for (const key of expectedKeys) {
        if (!(await s3.objectExists(key))) missingKeys.push(key);
      }
      const m3 = `${prefix}/_repair_3game_manifest.json`;
      const m31 = `${prefix}/_repair_remaining31_manifest.json`;
      const seasonManifestKey = `${prefix}/_manifest.json`;
      const seasonManifest = await s3.getJson<Record<string, unknown>>(seasonManifestKey);
      const kind = seasonManifest
        ? String(seasonManifest.kind ?? seasonManifest.entity ?? seasonManifest.source ?? '')
        : null;
      const overwritten =
        typeof kind === 'string' &&
        (kind.includes('goat_stats_repair') ||
          kind.includes('repair_3game') ||
          kind.includes('remaining31'));
      s3Result = {
        skipped: false,
        prefix,
        expectedGameObjects: 34,
        present: 34 - missingKeys.length,
        missing: missingKeys,
        repair3gameManifest: await s3.objectExists(m3),
        repairRemaining31Manifest: await s3.objectExists(m31),
        seasonWideManifestPresent: seasonManifest != null,
        seasonWideManifestOverwrittenByRepair: overwritten,
        seasonWideManifestKind: kind,
        seasonWideManifestKeys: seasonManifest ? Object.keys(seasonManifest).slice(0, 20) : [],
      };
    }

    const inventoryOk = finals.length === 1322 && allCached.length === 1322 && !localOnlyInCache;
    const gamesOk =
      missingGames.length === 0 &&
      lifecycle.length === 0 &&
      scoreMismatch.length === 0 &&
      teamMismatch.length === 0 &&
      dateMismatch.length === 0 &&
      dupGames.rows.length === 0;
    const rawOk = rawComplete === 1322 && rawMissing.length === 0 && rawDups.rows.length === 0;
    const logsOk = logComplete === 1322 && logMissing.length === 0 && logDups.rows.length === 0;
    const tgsOk =
      tgsComplete === 1322 &&
      Number(tgsTotal.rows[0]?.n) === 2644 &&
      tgsZero.length === 0 &&
      tgsOne.length === 0 &&
      tgsOver.length === 0 &&
      tgsWrong.length === 0 &&
      tgsDups.rows.length === 0;
    const scoreOk = rawScoreFail.length === 0 && logScoreFail.length === 0 && tgsScoreFail.length === 0;
    const parityOk = rawOnly.rows.length === 0 && logOnly.rows.length === 0;
    const playoffOk = playoffRepaired === 33 && playoffFail.length === 0;
    const avgsOk =
      Number(a.player_2025) > 0 &&
      Number(a.player_2025) === Number(a.player_2025_distinct) &&
      Number(a.player_2025_null) === 0 &&
      Number(a.team_2025) === 30 &&
      Number(a.team_2025_distinct) === 30 &&
      Number(a.player_hist) === 0 &&
      Number(a.team_hist) === 0 &&
      Number(a.player_2026) === 0 &&
      Number(a.team_2026) === 0;
    const stintsOk =
      inferred2025 === 184 && nbaStats2025 === 514 && nbaStats2026 === 578 && Number(stint380.rows.length) === 1;
    const iso2026Ok =
      Number(iso.games_2026) === 1200 &&
      Number(iso.logs_2026) === 0 &&
      Number(iso.tgs_2026) === 0 &&
      Number(iso.stints_2026) === 578;
    const histEmptyOk =
      Number(iso.logs_2024) === 0 &&
      Number(iso.tgs_2024) === 0 &&
      Number(iso.logs_2023) === 0 &&
      Number(iso.tgs_2023) === 0;
    const s3Ok =
      s3Result.skipped !== true &&
      s3Result.present === 34 &&
      (s3Result.missing as unknown[]).length === 0 &&
      s3Result.repair3gameManifest === true &&
      s3Result.repairRemaining31Manifest === true &&
      s3Result.seasonWideManifestOverwrittenByRepair !== true;
    const storageOk = storage.mb < 400 && storage.headroomTo450Mb > 100;

    const gates: Record<string, Gate> = {
      'BDL Final inventory': color(inventoryOk),
      'Games metadata': color(gamesOk),
      'Raw player stats': color(rawOk),
      'Analytics player logs': color(logsOk),
      'Team stats': color(tgsOk),
      'Score reconciliation': color(scoreOk),
      'Raw ↔ analytics parity': color(parityOk),
      '33 playoff-tail repairs': color(playoffOk),
      '18447793 replacement': color(repaired184),
      'Season averages sanity': color(avgsOk),
      'Stints sanity': color(stintsOk),
      '2026 isolation': color(iso2026Ok),
      '2024/2023 still empty': color(histEmptyOk),
      'S3 repair archive': color(s3Ok),
      Storage: color(storageOk),
      'Production freeze': color(safety.frozen),
    };

    const localOnly = {
      gameId: LOCAL_ONLY,
      classification: 'LOCAL_ONLY_UNRESOLVED',
      inCachedBdlInventory: localOnlyInCache,
      localGame: byLocal.get(LOCAL_ONLY) ?? null,
      playerLogs: Number(localOnlyLogs.rows[0]?.n ?? 0),
      rawRows: Number(localOnlyRaw.rows[0]?.n ?? 0),
      teamStatRows: Number(localOnlyTgs.rows[0]?.n ?? 0),
      notDeleted: true,
      notRelabeled: true,
      excludedFromAuthoritative1322: !official.has(LOCAL_ONLY),
      bdlIdBasedQueriesExcludeNaturally:
        !official.has(LOCAL_ONLY) && !localOnlyInCache
          ? 'Yes. Completeness queries keyed by cached BDL season-2025 game IDs never include 21681993. Season-wide SELECT on analytics.games WHERE season=2025 still sees 1,323 rows (1,322 BDL + this local-only row).'
          : 'NO — unexpectedly present in cached BDL inventory',
    };

    const blockingRed = Object.entries(gates)
      .filter(([, v]) => v === 'RED')
      .map(([k]) => k);
    const yellows = Object.entries(gates)
      .filter(([, v]) => v === 'YELLOW')
      .map(([k]) => k);
    const overall = worst(Object.values(gates));
    const verdict =
      overall === 'GREEN'
        ? 'GREEN — 2025–26 certified complete; proceed to 2024 historical backfill'
        : overall === 'YELLOW'
          ? 'YELLOW — resolve listed issue before 2024'
          : 'RED — stop historical progression';

    const answers = {
      1: finals.length,
      2: rawComplete,
      3: logComplete,
      4: tgsComplete,
      5: new Set([...rawScoreFail, ...logScoreFail, ...tgsScoreFail].map((x) => String(x.gameId))).size,
      6: playoffOk ? '33 / 33 repaired' : `${playoffRepaired} / 33 repaired`,
      7: repaired184,
      8: parityOk,
      9: iso2026Ok && histEmptyOk ? 'No 2024/2023/2026 serving-data change detected (read-only counts match expected isolation).' : 'Isolation counts differ from expected freeze snapshot.',
      10: !localOnlyInCache && !official.has(LOCAL_ONLY) ? 'No' : 'Yes',
      11: storage.mb < 400 && storage.headroomTo450Mb > 100,
      12: overall === 'GREEN',
    };

    const report = {
      generatedAt,
      step: '2D',
      readOnly: true,
      bdlHttpRequests: 0,
      postgresWrites: false,
      safety,
      unsafe,
      inventory: {
        cachePath: CACHE_PATH,
        cacheGeneratedAt: cache.generatedAt ?? null,
        cachedSeasonGames: allCached.length,
        authoritativeFinals: finals.length,
        expected: 1322,
        localOnlyInCache,
      },
      games: {
        missingBdlToAnalytics: missingGames,
        lifecycleMismatches: lifecycle,
        scoreMismatches: scoreMismatch,
        teamMismatches: teamMismatch,
        dateMismatches: dateMismatch,
        duplicateGameIds: dupGames.rows,
        expected: { missing: 0, lifecycle: 0, score: 0, team: 0, date: 0 },
      },
      rawPlayerStats: {
        completeGames: rawComplete,
        missingGames: rawMissing,
        incompleteGames: rawIncomplete,
        scoreReconciliationFailures: rawScoreFail,
        identityIssues: rawIdentity,
        foreignTeamIds: rawForeign,
        duplicatePlayerGameKeys: rawDups.rows,
        expectedComplete: 1322,
      },
      analyticsPlayerLogs: {
        completeGames: logComplete,
        missingGames: logMissing,
        incompleteGames: logIncomplete,
        scoreReconciliationFailures: logScoreFail,
        foreignTeamIds: logForeign,
        duplicatePlayerGameKeys: logDups.rows,
        rawOnlyKeys: rawOnly.rows,
        analyticsOnlyKeys: logOnly.rows,
        expectedComplete: 1322,
        expectedRawOnly: 0,
        expectedAnalyticsOnly: 0,
      },
      teamGameStats: {
        completeGames: tgsComplete,
        totalRowsForAuthoritativeFinals: Number(tgsTotal.rows[0]?.n ?? 0),
        expectedRows: 2644,
        zeroRowGames: tgsZero,
        oneRowGames: tgsOne,
        overTwoRowGames: tgsOver,
        wrongTeamIds: tgsWrong,
        duplicateTeamGameKeys: tgsDups.rows,
        scoreMismatches: tgsScoreFail,
      },
      box18447793: {
        expected: { home: 109, away: 118, matchup: 'LAC vs SAC' },
        game: boxGame,
        rawPtsByTeam: Object.fromEntries(boxRawPts),
        analyticsPts: boxLogs
          ? { home: boxLogs.home_pts, away: boxLogs.away_pts, rows: boxLogs.n }
          : null,
        teamStats: boxTgs,
        remnant88_99,
        fullyCorrected: repaired184,
      },
      playoffTail: {
        expected: 33,
        repaired: playoffRepaired,
        result: `${playoffRepaired} / 33 repaired`,
        failed: playoffFail,
      },
      seasonAverages: a,
      stints: {
        bySeasonSource: stints.rows,
        inferred_pgl_2025: inferred2025,
        nba_stats_2025: nbaStats2025,
        nba_stats_2026: nbaStats2026,
        expected: { inferred_pgl_2025: 184, nba_stats_2025: 514, nba_stats_2026: 578 },
        player38017706_team21: stint380.rows,
      },
      isolation: iso,
      localOnlyUnresolved: localOnly,
      storage,
      s3: s3Result,
      gates,
      blockingRed,
      yellows,
      answers,
      verdict,
    };

    mkdirSync('reports/trial', { recursive: true });
    writeFileSync(OUT_JSON, JSON.stringify(report, null, 2) + '\n');

    const md = [
      '# 2025–26 final completeness certification',
      '',
      `Generated: ${generatedAt}`,
      '',
      'Read-only. Cached BDL inventory only. No provider HTTP. No Postgres writes.',
      '',
      '## Safety',
      '',
      `- DATA_MODE=${safety.dataMode}`,
      `- OFFSEASON_MODE=${safety.offseasonMode ? '1' : '0'}`,
      `- CRON_DRY_RUN=${safety.cronDryRun ? '1' : '0'}`,
      `- season pin=${safety.currentAnalyticsSeason}`,
      `- BDL lock active=${safety.bdlLockActive}`,
      `- BDL HTTP requests=${safety.bdlHttpRequests}`,
      '',
      '## Inventory',
      '',
      `- Cached season games: ${allCached.length}`,
      `- Authoritative Finals: ${finals.length}`,
      `- 21681993 in cache: ${localOnlyInCache}`,
      '',
      '## Certification matrix',
      '',
      '| Gate | Result |',
      '| --- | --- |',
      ...Object.entries(gates).map(([k, v]) => `| ${k} | ${v} |`),
      '',
      '## Explicit answers',
      '',
      `1. Authoritative 2025–26 Finals in cached BDL inventory: **${answers[1]}**`,
      `2. Complete raw stats: **${answers[2]}**`,
      `3. Complete analytics player logs: **${answers[3]}**`,
      `4. Exactly two valid team-stat rows: **${answers[4]}**`,
      `5. Score-reconciliation failures: **${answers[5]}**`,
      `6. 33 playoff-tail games: **${answers[6]}**`,
      `7. 18447793 fully corrected: **${answers[7]}**`,
      `8. Raw/analytics key parity: **${answers[8]}**`,
      `9. 2024/2023/2026 serving data: ${answers[9]}`,
      `10. 21681993 contaminates 1,322-game set: **${answers[10]}** (classification LOCAL_ONLY_UNRESOLVED; excluded from BDL ID set)`,
      `11. Postgres below historical-materialization thresholds: **${answers[11]}** (${storage.mb} MB; headroom to 400=${storage.headroomTo400Mb}; to 450=${storage.headroomTo450Mb})`,
      `12. 2025–26 repair phase fully complete: **${answers[12]}**`,
      '',
      '## Local-only game',
      '',
      `\`${LOCAL_ONLY}\` = **LOCAL_ONLY_UNRESOLVED**. Not in cached BDL inventory. Player logs=${localOnly.playerLogs}. Not deleted or relabeled.`,
      '',
      '## Verdict',
      '',
      `**${verdict}**`,
      '',
    ].join('\n');
    writeFileSync(OUT_MD, md);

    console.log(
      JSON.stringify(
        {
          generatedAt,
          inventory: report.inventory,
          gates,
          answers,
          verdict,
          outJson: OUT_JSON,
          outMd: OUT_MD,
          blockingRed,
          yellows,
        },
        null,
        2
      )
    );

    if (overall === 'RED') process.exitCode = 2;
    else if (overall === 'YELLOW') process.exitCode = 1;
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

main()
  .catch((err) => {
    console.error('[fatal]', err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });
