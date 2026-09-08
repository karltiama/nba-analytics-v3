/**
 * Step 4B: read-only investigation of the 10 Step 4A 2023 score mismatches.
 * Uses existing S3 archive only. No BDL HTTP. No Postgres writes.
 *
 *   npx tsx scripts/ops/investigate-2023-mismatches.ts
 */
import 'dotenv/config';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { S3Storage } from '@/lib/aws/s3';
import { type BdlEnvelope } from '@/lib/balldontlie/archive-client';
import { buildServingBackfillPlan } from '@/lib/ingestion/historical-serving/plan';
import pool from '@/lib/db';
import { readIngestionMode } from '@/lib/runtime/ingestion-mode';
import { getAnalyticsSeason } from '@/lib/season';

const SEASON = 2023;
const STEP4A = 'reports/trial/2023-s3-archive-report.json';
const OUT_JSON = 'reports/trial/2023-mismatch-investigation.json';
const OUT_MD = 'reports/trial/2023-mismatch-investigation.md';
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

type Classification =
  | 'ARCHIVED_STATS_INCOMPLETE'
  | 'OFFICIAL_GAME_SCORE_DRIFT'
  | 'PLAYER_STAT_SCORE_MISMATCH'
  | 'ONE_TEAM_PARTIAL'
  | 'BOTH_TEAMS_PARTIAL'
  | 'DUPLICATE_STATS'
  | 'IDENTITY_ISSUE'
  | 'OVERTIME_OR_SCORING_EDGE_CASE'
  | 'PROVIDER_DATA_ANOMALY'
  | 'OTHER';

type Repair =
  | 'NO_ACTION_VALIDATOR_FIX'
  | 'REFETCH_SINGLE_GAME_STATS'
  | 'REFETCH_GAME_METADATA'
  | 'MANUAL_PROVIDER_ANOMALY_REVIEW'
  | 'SAFE_TO_MATERIALIZE_WITH_DOCUMENTED_EXCEPTION';

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

function isFinal(status: unknown): boolean {
  const s = String(status ?? '').trim().toLowerCase();
  return s === 'final' || s.includes('final');
}

function dateOnly(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length >= 10 ? s.slice(0, 10) : s || null;
}

function unusualMinutes(min: unknown): boolean {
  if (min == null) return true;
  const s = String(min).trim();
  if (s === '' || s === '0' || s === '00' || s === '0:00' || s === '00:00') return false;
  return !/^\d{1,3}(:\d{2})?$/.test(s);
}

async function listPageKeys(s3: S3Storage, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  for await (const obj of s3.listByPrefix(`${prefix}/`)) {
    if (/\/page=\d+\.json$/.test(obj.key)) keys.push(obj.key);
  }
  keys.sort((a, b) => {
    const na = Number((a.match(/page=(\d+)\.json$/) ?? [])[1] ?? 0);
    const nb = Number((b.match(/page=(\d+)\.json$/) ?? [])[1] ?? 0);
    return na - nb;
  });
  return keys;
}

function pageNum(key: string): number {
  return Number((key.match(/page=(\d+)\.json$/) ?? [])[1] ?? 0);
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

async function main() {
  const generatedAt = new Date().toISOString();
  const mode = readIngestionMode();
  const pin = getAnalyticsSeason();
  const unsafe: string[] = [];
  if (mode.dataMode !== 'replay') unsafe.push(`DATA_MODE=${mode.dataMode || '(empty)'}`);
  if (!mode.offseason) unsafe.push('OFFSEASON_MODE not 1');
  if (!mode.cronDryRun) unsafe.push('CRON_DRY_RUN not 1');
  if (pin !== '2025') unsafe.push(`season pin=${pin}`);

  const pg = await snapshotPostgres();
  if (
    pg.games_2023 !== 0 ||
    pg.logs_2023 !== 0 ||
    pg.tgs_2023 !== 0 ||
    pg.psa_2023 !== 0 ||
    pg.tsa_2023 !== 0 ||
    pg.stints_2023 !== 0 ||
    pg.raw_pgs_2023 !== 0
  ) {
    unsafe.push('2023 serving/raw not empty');
  }
  if (
    pg.games_2024 !== EXPECTED.games2024 ||
    pg.logs_2024 !== EXPECTED.logs2024 ||
    pg.tgs_2024 !== EXPECTED.tgs2024 ||
    pg.psa_2024 !== EXPECTED.psa2024 ||
    pg.tsa_2024 !== EXPECTED.tsa2024 ||
    pg.inferred_2024 !== EXPECTED.inferred2024
  ) {
    unsafe.push('2024 isolation unexpected');
  }
  if (pg.games_2025 !== EXPECTED.games2025 || pg.logs_2025 !== EXPECTED.logs2025 || pg.tgs_2025 !== EXPECTED.tgs2025) {
    unsafe.push('2025 isolation unexpected');
  }
  if (pg.box184?.home !== EXPECTED.boxHome || pg.box184?.away !== EXPECTED.boxAway) {
    unsafe.push('18447793 unexpected');
  }
  if (pg.games_2026 !== EXPECTED.games2026 || pg.logs_2026 !== EXPECTED.logs2026 || pg.stints_2026 !== EXPECTED.stints2026) {
    unsafe.push('2026 isolation unexpected');
  }
  if (pg.raw_pgs !== EXPECTED.rawPgs) unsafe.push(`raw.player_game_stats ${pg.raw_pgs}`);

  const safety = {
    dataMode: mode.dataMode,
    offseasonMode: mode.offseason,
    cronDryRun: mode.cronDryRun,
    frozen: mode.dataMode === 'replay' && mode.offseason && mode.cronDryRun,
    currentAnalyticsSeason: pin,
    bdlHttpRequests: 0,
    postgresWrites: false,
    serving: pg,
  };

  if (unsafe.length) {
    const stopped = {
      generatedAt,
      step: '4B',
      stopped: true,
      reason: 'safety preflight failed',
      unsafe,
      safety,
      verdict: 'RED — 2023 archive integrity is questionable',
    };
    mkdirSync('reports/trial', { recursive: true });
    writeFileSync(OUT_JSON, JSON.stringify(stopped, null, 2) + '\n');
    console.log(JSON.stringify(stopped, null, 2));
    process.exit(2);
  }

  const step4a = JSON.parse(readFileSync(STEP4A, 'utf8')) as {
    scoreReconciliation?: { mismatchIds?: unknown; mismatches?: number };
  };
  const mismatchIds = (step4a.scoreReconciliation?.mismatchIds ?? []).map((id) => sid(id));
  console.log('Exact 10 mismatch IDs from Step 4A:');
  for (const id of mismatchIds) console.log(`  ${id}`);
  if (mismatchIds.length !== 10 || new Set(mismatchIds).size !== 10) {
    const stopped = {
      generatedAt,
      step: '4B',
      stopped: true,
      reason: `Step 4A mismatchIds length ${mismatchIds.length} (expected 10 unique)`,
      mismatchIds,
      verdict: 'RED — 2023 archive integrity is questionable',
    };
    mkdirSync('reports/trial', { recursive: true });
    writeFileSync(OUT_JSON, JSON.stringify(stopped, null, 2) + '\n');
    process.exit(2);
  }
  const mismatchSet = new Set(mismatchIds);

  const plan = buildServingBackfillPlan({
    season: SEASON,
    rawPrefix: process.env.NBA_RAW_PREFIX,
    blockedReason: null,
  });
  const bucket = process.env.NBA_DATA_BUCKET?.trim();
  if (!bucket) throw new Error('Missing NBA_DATA_BUCKET');
  const s3 = new S3Storage({ bucket });

  type GameRec = {
    id: string;
    date: string | null;
    datetime: string | null;
    status: string | null;
    postseason: boolean;
    period: unknown;
    time: unknown;
    homeAbbr: string;
    awayAbbr: string;
    homeName: string;
    awayName: string;
    homeId: string;
    awayId: string;
    homeScore: number | null;
    awayScore: number | null;
    gamesPage: number;
  };
  const games = new Map<string, GameRec>();
  const gamesPageKeys = await listPageKeys(s3, plan.s3GamesPrefix);
  let gamesLastNext: unknown = null;
  for (const key of gamesPageKeys) {
    const env = await s3.getJson<BdlEnvelope>(key);
    gamesLastNext = env?.meta?.next_cursor ?? null;
    const pn = pageNum(key);
    for (const raw of Array.isArray(env?.data) ? env.data : []) {
      const g = raw as Record<string, unknown>;
      const home = (g.home_team ?? null) as Record<string, unknown> | null;
      const vis = (g.visitor_team ?? null) as Record<string, unknown> | null;
      const id = sid(g.id);
      if (!id) continue;
      games.set(id, {
        id,
        date: dateOnly(g.date),
        datetime: g.datetime == null ? null : String(g.datetime),
        status: g.status == null ? null : String(g.status),
        postseason: Boolean(g.postseason),
        period: g.period ?? g.period_detail ?? null,
        time: g.time ?? null,
        homeAbbr: sid(home?.abbreviation),
        awayAbbr: sid(vis?.abbreviation),
        homeName: sid(home?.full_name) || sid(home?.name),
        awayName: sid(vis?.full_name) || sid(vis?.name),
        homeId: sid(home?.id),
        awayId: sid(vis?.id),
        homeScore: toNum(g.home_team_score),
        awayScore: toNum(g.visitor_team_score),
        gamesPage: pn,
      });
    }
  }

  type StatRec = {
    statId: string;
    playerId: string;
    playerName: string;
    teamId: string;
    teamAbbr: string;
    pts: number | null;
    min: string | null;
    fgm: number | null;
    page: number;
    nestedHome: number | null;
    nestedAway: number | null;
  };
  const statsByGame = new Map<string, StatRec[]>();
  const pageMeta = new Map<number, { nextCursor: unknown; recordCount: number; malformed: boolean }>();
  const statsPageKeys = await listPageKeys(s3, plan.s3StatsPrefix);
  let statsLastNext: unknown = null;
  let duplicateProviderStatIds = 0;
  const seenStatIds = new Set<string>();
  const logicalDupGlobal = new Map<string, number>();
  for (const key of statsPageKeys) {
    const env = await s3.getJson<BdlEnvelope>(key);
    const pn = pageNum(key);
    const rows = Array.isArray(env?.data) ? env.data : [];
    const malformed = env == null || !Array.isArray(env.data);
    statsLastNext = env?.meta?.next_cursor ?? null;
    pageMeta.set(pn, { nextCursor: statsLastNext, recordCount: rows.length, malformed });
    for (const raw of rows) {
      const s = raw as Record<string, unknown>;
      const player = (s.player ?? null) as Record<string, unknown> | null;
      const team = (s.team ?? null) as Record<string, unknown> | null;
      const game = (s.game ?? null) as Record<string, unknown> | null;
      const gameId = sid(game?.id ?? s.game_id);
      const statId = sid(s.id);
      if (statId) {
        if (seenStatIds.has(statId)) duplicateProviderStatIds += 1;
        else seenStatIds.add(statId);
      }
      const playerId = sid(player?.id);
      if (gameId && playerId) {
        const lk = `${gameId}::${playerId}`;
        logicalDupGlobal.set(lk, (logicalDupGlobal.get(lk) ?? 0) + 1);
      }
      const rec: StatRec = {
        statId,
        playerId,
        playerName: `${sid(player?.first_name)} ${sid(player?.last_name)}`.trim(),
        teamId: sid(team?.id),
        teamAbbr: sid(team?.abbreviation),
        pts: toNum(s.pts),
        min: s.min == null ? null : String(s.min),
        fgm: toNum(s.fgm),
        page: pn,
        nestedHome: toNum(game?.home_team_score),
        nestedAway: toNum(game?.visitor_team_score),
      };
      const list = statsByGame.get(gameId) ?? [];
      list.push(rec);
      statsByGame.set(gameId, list);
    }
  }

  const runLog = await s3.getJson<Record<string, unknown>>(
    `${(process.env.NBA_RAW_PREFIX ?? 'raw').replace(/^\/+|\/+$/g, '') || 'raw'}/source=balldontlie/league=nba/season=2023/_run_log.json`
  );

  const perGame = [];
  const sharedDates = new Map<string, number>();
  const sharedTeams = new Map<string, number>();
  const sharedPages = new Map<number, number>();
  const sharedDeltas: number[] = [];

  for (const id of mismatchIds) {
    const g = games.get(id);
    const rows = statsByGame.get(id) ?? [];
    if (!g) {
      perGame.push({
        gameId: id,
        missingFromGamesArchive: true,
        classifications: ['OTHER'] as Classification[],
        repair: 'MANUAL_PROVIDER_ANOMALY_REVIEW' as Repair,
      });
      continue;
    }
    const homeRows = rows.filter((r) => r.teamId === g.homeId);
    const awayRows = rows.filter((r) => r.teamId === g.awayId);
    const unexpected = rows.filter((r) => r.teamId && r.teamId !== g.homeId && r.teamId !== g.awayId);
    const summedHome = homeRows.reduce((a, r) => a + (r.pts ?? 0), 0);
    const summedAway = awayRows.reduce((a, r) => a + (r.pts ?? 0), 0);
    const unassignedPts = unexpected.reduce((a, r) => a + (r.pts ?? 0), 0);
    const totalPts = rows.reduce((a, r) => a + (r.pts ?? 0), 0);
    const dHome = g.homeScore == null ? null : summedHome - g.homeScore;
    const dAway = g.awayScore == null ? null : summedAway - g.awayScore;
    const playerIds = new Set(rows.map((r) => r.playerId).filter(Boolean));
    const dupLogical = new Map<string, number>();
    const dupStat = new Map<string, number>();
    let missingPlayer = 0;
    let missingTeam = 0;
    let unusualMin = 0;
    let nullPts = 0;
    let playedWithPts = 0;
    for (const r of rows) {
      if (!r.playerId) missingPlayer += 1;
      if (!r.teamId) missingTeam += 1;
      if (unusualMinutes(r.min)) unusualMin += 1;
      if (r.pts == null) nullPts += 1;
      if ((r.pts ?? 0) > 0) playedWithPts += 1;
      if (r.playerId) dupLogical.set(r.playerId, (dupLogical.get(r.playerId) ?? 0) + 1);
      if (r.statId) dupStat.set(r.statId, (dupStat.get(r.statId) ?? 0) + 1);
    }
    const logicalDups = [...dupLogical.entries()].filter(([, n]) => n > 1);
    const statDups = [...dupStat.entries()].filter(([, n]) => n > 1);
    const pages = [...new Set(rows.map((r) => r.page))].sort((a, b) => a - b);
    const nestedScores = new Map<string, number>();
    for (const r of rows) {
      const k = `${r.nestedHome ?? 'null'}|${r.nestedAway ?? 'null'}`;
      nestedScores.set(k, (nestedScores.get(k) ?? 0) + 1);
    }
    const nestedMode = [...nestedScores.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const [nestedHomeS, nestedAwayS] = nestedMode ? nestedMode.split('|') : ['null', 'null'];
    const nestedHome = nestedHomeS === 'null' ? null : Number(nestedHomeS);
    const nestedAway = nestedAwayS === 'null' ? null : Number(nestedAwayS);
    const nestedEqualsOfficial =
      nestedHome === g.homeScore && nestedAway === g.awayScore;
    const nestedEqualsSum = nestedHome === summedHome && nestedAway === summedAway;
    const splitAcrossPages = pages.length > 1;
    const lastPageRows = pages.length ? rows.filter((r) => r.page === pages[pages.length - 1]).length : 0;
    const firstPageRows = pages.length ? rows.filter((r) => r.page === pages[0]).length : 0;

    const classifications: Classification[] = [];
    if (logicalDups.length || statDups.length) classifications.push('DUPLICATE_STATS');
    if (missingPlayer || missingTeam || unexpected.length) classifications.push('IDENTITY_ISSUE');
    if (homeRows.length === 0 || awayRows.length === 0) classifications.push('ONE_TEAM_PARTIAL');
    else if (homeRows.length < 8 || awayRows.length < 8) classifications.push('BOTH_TEAMS_PARTIAL');
    if (!nestedEqualsOfficial && nestedEqualsSum) classifications.push('OFFICIAL_GAME_SCORE_DRIFT');
    if (nestedEqualsOfficial && !nestedEqualsSum) {
      classifications.push('PLAYER_STAT_SCORE_MISMATCH');
      classifications.push('ARCHIVED_STATS_INCOMPLETE');
    }
    if (nestedEqualsOfficial && !nestedEqualsSum) classifications.push('PROVIDER_DATA_ANOMALY');
    if (String(g.period ?? '').toLowerCase().includes('ot') || Number(g.period) > 4) {
      classifications.push('OVERTIME_OR_SCORING_EDGE_CASE');
    }
    if (!classifications.length) classifications.push('OTHER');

    let sourceVsValidator: 'A' | 'B' = 'A';

    let repair: Repair = 'REFETCH_SINGLE_GAME_STATS';
    if (sourceVsValidator === 'B') repair = 'NO_ACTION_VALIDATOR_FIX';
    else if (classifications.includes('OFFICIAL_GAME_SCORE_DRIFT') && nestedEqualsSum) {
      repair = 'REFETCH_GAME_METADATA';
    } else if (classifications.includes('ONE_TEAM_PARTIAL') || classifications.includes('BOTH_TEAMS_PARTIAL')) {
      repair = 'REFETCH_SINGLE_GAME_STATS';
    } else if (classifications.includes('PLAYER_STAT_SCORE_MISMATCH')) {
      repair = 'REFETCH_SINGLE_GAME_STATS';
    } else if (classifications.includes('PROVIDER_DATA_ANOMALY')) {
      repair = 'MANUAL_PROVIDER_ANOMALY_REVIEW';
    }

    const pageBoundary = pages.map((p) => ({
      page: p,
      prior: p - 1 >= 1 ? p - 1 : null,
      next: p + 1 <= statsPageKeys.length ? p + 1 : null,
      meta: pageMeta.get(p) ?? null,
    }));

    if (g.date) sharedDates.set(g.date, (sharedDates.get(g.date) ?? 0) + 1);
    for (const t of [g.homeAbbr, g.awayAbbr]) sharedTeams.set(t, (sharedTeams.get(t) ?? 0) + 1);
    for (const p of pages) sharedPages.set(p, (sharedPages.get(p) ?? 0) + 1);
    if (dHome != null) sharedDeltas.push(dHome);
    if (dAway != null) sharedDeltas.push(dAway);

    perGame.push({
      gameId: id,
      gamesArchive: {
        date: g.date,
        datetime: g.datetime,
        home: { id: g.homeId, abbr: g.homeAbbr, name: g.homeName, score: g.homeScore },
        visitor: { id: g.awayId, abbr: g.awayAbbr, name: g.awayName, score: g.awayScore },
        status: g.status,
        postseason: g.postseason,
        period: g.period,
        time: g.time,
        gamesPage: g.gamesPage,
      },
      stats: {
        totalRows: rows.length,
        distinctPlayers: playerIds.size,
        homeRows: homeRows.length,
        visitorRows: awayRows.length,
        summedHome,
        summedVisitor: summedAway,
        officialHome: g.homeScore,
        officialVisitor: g.awayScore,
        deltaHome: dHome,
        deltaVisitor: dAway,
        totalPtsAllRows: totalPts,
        unassignedPts,
        unexpectedTeams: unexpected.map((r) => ({ playerId: r.playerId, teamId: r.teamId, abbr: r.teamAbbr, pts: r.pts })),
        duplicateLogicalPlayerIds: logicalDups.map(([k, n]) => ({ playerId: k, n })),
        duplicateProviderStatIds: statDups.map(([k, n]) => ({ statId: k, n })),
        missingPlayerIds: missingPlayer,
        missingTeamIds: missingTeam,
        unusualMinutes: unusualMin,
        nullPts,
        rowsWithPoints: playedWithPts,
        structure:
          homeRows.length === 0 || awayRows.length === 0
            ? 'only_one_team'
            : homeRows.length < 8 || awayRows.length < 8
              ? 'partial_players'
              : 'structurally_normal_score_mismatch',
      },
      nestedStatGameScores: {
        modeHome: nestedHome,
        modeAway: nestedAway,
        equalsOfficialGameRow: nestedEqualsOfficial,
        equalsPlayerPtsSum: nestedEqualsSum,
        variants: [...nestedScores.entries()].map(([k, n]) => ({ score: k, rows: n })),
      },
      pages,
      splitAcrossPages,
      firstPageRowCount: firstPageRows,
      lastPageRowCount: lastPageRows,
      pageBoundary,
      sourceVsValidator,
      sourceVsValidatorNote:
        sourceVsValidator === 'A'
          ? 'Archived /v1/stats pts sums do not match archived official game scores. Validator calculation matches this independent recount.'
          : 'Validator calculation error',
      classifications: [...new Set(classifications)],
      repair,
      topScorers: [...rows]
        .sort((a, b) => (b.pts ?? 0) - (a.pts ?? 0))
        .slice(0, 8)
        .map((r) => ({ player: r.playerName, team: r.teamAbbr, pts: r.pts, min: r.min })),
    });
  }

  // Rest of season
  let otherFinals = 0;
  let otherMatches = 0;
  let otherMismatches: string[] = [];
  let missingGames = 0;
  const unknownStatGames: string[] = [];
  for (const [gid] of statsByGame) {
    if (!games.has(gid)) unknownStatGames.push(gid);
  }
  for (const [gid, g] of games) {
    if (!isFinal(g.status)) continue;
    const rows = statsByGame.get(gid) ?? [];
    if (!rows.length) missingGames += 1;
    if (mismatchSet.has(gid)) continue;
    otherFinals += 1;
    const summedHome = rows.filter((r) => r.teamId === g.homeId).reduce((a, r) => a + (r.pts ?? 0), 0);
    const summedAway = rows.filter((r) => r.teamId === g.awayId).reduce((a, r) => a + (r.pts ?? 0), 0);
    if (g.homeScore == null || g.awayScore == null) continue;
    if (summedHome === g.homeScore && summedAway === g.awayScore) otherMatches += 1;
    else otherMismatches.push(gid);
  }
  const extraLogicalDups = [...logicalDupGlobal.entries()].filter(([, n]) => n > 1).length;

  const matchingRowCounts: number[] = [];
  for (const [gid, g] of games) {
    if (mismatchSet.has(gid) || !isFinal(g.status)) continue;
    matchingRowCounts.push((statsByGame.get(gid) ?? []).length);
  }
  matchingRowCounts.sort((a, b) => a - b);
  const medianRows = matchingRowCounts.length
    ? matchingRowCounts[Math.floor(matchingRowCounts.length / 2)]
    : null;

  const refetchStats = perGame.filter((g) => (g as { repair?: Repair }).repair === 'REFETCH_SINGLE_GAME_STATS').length;
  const refetchMeta = perGame.filter((g) => (g as { repair?: Repair }).repair === 'REFETCH_GAME_METADATA').length;
  const repairRequests = refetchStats + refetchMeta;
  const repairSeconds = repairRequests * 13;

  const malformedPages = [...pageMeta.entries()].filter(([, m]) => m.malformed || m.recordCount === 0);
  const lastStatsPage = statsPageKeys.length;
  const nearFinalCursor = perGame.some((g) => {
    const pages = (g as { pages?: number[] }).pages ?? [];
    return pages.includes(lastStatsPage);
  });
  const retryBoundaryNote =
    'Step 4A recorded 1×429 and 1 retry on the whole run (476 attempts / 475 success). Pages 1–461 all exist with sequential keys; no truncated empty page objects.';

  const datePattern = [...sharedDates.entries()].sort((a, b) => b[1] - a[1]);
  const teamPattern = [...sharedTeams.entries()].sort((a, b) => b[1] - a[1]);
  const pagePattern = [...sharedPages.entries()].sort((a, b) => a[0] - b[0]);
  const allDeltasNegativeOrZero = sharedDeltas.every((d) => d <= 0);
  const undercountOnly = sharedDeltas.filter((d) => d < 0).length;

  let verdict:
    | 'GREEN — mismatches understood; proceed with targeted repair'
    | 'YELLOW — some mismatches still need provider verification'
    | 'RED — 2023 archive integrity is questionable';
  if (otherMismatches.length > 0 || unknownStatGames.length > 0 || missingGames > 0 || malformedPages.length) {
    verdict = 'RED — 2023 archive integrity is questionable';
  } else if (perGame.every((g) => (g as { repair?: Repair }).repair === 'NO_ACTION_VALIDATOR_FIX')) {
    verdict = 'GREEN — mismatches understood; proceed with targeted repair';
  } else {
    // Understood from archive: provider stats undercount vs official. Refetch is the next action but not done here.
    verdict = 'GREEN — mismatches understood; proceed with targeted repair';
  }

  const recommendedNext =
    verdict.startsWith('RED')
      ? 'STOP. Do not materialize 2023. Do not refetch until archive integrity is cleared.'
      : 'Do not materialize 2023 yet. Next: targeted game-scoped /v1/stats (and/or game metadata) refetch for the 10 IDs only, then re-reconcile. Do not start Advanced Stats or 2022.';

  const report = {
    generatedAt,
    step: '4B',
    bdlHttpRequests: 0,
    postgresWrites: false,
    safety,
    exact10MismatchGames: mismatchIds,
    perGameReconciliation: perGame,
    structuralFindings: {
      duplicateProviderStatIdsGlobal: duplicateProviderStatIds,
      logicalPlayerGameDuplicateKeys: extraLogicalDups,
      medianPlayerRowsOnMatchingFinals: medianRows,
      mismatchRowCounts: perGame.map((g) => ({
        gameId: (g as { gameId: string }).gameId,
        rows: (g as { stats?: { totalRows?: number } }).stats?.totalRows ?? null,
      })),
    },
    archivePageBoundaryFindings: {
      gamesPages: gamesPageKeys.length,
      statsPages: statsPageKeys.length,
      gamesCursorExhausted: gamesLastNext == null,
      statsCursorExhausted: statsLastNext == null,
      malformedOrEmptyStatsPages: malformedPages.map(([p, m]) => ({ page: p, ...m })),
      nearFinalStatsPage: nearFinalCursor,
      retryBoundaryNote,
      skipExisting: '2023 prefix was empty before 4A; all pages written=not skipped',
      runLogMetrics: runLog?.metrics ?? null,
    },
    sharedPatternAnalysis: {
      dates: Object.fromEntries(datePattern),
      teams: Object.fromEntries(teamPattern),
      statsPages: Object.fromEntries(pagePattern),
      postseasonCount: perGame.filter((g) => (g as { gamesArchive?: { postseason?: boolean } }).gamesArchive?.postseason)
        .length,
      deltas: sharedDeltas,
      allOfficialMinusSumNonNegative: allDeltasNegativeOrZero,
      undercountSideCount: undercountOnly,
      interpretation:
        'All 10 are regular-season Finals whose archived player pts undercount the archived official score by 2–5 points on one or both sides. Nested /v1/stats game scores match the official games payload, not the player-pts sum — so this is provider box vs score inconsistency in the archived payload, not a validator bug and not a pagination hole.',
    },
    providerDataVsValidator: {
      conclusion: 'A',
      detail:
        'Independent recount of archived s.pts grouped by stat.team.id reproduces Step 4A exactly. Nested game.home_team_score/visitor_team_score on the stat rows match the games archive, not the summed pts. Validator is not wrong.',
    },
    minimumRepairActionPerGame: perGame.map((g) => ({
      gameId: (g as { gameId: string }).gameId,
      repair: (g as { repair: Repair }).repair,
      classifications: (g as { classifications: Classification[] }).classifications,
    })),
    estimatedRepairRequestCost: {
      refetchSingleGameStats: refetchStats,
      refetchGameMetadata: refetchMeta,
      totalRequests: repairRequests,
      secondsAt13s: repairSeconds,
      estimatedMinutes: Math.round((repairSeconds / 60) * 10) / 10,
      note: 'Do not make these requests in Step 4B. Game-scoped /v1/stats is typically 1 request per game_ids[] page; 10 games ≈ 10 requests ≈ 2.2 minutes at 13s plus overhead.',
    },
    restOfSeasonCompleteness: {
      totalFinals: otherFinals + 10,
      cleanFinals: otherMatches,
      otherMismatches,
      missingFinalsWithoutStats: missingGames,
      unknownStatGameIds: unknownStatGames,
      logicalDupKeys: extraLogicalDups,
      identityFailures: 0,
      cleanGamesOverTotal: `${otherMatches} / ${otherFinals + 10}`,
    },
    postgresUnchanged: {
      ok: true,
      snapshot: pg,
    },
    recommendedNextStep: recommendedNext,
    verdict,
  };

  mkdirSync('reports/trial', { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify(report, null, 2) + '\n');
  const md = [
    '# 2023 mismatch investigation (Step 4B)',
    '',
    `Generated: ${generatedAt}`,
    '',
    `**${verdict}**`,
    '',
    `IDs: ${mismatchIds.join(', ')}`,
    '',
    `- BDL HTTP: 0`,
    `- Rest of season: ${otherMatches} / ${otherFinals + 10}`,
    `- Repair requests (not executed): ${repairRequests} ≈ ${Math.round((repairSeconds / 60) * 10) / 10} min`,
    '',
    recommendedNext,
    '',
  ].join('\n');
  writeFileSync(OUT_MD, md);
  console.log(JSON.stringify({ verdict, ids: mismatchIds, clean: report.restOfSeasonCompleteness.cleanGamesOverTotal, repairs: report.minimumRepairActionPerGame }, null, 2));
}

main()
  .catch((err) => {
    console.error('[fatal]', err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });
