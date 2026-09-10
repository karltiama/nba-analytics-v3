/**
 * Step 12F: certified targeted Season Averages 2023–2025 → analytics.player_role_profile.
 * Read-only S3. No BDL HTTP. Selected fields only. No raw payload.
 *
 *   npx tsx scripts/ingestion/materialize-player-role-profile.ts --dry-run
 *   npx tsx scripts/ingestion/materialize-player-role-profile.ts --execute --i-understand-production-write
 *   npx tsx scripts/ingestion/materialize-player-role-profile.ts --certify-only
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { S3Storage } from '@/lib/aws/s3';
import {
  coverageFlags,
  createRoleIngestState,
  extractSeasonAverageRows,
  finalizeRoleCandidates,
  ingestSeasonAverageRow,
  isRoleProfileArchivePageKey,
  parseRoleArchivePageKey,
  auditRoleIdentity,
  type PlayerRoleProfileCandidate,
} from '@/lib/archive/player-role-profile';
import {
  PLAYER_ROLE_PROFILE_SEASONS,
  PLAYER_ROLE_PROFILE_SOURCE,
} from '@/lib/betting/historical-role-profile';
import pool from '@/lib/db';
import { readIngestionMode } from '@/lib/runtime/ingestion-mode';

const OUT_JSON = 'reports/trial/player-role-profile-materialize.json';
const BATCH = 250;

function parseFlags(argv: string[]) {
  const execute = argv.includes('--execute');
  const certifyOnly = argv.includes('--certify-only');
  const confirm = argv.includes('--i-understand-production-write');
  const dryRun = argv.includes('--dry-run') || (!execute && !certifyOnly);
  return { execute, certifyOnly, confirm, dryRun };
}

async function dbBytes(): Promise<number> {
  const r = await pool.query<{ n: string }>(`select pg_database_size(current_database())::text as n`);
  return Number(r.rows[0]?.n ?? 0);
}

async function tableBytes(): Promise<{ heap: number; indexes: number; total: number }> {
  const r = await pool.query<{ heap: string; indexes: string; total: string }>(
    `select
       coalesce(pg_table_size('analytics.player_role_profile'), 0)::text as heap,
       coalesce(pg_indexes_size('analytics.player_role_profile'), 0)::text as indexes,
       coalesce(pg_total_relation_size('analytics.player_role_profile'), 0)::text as total`
  );
  return {
    heap: Number(r.rows[0]?.heap ?? 0),
    indexes: Number(r.rows[0]?.indexes ?? 0),
    total: Number(r.rows[0]?.total ?? 0),
  };
}

function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

async function upsertBatch(rows: PlayerRoleProfileCandidate[]): Promise<number> {
  if (rows.length === 0) return 0;
  const result = await pool.query(
    `insert into analytics.player_role_profile (
       player_id, season, source,
       isolation_poss_pct, isolation_ppp,
       pnr_ball_handler_poss_pct, pnr_ball_handler_ppp,
       pnr_roll_man_poss_pct, pnr_roll_man_ppp,
       drives_per_game, drive_points_per_game,
       passes_per_game, potential_assists_per_game,
       restricted_area_fga, restricted_area_fg_pct,
       paint_non_ra_fga, paint_non_ra_fg_pct,
       midrange_fga, midrange_fg_pct,
       corner_three_fga, corner_three_fg_pct,
       above_break_three_fga, above_break_three_fg_pct
     )
     select * from unnest(
       $1::text[], $2::text[], $3::text[],
       $4::double precision[], $5::double precision[],
       $6::double precision[], $7::double precision[],
       $8::double precision[], $9::double precision[],
       $10::double precision[], $11::double precision[],
       $12::double precision[], $13::double precision[],
       $14::double precision[], $15::double precision[],
       $16::double precision[], $17::double precision[],
       $18::double precision[], $19::double precision[],
       $20::double precision[], $21::double precision[],
       $22::double precision[], $23::double precision[]
     ) as t(
       player_id, season, source,
       isolation_poss_pct, isolation_ppp,
       pnr_ball_handler_poss_pct, pnr_ball_handler_ppp,
       pnr_roll_man_poss_pct, pnr_roll_man_ppp,
       drives_per_game, drive_points_per_game,
       passes_per_game, potential_assists_per_game,
       restricted_area_fga, restricted_area_fg_pct,
       paint_non_ra_fga, paint_non_ra_fg_pct,
       midrange_fga, midrange_fg_pct,
       corner_three_fga, corner_three_fg_pct,
       above_break_three_fga, above_break_three_fg_pct
     )
     on conflict on constraint player_role_profile_pk do update set
       source = excluded.source,
       isolation_poss_pct = excluded.isolation_poss_pct,
       isolation_ppp = excluded.isolation_ppp,
       pnr_ball_handler_poss_pct = excluded.pnr_ball_handler_poss_pct,
       pnr_ball_handler_ppp = excluded.pnr_ball_handler_ppp,
       pnr_roll_man_poss_pct = excluded.pnr_roll_man_poss_pct,
       pnr_roll_man_ppp = excluded.pnr_roll_man_ppp,
       drives_per_game = excluded.drives_per_game,
       drive_points_per_game = excluded.drive_points_per_game,
       passes_per_game = excluded.passes_per_game,
       potential_assists_per_game = excluded.potential_assists_per_game,
       restricted_area_fga = excluded.restricted_area_fga,
       restricted_area_fg_pct = excluded.restricted_area_fg_pct,
       paint_non_ra_fga = excluded.paint_non_ra_fga,
       paint_non_ra_fg_pct = excluded.paint_non_ra_fg_pct,
       midrange_fga = excluded.midrange_fga,
       midrange_fg_pct = excluded.midrange_fg_pct,
       corner_three_fga = excluded.corner_three_fga,
       corner_three_fg_pct = excluded.corner_three_fg_pct,
       above_break_three_fga = excluded.above_break_three_fga,
       above_break_three_fg_pct = excluded.above_break_three_fg_pct,
       updated_at = now()
     where analytics.player_role_profile.source is distinct from excluded.source
        or analytics.player_role_profile.isolation_poss_pct is distinct from excluded.isolation_poss_pct
        or analytics.player_role_profile.isolation_ppp is distinct from excluded.isolation_ppp
        or analytics.player_role_profile.pnr_ball_handler_poss_pct is distinct from excluded.pnr_ball_handler_poss_pct
        or analytics.player_role_profile.pnr_ball_handler_ppp is distinct from excluded.pnr_ball_handler_ppp
        or analytics.player_role_profile.pnr_roll_man_poss_pct is distinct from excluded.pnr_roll_man_poss_pct
        or analytics.player_role_profile.pnr_roll_man_ppp is distinct from excluded.pnr_roll_man_ppp
        or analytics.player_role_profile.drives_per_game is distinct from excluded.drives_per_game
        or analytics.player_role_profile.drive_points_per_game is distinct from excluded.drive_points_per_game
        or analytics.player_role_profile.passes_per_game is distinct from excluded.passes_per_game
        or analytics.player_role_profile.potential_assists_per_game is distinct from excluded.potential_assists_per_game
        or analytics.player_role_profile.restricted_area_fga is distinct from excluded.restricted_area_fga
        or analytics.player_role_profile.restricted_area_fg_pct is distinct from excluded.restricted_area_fg_pct
        or analytics.player_role_profile.paint_non_ra_fga is distinct from excluded.paint_non_ra_fga
        or analytics.player_role_profile.paint_non_ra_fg_pct is distinct from excluded.paint_non_ra_fg_pct
        or analytics.player_role_profile.midrange_fga is distinct from excluded.midrange_fga
        or analytics.player_role_profile.midrange_fg_pct is distinct from excluded.midrange_fg_pct
        or analytics.player_role_profile.corner_three_fga is distinct from excluded.corner_three_fga
        or analytics.player_role_profile.corner_three_fg_pct is distinct from excluded.corner_three_fg_pct
        or analytics.player_role_profile.above_break_three_fga is distinct from excluded.above_break_three_fga
        or analytics.player_role_profile.above_break_three_fg_pct is distinct from excluded.above_break_three_fg_pct`,
    [
      rows.map((r) => r.playerId),
      rows.map((r) => r.season),
      rows.map((r) => r.source),
      rows.map((r) => r.metrics.isolationPossPct),
      rows.map((r) => r.metrics.isolationPpp),
      rows.map((r) => r.metrics.pnrBallHandlerPossPct),
      rows.map((r) => r.metrics.pnrBallHandlerPpp),
      rows.map((r) => r.metrics.pnrRollManPossPct),
      rows.map((r) => r.metrics.pnrRollManPpp),
      rows.map((r) => r.metrics.drivesPerGame),
      rows.map((r) => r.metrics.drivePointsPerGame),
      rows.map((r) => r.metrics.passesPerGame),
      rows.map((r) => r.metrics.potentialAssistsPerGame),
      rows.map((r) => r.metrics.restrictedAreaFga),
      rows.map((r) => r.metrics.restrictedAreaFgPct),
      rows.map((r) => r.metrics.paintNonRaFga),
      rows.map((r) => r.metrics.paintNonRaFgPct),
      rows.map((r) => r.metrics.midrangeFga),
      rows.map((r) => r.metrics.midrangeFgPct),
      rows.map((r) => r.metrics.cornerThreeFga),
      rows.map((r) => r.metrics.cornerThreeFgPct),
      rows.map((r) => r.metrics.aboveBreakThreeFga),
      rows.map((r) => r.metrics.aboveBreakThreeFgPct),
    ]
  );
  return result.rowCount ?? 0;
}

function countCoverage(rows: PlayerRoleProfileCandidate[]) {
  const bySeason: Record<
    string,
    {
      profiles: number;
      isolation: number;
      pnrBallHandler: number;
      pnrRollMan: number;
      drives: number;
      passing: number;
      zone: number;
    }
  > = {};
  for (const season of PLAYER_ROLE_PROFILE_SEASONS) {
    bySeason[season] = {
      profiles: 0,
      isolation: 0,
      pnrBallHandler: 0,
      pnrRollMan: 0,
      drives: 0,
      passing: 0,
      zone: 0,
    };
  }
  for (const row of rows) {
    const bucket = bySeason[row.season];
    if (!bucket) continue;
    bucket.profiles += 1;
    const flags = coverageFlags(row.metrics);
    if (flags.isolation) bucket.isolation += 1;
    if (flags.pnrBallHandler) bucket.pnrBallHandler += 1;
    if (flags.pnrRollMan) bucket.pnrRollMan += 1;
    if (flags.drives) bucket.drives += 1;
    if (flags.passing) bucket.passing += 1;
    if (flags.zone) bucket.zone += 1;
  }
  return Object.fromEntries(
    Object.entries(bySeason).map(([season, v]) => [
      season,
      {
        ...v,
        isolationPct: v.profiles ? Math.round((1000 * v.isolation) / v.profiles) / 10 : null,
        pnrBallHandlerPct: v.profiles ? Math.round((1000 * v.pnrBallHandler) / v.profiles) / 10 : null,
        pnrRollManPct: v.profiles ? Math.round((1000 * v.pnrRollMan) / v.profiles) / 10 : null,
        drivesPct: v.profiles ? Math.round((1000 * v.drives) / v.profiles) / 10 : null,
        passingPct: v.profiles ? Math.round((1000 * v.passing) / v.profiles) / 10 : null,
        zonePct: v.profiles ? Math.round((1000 * v.zone) / v.profiles) / 10 : null,
      },
    ])
  );
}

async function loadServingCertification() {
  const bySeason = await pool.query<{ season: string; n: string }>(
    `select season, count(*)::text as n
     from analytics.player_role_profile
     group by season
     order by season`
  );
  const total = await pool.query<{ n: string; dups: string }>(
    `select
       (select count(*)::text from analytics.player_role_profile) as n,
       (select count(*)::text from (
          select player_id, season from analytics.player_role_profile
          group by 1,2 having count(*) > 1
        ) d) as dups`
  );
  const samples = await pool.query<{
    player_id: string;
    season: string;
    isolation_poss_pct: number | null;
    pnr_ball_handler_poss_pct: number | null;
    drives_per_game: number | null;
  }>(
    `select player_id, season, isolation_poss_pct, pnr_ball_handler_poss_pct, drives_per_game
     from analytics.player_role_profile
     where player_id = any($1::text[]) and season = any($2::text[])
     order by season, player_id`,
    [['175', '434', '246'], [...PLAYER_ROLE_PROFILE_SEASONS]]
  );
  return {
    bySeason: bySeason.rows.map((r) => ({ season: r.season, rows: Number(r.n) })),
    totalRows: Number(total.rows[0]?.n ?? 0),
    duplicateKeys: Number(total.rows[0]?.dups ?? 0),
    sampleRows: samples.rows,
  };
}

async function scanArchive(s3: S3Storage) {
  const state = createRoleIngestState();
  let pages = 0;
  const prefix = 'raw/source=balldontlie/league=nba/entity=season_averages/';
  for await (const obj of s3.listByPrefix(prefix)) {
    if (!isRoleProfileArchivePageKey(obj.key)) continue;
    const parsed = parseRoleArchivePageKey(obj.key);
    if (!parsed.season || !parsed.type) continue;
    pages += 1;
    const body = await s3.getJson(obj.key);
    const rows = extractSeasonAverageRows(body);
    for (const row of rows) {
      ingestSeasonAverageRow({
        row,
        archiveSeason: parsed.season,
        type: parsed.type,
        state,
      });
    }
  }
  const candidates = finalizeRoleCandidates(state);
  return { state, pages, candidates };
}

async function certifyOnly() {
  const serving = await loadServingCertification();
  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'certify-only',
    source: PLAYER_ROLE_PROFILE_SOURCE,
    serving,
  };
  mkdirSync('reports/trial', { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const mode = readIngestionMode();
  const generatedAt = new Date().toISOString();
  const bytesBefore = await dbBytes();
  const tableBefore = await tableBytes();

  if (mode.dataMode !== 'replay') {
    throw new Error(`Safety stop: DATA_MODE=${mode.dataMode || '(empty)'} (require replay)`);
  }
  if (flags.execute && flags.certifyOnly) {
    throw new Error('Safety stop: use either --execute or --certify-only');
  }
  if (flags.execute && !flags.confirm) {
    throw new Error('Safety stop: --execute requires --i-understand-production-write');
  }
  if (flags.certifyOnly) {
    await certifyOnly();
    return;
  }

  const bucket = process.env.NBA_DATA_BUCKET?.trim();
  if (!bucket) throw new Error('NBA_DATA_BUCKET required');
  const s3 = new S3Storage({ bucket });

  const { state, pages, candidates: scanned } = await scanArchive(s3);
  const playerRes = await pool.query<{ player_id: string }>(`select player_id from analytics.players`);
  const playerIds = new Set(playerRes.rows.map((p) => p.player_id));
  const { candidates, audit } = auditRoleIdentity({ candidates: scanned, playerIds });
  const coverage = countCoverage(candidates);

  let written = 0;
  if (flags.execute) {
    for (const batch of chunk(candidates, BATCH)) {
      written += await upsertBatch(batch);
    }
  }

  const bytesAfter = await dbBytes();
  const tableAfter = await tableBytes();
  const serving = flags.execute ? await loadServingCertification() : null;

  const report = {
    generatedAt,
    mode: flags.execute ? 'execute' : 'dry-run',
    source: PLAYER_ROLE_PROFILE_SOURCE,
    safety: {
      dataMode: mode.dataMode,
      offseasonMode: mode.offseason ? '1' : '0',
      cronDryRun: mode.cronDryRun ? '1' : '0',
      bdlHttp: 0,
    },
    pages,
    grain: state.grain,
    identity: audit,
    coverage,
    candidateRows: candidates.length,
    written,
    storage: {
      dbBytesBefore: bytesBefore,
      dbBytesAfter: bytesAfter,
      dbDelta: bytesAfter - bytesBefore,
      tableBefore,
      tableAfter,
    },
    serving,
    policy: {
      inclusion: 'player-season row if at least one approved category is present',
      primaryRoleLabel: 'omit — captured playtypes insufficient for a universal archetype',
      playtypeGp: 'not served (qualifying games, not season GP)',
    },
  };
  mkdirSync('reports/trial', { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
