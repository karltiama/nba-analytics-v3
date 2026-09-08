/**
 * Read-only Pre-GOAT 2025–26 completeness audit.
 *
 * Fetches the full BDL /v1/games inventory for season=2025 (per_page=100).
 * Does NOT call /v1/stats. Does not write Postgres or S3.
 *
 * Usage:
 *   npx tsx scripts/ops/pre-goat-pipeline-audit.ts
 *   npx tsx scripts/ops/pre-goat-pipeline-audit.ts --skip-bdl   # local-only (no provider fetch)
 */

import 'dotenv/config';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { BdlArchiveClient, readBdlApiKey } from '@/lib/balldontlie/archive-client';
import pool from '@/lib/db';
import type { PoolClient } from 'pg';

const SEASON = 2025;
const OUT_DIR = 'reports/trial';

type BdlGame = {
  id?: number | string | null;
  date?: string | null;
  datetime?: string | null;
  season?: number | string | null;
  status?: string | null;
  status_state?: string | null;
  postponed?: boolean | null;
  postseason?: boolean | null;
  home_team_score?: number | null;
  visitor_team_score?: number | null;
  home_team?: { id?: number | string | null; abbreviation?: string | null; full_name?: string | null } | null;
  visitor_team?: { id?: number | string | null; abbreviation?: string | null; full_name?: string | null } | null;
  [k: string]: unknown;
};

type LocalGame = {
  game_id: string;
  season: string | null;
  status: string | null;
  start_time: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  home_score: number | null;
  away_score: number | null;
  home_abbr: string | null;
  away_abbr: string | null;
};

type Issue =
  | 'MISSING_GAME'
  | 'STATUS_MISMATCH'
  | 'SCORE_MISMATCH'
  | 'MISSING_RAW_PLAYER_STATS'
  | 'MISSING_ANALYTICS_PLAYER_LOGS'
  | 'PARTIAL_PLAYER_LOGS'
  | 'MISSING_TEAM_STATS'
  | 'PARTIAL_TEAM_STATS'
  | 'DUPLICATE_PLAYER_STATS'
  | 'PLAYER_TEAM_MISMATCH'
  | 'SCORE_RECONCILIATION_SUSPECT'
  | 'OTHER';

function sid(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
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

function classifyLifecycle(g: BdlGame): string {
  const state = String(g.status_state ?? '').toLowerCase();
  const status = String(g.status ?? '').toLowerCase();
  if (g.postponed === true || state.includes('postpon') || status.includes('postpon')) return 'postponed';
  if (state.includes('cancel') || status.includes('cancel')) return 'canceled';
  if (state === 'final' || status === 'final') return 'final';
  if (state === 'scheduled' || status === 'scheduled' || status.includes('et') || /^\d{4}-\d{2}-\d{2}t/.test(status)) {
    return 'scheduled';
  }
  if (status.includes('qtr') || status.includes('half') || state === 'inplay' || state === 'in_progress') {
    return 'in_progress';
  }
  return 'other';
}

function isLocalFinal(status: string | null): boolean {
  return (status ?? '').trim().toLowerCase() === 'final';
}

function parseArg(argv: string[], name: string): string | null {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

function loadCachedGames(path: string): BdlGame[] {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { games?: BdlGame[] } | BdlGame[];
  return Array.isArray(raw) ? raw : raw.games ?? [];
}

async function fetchBdlGames2025(): Promise<BdlGame[]> {
  const client = new BdlArchiveClient({
    apiKey: readBdlApiKey(),
    requestDelayMs: Number.parseInt(process.env.BALLDONTLIE_REQUEST_DELAY_MS || '200', 10),
    maxRetries: 3,
  });
  const games: BdlGame[] = [];
  let pages = 0;
  for await (const page of client.paginate({
    path: '/games',
    params: { 'seasons[]': String(SEASON) },
    paginationStyle: 'cursor',
    perPage: 100,
  })) {
    pages += 1;
    const rows = Array.isArray(page.body.data) ? page.body.data : [];
    for (const row of rows) games.push(row as BdlGame);
    console.error(`[bdl] /games season=2025 page=${pages} +${rows.length} (total ${games.length}) hasMore=${page.hasMore}`);
  }
  return games;
}

async function loadLocal(db: PoolClient) {
  const games = await db.query<LocalGame>(
    `SELECT g.game_id, g.season, g.status, g.start_time::text AS start_time,
            g.home_team_id, g.away_team_id, g.home_score, g.away_score,
            ht.abbreviation AS home_abbr, at.abbreviation AS away_abbr
     FROM analytics.games g
     LEFT JOIN analytics.teams ht ON ht.team_id = g.home_team_id
     LEFT JOIN analytics.teams at ON at.team_id = g.away_team_id`
  );
  const logs = await db.query<{
    game_id: string;
    player_id: string;
    team_id: string;
    minutes: string | null;
    points: number | null;
    rebounds: number | null;
    assists: number | null;
  }>(
    `SELECT game_id, player_id, team_id, minutes, points, rebounds, assists
     FROM analytics.player_game_logs
     WHERE season = $1 OR game_id IN (SELECT game_id FROM analytics.games WHERE season = $1)`,
    [String(SEASON)]
  );
  const teamStats = await db.query<{ game_id: string; team_id: string }>(
    `SELECT game_id, team_id FROM analytics.team_game_stats WHERE season = $1`,
    [String(SEASON)]
  );
  const rawStats = await db.query<{ game_id: string; player_id: string; team_id: string | null }>(
    `SELECT s.game_id::text AS game_id, s.player_id::text AS player_id, s.team_id::text AS team_id
     FROM raw.player_game_stats s
     LEFT JOIN raw.games g ON g.id = s.game_id
     WHERE g.season = $1 OR g.season IS NULL`,
    [SEASON]
  );
  const rawSeasonCounts = await db.query<{ season: string | null; n: string }>(
    `SELECT g.season::text AS season, count(*)::text AS n
     FROM raw.player_game_stats s
     LEFT JOIN raw.games g ON g.id = s.game_id
     GROUP BY g.season`
  );
  const avgs = await db.query<{ kind: string; season: string; n: string }>(
    `SELECT 'player' AS kind, season, count(*)::text AS n FROM analytics.player_season_averages GROUP BY season
     UNION ALL
     SELECT 'team', season, count(*)::text FROM analytics.team_season_averages GROUP BY season
     UNION ALL
     SELECT 'stints', season, count(*)::text FROM analytics.player_team_stints GROUP BY season`
  );
  const dbSize = await db.query<{ bytes: string; pretty: string }>(
    `SELECT pg_database_size(current_database())::text AS bytes,
            pg_size_pretty(pg_database_size(current_database())) AS pretty`
  );
  return {
    games: games.rows,
    logs: logs.rows,
    teamStats: teamStats.rows,
    rawStats: rawStats.rows,
    rawSeasonCounts: rawSeasonCounts.rows,
    avgs: avgs.rows,
    dbSize: dbSize.rows[0],
  };
}

function plannedRepair(issues: Issue[], hasRaw: boolean, hasLogs: boolean): string[] {
  const steps: string[] = [];
  const needsStats = issues.includes('MISSING_RAW_PLAYER_STATS') || issues.includes('MISSING_ANALYTICS_PLAYER_LOGS');
  if (needsStats && !hasRaw) {
    steps.push('fetch_player_stats', 'archive_raw');
  }
  if (needsStats && hasRaw && !hasLogs) {
    steps.push('materialize_player_logs_from_raw');
  } else if (needsStats && !hasRaw) {
    steps.push('materialize_player_logs');
  }
  if (issues.includes('SCORE_RECONCILIATION_SUSPECT')) {
    steps.push('fetch_player_stats', 'archive_raw', 'rematerialize_player_logs');
  }
  if (issues.includes('PARTIAL_PLAYER_LOGS') || issues.includes('PLAYER_TEAM_MISMATCH') || issues.includes('DUPLICATE_PLAYER_STATS')) {
    if (!steps.includes('fetch_player_stats')) steps.push('fetch_player_stats', 'archive_raw');
    steps.push('rematerialize_player_logs');
  }
  if (
    issues.includes('MISSING_TEAM_STATS') ||
    issues.includes('PARTIAL_TEAM_STATS') ||
    steps.includes('materialize_player_logs') ||
    steps.includes('materialize_player_logs_from_raw') ||
    steps.includes('rematerialize_player_logs')
  ) {
    steps.push('materialize_team_stats');
  }
  if (issues.includes('MISSING_GAME') || issues.includes('STATUS_MISMATCH') || issues.includes('SCORE_MISMATCH')) {
    steps.unshift('upsert_analytics_game_from_bdl');
  }
  if (steps.length > 0) steps.push('recompute_affected_averages');
  return [...new Set(steps)];
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const skipBdl = argv.includes('--skip-bdl');
  const cachePath = parseArg(argv, 'from-cache');
  const generatedAt = new Date().toISOString();

  let bdlGames: BdlGame[] = [];
  if (cachePath) {
    bdlGames = loadCachedGames(cachePath);
    console.error(`[audit] loaded ${bdlGames.length} cached BDL games from ${cachePath}`);
  } else if (!skipBdl) {
    bdlGames = await fetchBdlGames2025();
  } else {
    console.error('[audit] --skip-bdl: provider inventory omitted');
  }

  const db = await pool.connect();
  try {
    await db.query(`SET statement_timeout = '120s'`);
    const local = await loadLocal(db);

    const localById = new Map(local.games.map((g) => [g.game_id, g]));
    const local2025 = local.games.filter((g) => String(g.season) === String(SEASON));
    const logsByGame = new Map<string, typeof local.logs>();
    for (const row of local.logs) {
      const list = logsByGame.get(row.game_id) ?? [];
      list.push(row);
      logsByGame.set(row.game_id, list);
    }
    const rawByGame = new Map<string, typeof local.rawStats>();
    const rawKeys = new Set<string>();
    for (const row of local.rawStats) {
      const list = rawByGame.get(row.game_id) ?? [];
      list.push(row);
      rawByGame.set(row.game_id, list);
      rawKeys.add(`${row.game_id}|${row.player_id}`);
    }
    const logKeys = new Set(local.logs.map((r) => `${r.game_id}|${r.player_id}`));
    const teamByGame = new Map<string, string[]>();
    for (const row of local.teamStats) {
      const list = teamByGame.get(row.game_id) ?? [];
      list.push(row.team_id);
      teamByGame.set(row.game_id, list);
    }

    const providerTotals: Record<string, number> = {};
    const bdlById = new Map<string, BdlGame>();
    for (const g of bdlGames) {
      const id = sid(g.id);
      if (!id) continue;
      bdlById.set(id, g);
      const life = classifyLifecycle(g);
      providerTotals[life] = (providerTotals[life] ?? 0) + 1;
    }
    providerTotals.all = bdlGames.length;

    const missingBdlToLocal: string[] = [];
    const unexpectedLocal: Array<{ game_id: string; status: string | null }> = [];
    const lifecycleMismatches: Array<Record<string, unknown>> = [];
    const teamMismatches: Array<Record<string, unknown>> = [];
    const dateMismatches: Array<Record<string, unknown>> = [];
    const scoreMismatches: Array<Record<string, unknown>> = [];

    for (const [id, g] of bdlById) {
      const localG = localById.get(id);
      if (!localG) {
        missingBdlToLocal.push(id);
        continue;
      }
      const bdlLife = classifyLifecycle(g);
      const localFinal = isLocalFinal(localG.status);
      if (bdlLife === 'final' && !localFinal) {
        lifecycleMismatches.push({
          gameId: id,
          bdlLifecycle: bdlLife,
          bdlStatus: g.status,
          bdlStatusState: g.status_state ?? null,
          localStatus: localG.status,
        });
      }
      if (bdlLife === 'postponed' && localFinal) {
        lifecycleMismatches.push({
          gameId: id,
          bdlLifecycle: bdlLife,
          localStatus: localG.status,
        });
      }
      const bdlHome = sid(g.home_team?.id);
      const bdlAway = sid(g.visitor_team?.id);
      if (bdlHome && localG.home_team_id && bdlHome !== localG.home_team_id) {
        teamMismatches.push({ gameId: id, side: 'home', bdl: bdlHome, local: localG.home_team_id });
      }
      if (bdlAway && localG.away_team_id && bdlAway !== localG.away_team_id) {
        teamMismatches.push({ gameId: id, side: 'visitor', bdl: bdlAway, local: localG.away_team_id });
      }
      const bdlDate = dateOnly(g.date) ?? dateOnly(g.datetime);
      const localDate = etDateFromTs(localG.start_time);
      if (bdlDate && localDate && bdlDate !== localDate) {
        dateMismatches.push({ gameId: id, bdlDate, localEtDate: localDate, start_time: localG.start_time, kind: 'calendar' });
      }
      const bdlHs = g.home_team_score;
      const bdlAs = g.visitor_team_score;
      if (
        bdlLife === 'final' &&
        bdlHs != null &&
        bdlAs != null &&
        localG.home_score != null &&
        localG.away_score != null &&
        (Number(bdlHs) !== Number(localG.home_score) || Number(bdlAs) !== Number(localG.away_score))
      ) {
        scoreMismatches.push({
          gameId: id,
          bdl: [bdlHs, bdlAs],
          local: [localG.home_score, localG.away_score],
        });
      }
    }

    for (const g of local2025) {
      if (bdlById.size > 0 && !bdlById.has(g.game_id)) {
        unexpectedLocal.push({ game_id: g.game_id, status: g.status });
      }
    }

    const bdlFinalIds = [...bdlById.entries()]
      .filter(([, g]) => classifyLifecycle(g) === 'final')
      .map(([id]) => id);

    const completeLogs: string[] = [];
    const missingLogs: string[] = [];
    const suspectLogs: Array<Record<string, unknown>> = [];
    const teamComplete: string[] = [];
    const teamMissing: string[] = [];
    const teamPartial: string[] = [];
    const teamInvalid: Array<Record<string, unknown>> = [];
    const matrix: Array<Record<string, unknown>> = [];
    const repairGames: Array<Record<string, unknown>> = [];

    const logCounts = bdlFinalIds
      .map((id) => logsByGame.get(id)?.length ?? 0)
      .filter((n) => n > 0)
      .sort((a, b) => a - b);
    const medianLogs = logCounts.length ? logCounts[Math.floor(logCounts.length / 2)]! : 0;
    const p05 = logCounts.length ? logCounts[Math.floor(logCounts.length * 0.05)]! : 0;

    for (const id of bdlFinalIds) {
      const g = bdlById.get(id)!;
      const localG = localById.get(id);
      const logs = logsByGame.get(id) ?? [];
      const raw = rawByGame.get(id) ?? [];
      const trows = teamByGame.get(id) ?? [];
      const issues: Issue[] = [];
      const homeId = localG?.home_team_id ?? sid(g.home_team?.id);
      const awayId = localG?.away_team_id ?? sid(g.visitor_team?.id);
      const matchup = `${g.visitor_team?.abbreviation ?? awayId ?? '?'} @ ${g.home_team?.abbreviation ?? homeId ?? '?'}`;

      if (!localG) issues.push('MISSING_GAME');
      if (localG && !isLocalFinal(localG.status)) issues.push('STATUS_MISMATCH');
      if (
        localG &&
        g.home_team_score != null &&
        g.visitor_team_score != null &&
        localG.home_score != null &&
        localG.away_score != null &&
        (Number(g.home_team_score) !== Number(localG.home_score) ||
          Number(g.visitor_team_score) !== Number(localG.away_score))
      ) {
        issues.push('SCORE_MISMATCH');
      }

      if (logs.length === 0) {
        missingLogs.push(id);
        issues.push('MISSING_ANALYTICS_PLAYER_LOGS');
      } else {
        completeLogs.push(id);
        const byPlayer = new Map<string, number>();
        const teamIds = new Set<string>();
        let homePts = 0;
        let awayPts = 0;
        let foreignTeam = false;
        let nullCore = 0;
        for (const row of logs) {
          byPlayer.set(row.player_id, (byPlayer.get(row.player_id) ?? 0) + 1);
          teamIds.add(row.team_id);
          if (homeId && row.team_id === homeId) homePts += row.points ?? 0;
          else if (awayId && row.team_id === awayId) awayPts += row.points ?? 0;
          else foreignTeam = true;
          if (!row.player_id || !row.team_id || !row.game_id) nullCore += 1;
        }
        const dups = [...byPlayer.values()].filter((n) => n > 1).length;
        if (dups > 0) issues.push('DUPLICATE_PLAYER_STATS');
        if (foreignTeam) issues.push('PLAYER_TEAM_MISMATCH');
        const homeN = logs.filter((r) => r.team_id === homeId).length;
        const awayN = logs.filter((r) => r.team_id === awayId).length;
        if (homeN === 0 || awayN === 0) issues.push('PARTIAL_PLAYER_LOGS');
        else if (homeN < 5 || awayN < 5 || logs.length < 18) issues.push('PARTIAL_PLAYER_LOGS');
        const bdlHs = g.home_team_score;
        const bdlAs = g.visitor_team_score;
        if (bdlHs != null && bdlAs != null && (homePts !== Number(bdlHs) || awayPts !== Number(bdlAs))) {
          issues.push('SCORE_RECONCILIATION_SUSPECT');
          suspectLogs.push({
            gameId: id,
            matchup,
            logRows: logs.length,
            homeN,
            awayN,
            summed: [homePts, awayPts],
            official: [bdlHs, bdlAs],
            delta: [homePts - Number(bdlHs), awayPts - Number(bdlAs)],
            dups,
            foreignTeam,
            nullCore,
            medianLogs,
          });
        } else if (issues.includes('PARTIAL_PLAYER_LOGS') || issues.includes('PLAYER_TEAM_MISMATCH') || dups || nullCore) {
          suspectLogs.push({
            gameId: id,
            matchup,
            logRows: logs.length,
            homeN,
            awayN,
            dups,
            foreignTeam,
            nullCore,
            medianLogs,
          });
        }
      }

      if (raw.length === 0) issues.push('MISSING_RAW_PLAYER_STATS');

      const expectedTeams = [homeId, awayId].filter(Boolean) as string[];
      const uniqTeams = [...new Set(trows)];
      if (trows.length === 0) {
        teamMissing.push(id);
        issues.push('MISSING_TEAM_STATS');
      } else if (uniqTeams.length === 1 || trows.length === 1) {
        teamPartial.push(id);
        issues.push('PARTIAL_TEAM_STATS');
      } else if (
        trows.length !== 2 ||
        uniqTeams.length !== 2 ||
        (expectedTeams.length === 2 && expectedTeams.some((t) => !uniqTeams.includes(t)))
      ) {
        teamInvalid.push({ gameId: id, rows: trows, expected: expectedTeams });
        issues.push('PARTIAL_TEAM_STATS');
      } else {
        teamComplete.push(id);
      }

      const uniqueIssues = [...new Set(issues)];
      if (uniqueIssues.length > 0) {
        matrix.push({
          game_id: id,
          date: dateOnly(g.date) ?? dateOnly(g.datetime),
          matchup,
          bdl_final: true,
          analytics_games: Boolean(localG),
          raw_stats: raw.length,
          player_logs: logs.length,
          team_stats: trows.length,
          problem: uniqueIssues.join(','),
        });
        const requiresGoat =
          (uniqueIssues.includes('MISSING_RAW_PLAYER_STATS') && raw.length === 0) ||
          uniqueIssues.includes('SCORE_RECONCILIATION_SUSPECT') ||
          uniqueIssues.includes('PARTIAL_PLAYER_LOGS');
        repairGames.push({
          gameId: Number(id),
          gameIdText: id,
          date: dateOnly(g.date) ?? dateOnly(g.datetime),
          datetime: g.datetime ?? null,
          homeTeamId: Number(sid(g.home_team?.id) ?? 0),
          visitorTeamId: Number(sid(g.visitor_team?.id) ?? 0),
          matchup,
          postseason: g.postseason ?? null,
          issues: uniqueIssues,
          requiresGoat,
          hasRawStats: raw.length > 0,
          hasPlayerLogs: logs.length > 0,
          teamStatRows: trows.length,
          plannedRepair: plannedRepair(uniqueIssues, raw.length > 0, logs.length > 0),
        });
      }
    }

    const rawOnly = [...rawKeys].filter((k) => !logKeys.has(k));
    const analyticsOnly = [...logKeys].filter((k) => !rawKeys.has(k));
    const bothMissingFinal = bdlFinalIds.filter(
      (id) => (rawByGame.get(id)?.length ?? 0) === 0 && (logsByGame.get(id)?.length ?? 0) === 0
    );
    const transformDefect = bdlFinalIds.filter(
      (id) => (rawByGame.get(id)?.length ?? 0) > 0 && (logsByGame.get(id)?.length ?? 0) === 0
    );

    const seasonRowCounts = {
      games: {} as Record<string, number>,
    };
    for (const g of local.games) {
      const s = String(g.season ?? '(null)');
      seasonRowCounts.games[s] = (seasonRowCounts.games[s] ?? 0) + 1;
    }

    const completeness = {
      generatedAt,
      season: SEASON,
      skipBdl,
      postgres: {
        bytes: Number(local.dbSize?.bytes ?? 0),
        pretty: local.dbSize?.pretty ?? null,
      },
      providerTotals,
      localInventory: {
        analyticsGamesAll: local.games.length,
        analyticsGames2025: local2025.length,
        analyticsFinal2025: local2025.filter((g) => isLocalFinal(g.status)).length,
        playerGameLogs: local.logs.length,
        distinctLogGames: logsByGame.size,
        teamGameStatsRows: local.teamStats.length,
        distinctTeamStatGames: teamByGame.size,
        rawPlayerGameStats: local.rawStats.length,
        rawBySeason: local.rawSeasonCounts,
        averages: local.avgs,
        gamesBySeason: seasonRowCounts.games,
      },
      diffs: {
        bdlMissingInAnalytics: missingBdlToLocal,
        analyticsUnexpectedVsBdl: unexpectedLocal,
        lifecycleMismatches,
        teamMismatches,
        dateMismatches,
        scoreMismatches,
      },
      finalGames: {
        providerFinal: bdlFinalIds.length,
        completePlayerLogs: completeLogs.length,
        missingPlayerLogs: missingLogs,
        suspectPlayerLogs: suspectLogs,
        teamStatsComplete: teamComplete.length,
        teamStatsMissing: teamMissing,
        teamStatsPartial: teamPartial,
        teamStatsInvalid: teamInvalid,
      },
      rawVsAnalytics: {
        rawRows: local.rawStats.length,
        analyticsLogRows: local.logs.length,
        distinctRawGames: rawByGame.size,
        distinctLogGames: logsByGame.size,
        rawOnlyKeys: rawOnly.length,
        analyticsOnlyKeys: analyticsOnly.length,
        rawOnlySample: rawOnly.slice(0, 20),
        analyticsOnlySample: analyticsOnly.slice(0, 20),
        transformDefectGameIds: transformDefect,
        providerIngestGapGameIds: bothMissingFinal,
      },
      matrix,
    };

    const manifest = {
      season: SEASON,
      generatedAt,
      providerFinalGames: bdlFinalIds.length,
      localCompleteGames: repairGames.length === 0 ? bdlFinalIds.length : bdlFinalIds.length - new Set(repairGames.map((g) => String(g.gameIdText))).size,
      repairGameCount: repairGames.length,
      requiresGoatCount: repairGames.filter((g) => g.requiresGoat).length,
      repairGames,
    };

    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(`${OUT_DIR}/pre-goat-completeness.json`, JSON.stringify(completeness, null, 2) + '\n');
    writeFileSync(`${OUT_DIR}/2025-repair-manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
    writeFileSync(`${OUT_DIR}/bdl-games-2025.json`, JSON.stringify({ generatedAt, count: bdlGames.length, games: bdlGames }, null, 2) + '\n');
    console.log(
      JSON.stringify(
        {
          generatedAt,
          providerGames: bdlGames.length,
          providerFinal: bdlFinalIds.length,
          missingLogs: missingLogs.length,
          missingTeamStats: teamMissing.length,
          repairGames: repairGames.length,
          requiresGoat: repairGames.filter((g) => g.requiresGoat).length,
          files: [
            `${OUT_DIR}/pre-goat-completeness.json`,
            `${OUT_DIR}/2025-repair-manifest.json`,
            `${OUT_DIR}/bdl-games-2025.json`,
          ],
        },
        null,
        2
      )
    );
  } finally {
    db.release();
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });
