/**
 * Step 12D: certified Advanced archive 2023–2025 → analytics.player_game_advanced.
 * Read-only S3. No BDL HTTP. Selected fields only. No raw payload.
 *
 *   npx tsx scripts/ingestion/materialize-player-game-advanced.ts --dry-run
 *   npx tsx scripts/ingestion/materialize-player-game-advanced.ts --execute --i-understand-production-write
 *   npx tsx scripts/ingestion/materialize-player-game-advanced.ts --certify-only
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { S3Storage } from '@/lib/aws/s3';
import {
  ADVANCED_ONLY_ALEX_LEN_2023,
  SELECTED_ADVANCED_FIELDS,
  advancedStatsV2Prefix,
  assertAdvancedGrainOrThrow,
  assertIdentityOrThrow,
  auditAdvancedIdentity,
  candidateKey,
  emptyGrainReport,
  extractAdvancedArchiveRows,
  ingestArchiveRowIntoGrain,
  isAdvancedArchivePageKey,
  parseAdvancedIdentity,
  type PlayerGameAdvancedCandidate,
  type PlayerGameAdvancedMetrics,
  type SelectedAdvancedField,
} from '@/lib/archive/player-game-advanced';
import {
  PLAYER_GAME_ADVANCED_SEASONS,
  PLAYER_GAME_ADVANCED_SOURCE,
} from '@/lib/betting/historical-advanced';
import pool from '@/lib/db';
import { readIngestionMode } from '@/lib/runtime/ingestion-mode';
import { selectArchiveRowsForServing } from '@/lib/identity/archive-identity';
import {
  loadPartialIdentityIndex,
  persistQuarantineObservations,
  type SqlQuery,
} from '@/lib/identity/player-identity-store';

const OUT_JSON = 'reports/trial/player-game-advanced-materialize.json';
const BATCH = 500;
const SEASONS = PLAYER_GAME_ADVANCED_SEASONS.map((s) => Number(s));

const SAMPLE_GAMES = ['15905067', '18444564', '18447937', ADVANCED_ONLY_ALEX_LEN_2023.gameId];

type FieldStats = {
  nulls: number;
  present: number;
  min: number | null;
  max: number | null;
  integerValued: number;
};

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
       coalesce(pg_table_size('analytics.player_game_advanced'), 0)::text as heap,
       coalesce(pg_indexes_size('analytics.player_game_advanced'), 0)::text as indexes,
       coalesce(pg_total_relation_size('analytics.player_game_advanced'), 0)::text as total`
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

function emptyFieldStats(): Record<SelectedAdvancedField, FieldStats> {
  const stats = {} as Record<SelectedAdvancedField, FieldStats>;
  for (const field of SELECTED_ADVANCED_FIELDS) {
    stats[field] = { nulls: 0, present: 0, min: null, max: null, integerValued: 0 };
  }
  return stats;
}

function observeMetrics(stats: Record<SelectedAdvancedField, FieldStats>, metrics: PlayerGameAdvancedMetrics) {
  for (const field of SELECTED_ADVANCED_FIELDS) {
    const value = metrics[field];
    const bucket = stats[field];
    if (value == null) {
      bucket.nulls += 1;
      continue;
    }
    bucket.present += 1;
    if (Number.isInteger(value)) bucket.integerValued += 1;
    bucket.min = bucket.min == null ? value : Math.min(bucket.min, value);
    bucket.max = bucket.max == null ? value : Math.max(bucket.max, value);
  }
}

function parseMinutes(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (s.includes(':')) {
    const [m, sec] = s.split(':');
    const minutes = Number(m);
    const seconds = Number(sec);
    if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
    return minutes + seconds / 60;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

async function upsertBatch(rows: PlayerGameAdvancedCandidate[]): Promise<number> {
  if (rows.length === 0) return 0;
  const result = await pool.query(
    `insert into analytics.player_game_advanced (
       game_id, player_id, season, source,
       usage_percentage, true_shooting_percentage, effective_field_goal_percentage,
       offensive_rating, defensive_rating, net_rating,
       pace, possessions, assist_percentage, rebound_percentage,
       turnover_ratio, pie
     )
     select * from unnest(
       $1::text[], $2::text[], $3::text[], $4::text[],
       $5::double precision[], $6::double precision[], $7::double precision[],
       $8::double precision[], $9::double precision[], $10::double precision[],
       $11::double precision[], $12::double precision[], $13::double precision[], $14::double precision[],
       $15::double precision[], $16::double precision[]
     ) as t(
       game_id, player_id, season, source,
       usage_percentage, true_shooting_percentage, effective_field_goal_percentage,
       offensive_rating, defensive_rating, net_rating,
       pace, possessions, assist_percentage, rebound_percentage,
       turnover_ratio, pie
     )
     on conflict on constraint player_game_advanced_pk do update set
       season = excluded.season,
       source = excluded.source,
       usage_percentage = excluded.usage_percentage,
       true_shooting_percentage = excluded.true_shooting_percentage,
       effective_field_goal_percentage = excluded.effective_field_goal_percentage,
       offensive_rating = excluded.offensive_rating,
       defensive_rating = excluded.defensive_rating,
       net_rating = excluded.net_rating,
       pace = excluded.pace,
       possessions = excluded.possessions,
       assist_percentage = excluded.assist_percentage,
       rebound_percentage = excluded.rebound_percentage,
       turnover_ratio = excluded.turnover_ratio,
       pie = excluded.pie,
       updated_at = now()
     where analytics.player_game_advanced.season is distinct from excluded.season
        or analytics.player_game_advanced.source is distinct from excluded.source
        or analytics.player_game_advanced.usage_percentage is distinct from excluded.usage_percentage
        or analytics.player_game_advanced.true_shooting_percentage is distinct from excluded.true_shooting_percentage
        or analytics.player_game_advanced.effective_field_goal_percentage is distinct from excluded.effective_field_goal_percentage
        or analytics.player_game_advanced.offensive_rating is distinct from excluded.offensive_rating
        or analytics.player_game_advanced.defensive_rating is distinct from excluded.defensive_rating
        or analytics.player_game_advanced.net_rating is distinct from excluded.net_rating
        or analytics.player_game_advanced.pace is distinct from excluded.pace
        or analytics.player_game_advanced.possessions is distinct from excluded.possessions
        or analytics.player_game_advanced.assist_percentage is distinct from excluded.assist_percentage
        or analytics.player_game_advanced.rebound_percentage is distinct from excluded.rebound_percentage
        or analytics.player_game_advanced.turnover_ratio is distinct from excluded.turnover_ratio
        or analytics.player_game_advanced.pie is distinct from excluded.pie`,
    [
      rows.map((r) => r.gameId),
      rows.map((r) => r.playerId),
      rows.map((r) => r.season),
      rows.map((r) => r.source),
      rows.map((r) => r.metrics.usage_percentage),
      rows.map((r) => r.metrics.true_shooting_percentage),
      rows.map((r) => r.metrics.effective_field_goal_percentage),
      rows.map((r) => r.metrics.offensive_rating),
      rows.map((r) => r.metrics.defensive_rating),
      rows.map((r) => r.metrics.net_rating),
      rows.map((r) => r.metrics.pace),
      rows.map((r) => r.metrics.possessions),
      rows.map((r) => r.metrics.assist_percentage),
      rows.map((r) => r.metrics.rebound_percentage),
      rows.map((r) => r.metrics.turnover_ratio),
      rows.map((r) => r.metrics.pie),
    ]
  );
  return result.rowCount ?? 0;
}

async function loadServingCertification() {
  const bySeason = await pool.query<{ season: string; n: string; games: string; players: string }>(
    `select season,
            count(*)::text as n,
            count(distinct game_id)::text as games,
            count(distinct player_id)::text as players
     from analytics.player_game_advanced
     group by season
     order by season`
  );
  const total = await pool.query<{ n: string; games: string; dups: string }>(
    `select
       (select count(*)::text from analytics.player_game_advanced) as n,
       (select count(distinct game_id)::text from analytics.player_game_advanced) as games,
       (select count(*)::text from (
          select game_id, player_id from analytics.player_game_advanced
          group by 1,2 having count(*) > 1
        ) d) as dups`
  );
  const perGame = await pool.query<{ season: string; games: string; avg: string; min: string; max: string }>(
    `select season,
            count(*)::text as games,
            round(avg(n)::numeric, 2)::text as avg,
            min(n)::text as min,
            max(n)::text as max
     from (
       select season, game_id, count(*)::int as n
       from analytics.player_game_advanced
       group by season, game_id
     ) g
     group by season
     order by season`
  );
  const coverage = await pool.query<{
    season: string;
    pgl: string;
    matched: string;
    advanced_only: string;
  }>(
    `select pgl.season,
            pgl.n::text as pgl,
            coalesce(m.n, 0)::text as matched,
            coalesce(a.only, 0)::text as advanced_only
     from (
       select season, count(*)::int as n
       from analytics.player_game_logs
       where season = any($1::text[])
       group by season
     ) pgl
     left join (
       select pgl.season, count(*)::int as n
       from analytics.player_game_logs pgl
       join analytics.player_game_advanced a
         on a.game_id = pgl.game_id and a.player_id = pgl.player_id
       where pgl.season = any($1::text[])
       group by pgl.season
     ) m on m.season = pgl.season
     left join (
       select a.season, count(*)::int as only
       from analytics.player_game_advanced a
       left join analytics.player_game_logs pgl
         on pgl.game_id = a.game_id and pgl.player_id = a.player_id
       where pgl.player_id is null
       group by a.season
     ) a on a.season = pgl.season
     order by pgl.season`,
    [[...PLAYER_GAME_ADVANCED_SEASONS]]
  );
  const edge = await pool.query<{ n: string; season: string | null }>(
    `select count(*)::text as n, max(season) as season
     from analytics.player_game_advanced
     where game_id = $1 and player_id = $2`,
    [ADVANCED_ONLY_ALEX_LEN_2023.gameId, ADVANCED_ONLY_ALEX_LEN_2023.playerId]
  );
  const lowSample = await pool.query<{
    poss_lt_5: string;
    poss_lt_10: string;
    pace_gt_140: string;
    pace_lt_70: string;
    ortg_gt_200: string;
    ortg_lt_50: string;
    drtg_gt_200: string;
    usage_gt_1: string;
  }>(
    `select
       count(*) filter (where possessions is not null and possessions < 5)::text as poss_lt_5,
       count(*) filter (where possessions is not null and possessions < 10)::text as poss_lt_10,
       count(*) filter (where pace is not null and pace > 140)::text as pace_gt_140,
       count(*) filter (where pace is not null and pace < 70)::text as pace_lt_70,
       count(*) filter (where offensive_rating is not null and offensive_rating > 200)::text as ortg_gt_200,
       count(*) filter (where offensive_rating is not null and offensive_rating < 50)::text as ortg_lt_50,
       count(*) filter (where defensive_rating is not null and defensive_rating > 200)::text as drtg_gt_200,
       count(*) filter (where usage_percentage is not null and usage_percentage > 1)::text as usage_gt_1
     from analytics.player_game_advanced`
  );
  const samples = await pool.query<{
    game_id: string;
    player_id: string;
    season: string;
    usage_percentage: number | null;
    true_shooting_percentage: number | null;
    possessions: number | null;
    pie: number | null;
  }>(
    `select game_id, player_id, season, usage_percentage, true_shooting_percentage, possessions, pie
     from analytics.player_game_advanced
     where game_id = any($1::text[])
     order by game_id, player_id`,
    [SAMPLE_GAMES]
  );
  return {
    bySeason: bySeason.rows.map((r) => ({
      season: r.season,
      rows: Number(r.n),
      games: Number(r.games),
      players: Number(r.players),
    })),
    totalRows: Number(total.rows[0]?.n ?? 0),
    totalGames: Number(total.rows[0]?.games ?? 0),
    duplicateKeys: Number(total.rows[0]?.dups ?? 0),
    perGame: perGame.rows.map((r) => ({
      season: r.season,
      gamesWithAdvanced: Number(r.games),
      avgRows: Number(r.avg),
      minRows: Number(r.min),
      maxRows: Number(r.max),
    })),
    coverage: coverage.rows.map((r) => {
      const pgl = Number(r.pgl);
      const matched = Number(r.matched);
      return {
        season: r.season,
        pglRows: pgl,
        matchedAdvanced: matched,
        coveragePct: pgl > 0 ? Math.round((matched / pgl) * 1000) / 10 : null,
        advancedOnly: Number(r.advanced_only),
      };
    }),
    alexLen: {
      servingRows: Number(edge.rows[0]?.n ?? 0),
      season: edge.rows[0]?.season ?? null,
    },
    extremes: Object.fromEntries(
      Object.entries(lowSample.rows[0] ?? {}).map(([k, v]) => [k, Number(v)])
    ),
    sampleRows: samples.rows,
  };
}

async function scanArchive(s3: S3Storage) {
  const byKey = new Map<string, PlayerGameAdvancedCandidate>();
  const grain = emptyGrainReport();
  const fieldStats = emptyFieldStats();
  const perSeason: Record<
    string,
    { archiveRows: number; validLogicalRows: number; uniqueGames: Set<string>; uniquePlayers: Set<string> }
  > = {};
  let teamMismatch = 0;
  let teamPresent = 0;
  let pages = 0;

  for (const season of SEASONS) {
    const seasonKey = String(season);
    perSeason[seasonKey] = {
      archiveRows: 0,
      validLogicalRows: 0,
      uniqueGames: new Set(),
      uniquePlayers: new Set(),
    };
    const prefix = advancedStatsV2Prefix(season);
    for await (const obj of s3.listByPrefix(prefix.endsWith('/') ? prefix : `${prefix}/`)) {
      if (!isAdvancedArchivePageKey(obj.key)) continue;
      pages += 1;
      const body = await s3.getJson(obj.key);
      const rows = extractAdvancedArchiveRows(body);
      for (const row of rows) {
        const before = grain.validLogicalRows;
        const archiveRowsBefore = grain.archiveRows;
        ingestArchiveRowIntoGrain({ row, archiveSeason: seasonKey, byKey, grain });
        perSeason[seasonKey].archiveRows += grain.archiveRows - archiveRowsBefore;
        if (grain.validLogicalRows > before) {
          perSeason[seasonKey].validLogicalRows += 1;
          const ids = parseAdvancedIdentity(row as Record<string, unknown>);
          if (ids.gameId) perSeason[seasonKey].uniqueGames.add(ids.gameId);
          if (ids.playerId) perSeason[seasonKey].uniquePlayers.add(ids.playerId);
          if (ids.archiveTeamId && ids.playerListedTeamId) {
            teamPresent += 1;
            if (ids.archiveTeamId !== ids.playerListedTeamId) teamMismatch += 1;
          }
        }
      }
    }
  }

  for (const candidate of byKey.values()) observeMetrics(fieldStats, candidate.metrics);

  return { byKey, grain, fieldStats, perSeason, teamMismatch, teamPresent, pages };
}

async function certifyOnly() {
  const serving = await loadServingCertification();
  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'certify-only',
    source: PLAYER_GAME_ADVANCED_SOURCE,
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

  const { byKey, grain, fieldStats, perSeason, teamMismatch, teamPresent, pages } = await scanArchive(s3);
  assertAdvancedGrainOrThrow(grain);

  const gameRes = await pool.query<{ game_id: string; season: string }>(
    `select game_id, season from analytics.games where season = any($1::text[])`,
    [[...PLAYER_GAME_ADVANCED_SEASONS]]
  );
  const scanned = [...byKey.values()];
  const sqlQuery: SqlQuery = (text, params) => pool.query(text, params);
  const identityIndex = await loadPartialIdentityIndex(
    sqlQuery,
    'balldontlie',
    scanned.map((row) => row.playerId)
  );
  const partitioned = selectArchiveRowsForServing(
    'ADVANCED',
    scanned,
    (row) => row.playerId,
    identityIndex,
    generatedAt
  );
  if (flags.execute) {
    await persistQuarantineObservations(sqlQuery, partitioned.gate.observations);
  }
  const servingPlayerIds = new Set(partitioned.keep.map((row) => row.playerId));
  const pglRes = await pool.query<{ game_id: string; player_id: string; minutes: string | null }>(
    `select game_id, player_id, minutes
     from analytics.player_game_logs
     where season = any($1::text[])`,
    [[...PLAYER_GAME_ADVANCED_SEASONS]]
  );
  const gamesById = new Map(gameRes.rows.map((g) => [g.game_id, g]));
  const pglKeys = new Set(pglRes.rows.map((r) => candidateKey(r.game_id, r.player_id)));
  const pglMinutes = new Map(
    pglRes.rows.map((r) => [candidateKey(r.game_id, r.player_id), parseMinutes(r.minutes)])
  );

  const { candidates, audit } = auditAdvancedIdentity({
    candidates: partitioned.keep,
    gamesById,
    playerIds: servingPlayerIds,
    pglKeys,
  });
  assertIdentityOrThrow(audit);

  let minutesLt5 = 0;
  let minutesUnknown = 0;
  let possLt5 = 0;
  let advancedOnlyKeys: string[] = [];
  for (const row of candidates) {
    const key = candidateKey(row.gameId, row.playerId);
    if (!pglKeys.has(key)) {
      if (advancedOnlyKeys.length < 20) advancedOnlyKeys.push(key);
    }
    const minutes = pglMinutes.get(key);
    if (minutes == null) minutesUnknown += 1;
    else if (minutes < 5) minutesLt5 += 1;
    if (row.metrics.possessions != null && row.metrics.possessions < 5) possLt5 += 1;
  }

  const alex = candidates.find(
    (r) =>
      r.gameId === ADVANCED_ONLY_ALEX_LEN_2023.gameId &&
      r.playerId === ADVANCED_ONLY_ALEX_LEN_2023.playerId
  );

  const candidate = {
    pages,
    grain,
    perSeason: Object.fromEntries(
      Object.entries(perSeason).map(([season, v]) => [
        season,
        {
          archiveRows: v.archiveRows,
          validLogicalRows: v.validLogicalRows,
          uniqueGames: v.uniqueGames.size,
          uniquePlayers: v.uniquePlayers.size,
        },
      ])
    ),
    combinedCandidates: candidates.length,
    identity: {
      ...audit,
      canonical: partitioned.gate.accounting,
      resolverQueryCount: 2,
      skippedNonServing: partitioned.skipped.length,
    },
    teamAssociation: {
      compared: teamPresent,
      archiveTeamNePlayerListedTeam: teamMismatch,
      storedInServing: false,
      note: 'Prefer player_game_logs.team_id at render. Do not use player.team_id.',
    },
    fieldStats,
    lowSample: { minutesLt5, minutesUnknown, possLt5 },
    advancedOnly: {
      count: audit.advancedOnlyValid,
      samples: advancedOnlyKeys,
      alexLenPresent: Boolean(alex),
      alexLen: alex
        ? {
            gameId: alex.gameId,
            playerId: alex.playerId,
            season: alex.season,
            policy: 'serve_if_identity_valid_do_not_fabricate_box',
          }
        : null,
    },
  };

  const report: Record<string, unknown> = {
    generatedAt,
    mode: flags.execute ? 'execute' : 'dry-run',
    dataMode: mode.dataMode,
    offseason: mode.offseason,
    cronDryRun: mode.cronDryRun,
    sourceReadOnly: true,
    bdlHttp: 0,
    bytesBefore,
    candidate,
  };

  if (!flags.execute) {
    mkdirSync('reports/trial', { recursive: true });
    writeFileSync(OUT_JSON, JSON.stringify(report, null, 2) + '\n');
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          combinedCandidates: candidates.length,
          grain,
          identity: {
            mapped: audit.mapped,
            unmappedGames: audit.unmappedGames,
            unmappedPlayers: audit.unmappedPlayers,
            seasonMismatch: audit.seasonMismatch,
            advancedOnlyValid: audit.advancedOnlyValid,
          },
          perSeason: candidate.perSeason,
          alexLenPresent: Boolean(alex),
        },
        null,
        2
      )
    );
    return;
  }

  let firstTouched = 0;
  for (const part of chunk(candidates, BATCH)) firstTouched += await upsertBatch(part);
  let secondTouched = 0;
  for (const part of chunk(candidates, BATCH)) secondTouched += await upsertBatch(part);

  const serving = await loadServingCertification();
  const bytesAfter = await dbBytes();
  const sizes = await tableBytes();
  report.backfill = {
    upsertTouchedFirst: firstTouched,
    upsertTouchedSecond: secondTouched,
    serving,
  };
  report.bytesAfter = bytesAfter;
  report.tableBytes = sizes;
  report.deltaBytes = bytesAfter - bytesBefore;

  mkdirSync('reports/trial', { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify(
      {
        execute: true,
        combinedCandidates: candidates.length,
        upsertTouchedFirst: firstTouched,
        upsertTouchedSecond: secondTouched,
        servingRows: serving.totalRows,
        duplicateKeys: serving.duplicateKeys,
        alexLen: serving.alexLen,
        tableBytes: sizes,
        deltaBytes: bytesAfter - bytesBefore,
      },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });
