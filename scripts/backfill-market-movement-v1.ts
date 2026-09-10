/**
 * Step 11C: deterministic historical Market Movement v1 backfill.
 * S3 reference + Postgres comparison → compact serving UPSERT. No BDL HTTP.
 *
 *   npx tsx scripts/backfill-market-movement-v1.ts --dry-run
 *   npx tsx scripts/backfill-market-movement-v1.ts --execute
 *   npx tsx scripts/backfill-market-movement-v1.ts --certify
 */
import dotenv from 'dotenv';
import { Pool, type PoolClient } from 'pg';
import { S3Storage } from '@/lib/aws/s3';
import { bdlAcquisitionLockStatus } from '@/lib/balldontlie/acquisition-lock';
import {
  canonicalizePropType,
  PLAYER_PROP_V1_PROP_TYPES,
  PLAYER_PROP_V1_VENDORS,
  playerPropConsensus,
} from '@/lib/betting/market-movement';
import {
  CERTIFIED_GAME_OPENING_GAMES,
  CERTIFIED_GAME_OPENING_ROWS,
  CERTIFIED_GAME_SPORTSBOOK_MATCHES,
  CERTIFIED_GAME_SPORTSBOOK_OPENING_ROWS,
  CERTIFIED_GAME_UNMATCHED_SPORTSBOOK_ROWS,
  CERTIFIED_PLAYER_OPENING_GAMES,
  CERTIFIED_PLAYER_OPENING_ROWS,
  CERTIFIED_PLAYER_PRODUCT_GRADE_MATCHES,
  CERTIFIED_PLAYER_V1_ALLOWLIST_MATCHES,
  GAME_UPSERT_BATCH_SIZE,
  MARKET_MOVEMENT_V1_BACKFILL_REVISION,
  OPENING_GAME_ODDS_S3_PREFIX,
  OPENING_PLAYER_PROPS_S3_PREFIX,
  PLAYER_UPSERT_BATCH_SIZE,
  buildGameOddsServingDataset,
  buildPlayerServingDataset,
  consensusCoverageFromPlayerRows,
  extractProviderRows,
  finiteNumber,
  gameIdFromS3Key,
  isCanonicalGameArchiveObject,
  isMaterialCountMiss,
  meaningfulMovementRate,
  movementClassCounts,
  parseOpeningOdds,
  parseOpeningProp,
  type ClosingOddsRow,
  type ClosingProp,
  type GameServingRow,
  type OpeningOddsRow,
  type OpeningProp,
  type PlayerServingRow,
} from '@/lib/betting/market-movement-backfill';
import { readIngestionMode } from '@/lib/runtime/ingestion-mode';
import { getAnalyticsSeason } from '@/lib/season';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

type Json = Record<string, unknown>;

function parseMode(argv: string[]): { dryRun: boolean; execute: boolean; certify: boolean } {
  const execute = argv.includes('--execute');
  const certify = argv.includes('--certify');
  const dryRun = argv.includes('--dry-run') || (!execute && !certify);
  return { dryRun, execute, certify };
}

function round(n: number | null | undefined, d = 2): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  const p = 10 ** d;
  return Math.round(n * p) / p;
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await fn(items[i]!);
    }
  }
  const n = Math.min(concurrency, Math.max(items.length, 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

async function listArchiveObjects(s3: S3Storage, prefix: string) {
  const objects: { key: string; size: number }[] = [];
  const p = prefix.endsWith('/') ? prefix : `${prefix}/`;
  for await (const o of s3.listByPrefix(p)) {
    if (!isCanonicalGameArchiveObject(o.key)) continue;
    objects.push({ key: o.key, size: o.size });
  }
  return objects;
}

const PLAYER_COLUMNS = [
  'game_id',
  'player_id',
  'player_name',
  'prop_type',
  'vendor',
  'vendor_raw',
  'reference_kind',
  'reference_line',
  'reference_over_odds',
  'reference_under_odds',
  'reference_timestamp',
  'comparison_kind',
  'comparison_line',
  'comparison_over_odds',
  'comparison_under_odds',
  'comparison_timestamp',
  'line_delta',
  'over_implied_probability_delta',
  'under_implied_probability_delta',
  'movement_class',
  'backfill_revision',
  'updated_at',
] as const;

function playerValues(row: PlayerServingRow): unknown[] {
  return [
    row.game_id,
    row.player_id,
    row.player_name,
    row.prop_type,
    row.vendor,
    row.vendor_raw,
    row.reference_kind,
    row.reference_line,
    row.reference_over_odds,
    row.reference_under_odds,
    row.reference_timestamp,
    row.comparison_kind,
    row.comparison_line,
    row.comparison_over_odds,
    row.comparison_under_odds,
    row.comparison_timestamp,
    row.line_delta,
    row.over_implied_probability_delta,
    row.under_implied_probability_delta,
    row.movement_class,
    row.backfill_revision,
    new Date().toISOString(),
  ];
}

const GAME_COLUMNS = [
  'game_id',
  'vendor',
  'vendor_raw',
  'outlier_class',
  'reference_kind',
  'certified_window_start',
  'certified_window_end',
  'reference_home_spread',
  'reference_home_spread_odds',
  'reference_away_spread',
  'reference_away_spread_odds',
  'reference_total',
  'reference_over_odds',
  'reference_under_odds',
  'reference_home_ml',
  'reference_away_ml',
  'reference_timestamp',
  'comparison_kind',
  'comparison_home_spread',
  'comparison_home_spread_odds',
  'comparison_away_spread',
  'comparison_away_spread_odds',
  'comparison_total',
  'comparison_over_odds',
  'comparison_under_odds',
  'comparison_home_ml',
  'comparison_away_ml',
  'comparison_timestamp',
  'spread_delta',
  'total_delta',
  'home_ml_implied_probability_delta',
  'away_ml_implied_probability_delta',
  'backfill_revision',
  'updated_at',
] as const;

function gameValues(row: GameServingRow): unknown[] {
  return [
    row.game_id,
    row.vendor,
    row.vendor_raw,
    row.outlier_class,
    row.reference_kind,
    row.certified_window_start,
    row.certified_window_end,
    row.reference_home_spread,
    row.reference_home_spread_odds,
    row.reference_away_spread,
    row.reference_away_spread_odds,
    row.reference_total,
    row.reference_over_odds,
    row.reference_under_odds,
    row.reference_home_ml,
    row.reference_away_ml,
    row.reference_timestamp,
    row.comparison_kind,
    row.comparison_home_spread,
    row.comparison_home_spread_odds,
    row.comparison_away_spread,
    row.comparison_away_spread_odds,
    row.comparison_total,
    row.comparison_over_odds,
    row.comparison_under_odds,
    row.comparison_home_ml,
    row.comparison_away_ml,
    row.comparison_timestamp,
    row.spread_delta,
    row.total_delta,
    row.home_ml_implied_probability_delta,
    row.away_ml_implied_probability_delta,
    row.backfill_revision,
    new Date().toISOString(),
  ];
}

function upsertSql(table: string, columns: readonly string[], conflict: string, batchLen: number): string {
  const width = columns.length;
  const placeholders = Array.from({ length: batchLen }, (_, i) => {
    const inner = columns.map((_, c) => `$${i * width + c + 1}`).join(', ');
    return `(${inner})`;
  }).join(', ');
  const updates = columns
    .filter((c) => c !== 'updated_at')
    .map((c) => `${c} = excluded.${c}`)
    .concat(['updated_at = now()'])
    .join(', ');
  return `insert into ${table} (${columns.join(', ')}) values ${placeholders} on conflict ${conflict} do update set ${updates}`;
}

async function upsertBatches(
  client: PoolClient,
  table: string,
  columns: readonly string[],
  conflict: string,
  rows: unknown[][],
  batchSize: number
): Promise<number> {
  let n = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const sql = upsertSql(table, columns, conflict, batch.length);
    await client.query(sql, batch.flat());
    n += batch.length;
  }
  return n;
}

async function main() {
  const { dryRun, execute, certify } = parseMode(process.argv.slice(2));
  const mode = readIngestionMode();
  const frozen = mode.dataMode === 'replay' && mode.offseason && mode.cronDryRun;
  const pin = getAnalyticsSeason();
  const lock = bdlAcquisitionLockStatus();
  const dbUrl = process.env.SUPABASE_DB_URL?.trim();
  if (!dbUrl) throw new Error('Set SUPABASE_DB_URL');
  if (!frozen || pin !== '2025') {
    throw new Error(
      `Safety stop: frozen=${frozen} pin=${pin} dataMode=${mode.dataMode}. No serving writes. No BDL.`
    );
  }
  if (lock.held) {
    throw new Error('Safety stop: BDL acquisition lock is held. Refusing to run.');
  }
  const bucket = process.env.NBA_DATA_BUCKET?.trim();
  if (!bucket) throw new Error('NBA_DATA_BUCKET is required for S3 reads (no BDL)');

  const useSsl = dbUrl.includes('supabase.co') || dbUrl.includes('pooler.supabase.com');
  const pool = new Pool({
    connectionString: dbUrl,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
    max: 1,
  });

  const report: Json = {
    step: '11C',
    mode: { dryRun, execute, certify },
    safety: {
      bdlHttp: 0,
      dataMode: mode.dataMode,
      offseasonMode: mode.offseason,
      cronDryRun: mode.cronDryRun,
      frozen,
      currentAnalyticsSeason: pin,
      acquisitionLockHeld: lock.held,
    },
    batch: { player: PLAYER_UPSERT_BATCH_SIZE, game: GAME_UPSERT_BATCH_SIZE, transaction: 'per-batch commit; idempotent upsert' },
    backfillRevision: MARKET_MOVEMENT_V1_BACKFILL_REVISION,
  };

  const client = await pool.connect();
  try {
    await client.query("set statement_timeout = '600000'");
    const before = await client.query<{
      db_bytes: string;
      pdl_n: string;
      pdl_games: string;
      pdl_sum: string;
      goh_n: string;
      goh_min: Date | null;
      ppc_n: string;
      pp_summary: string;
      gl_summary: string;
      player_mm: string;
      game_mm: string;
    }>(
      `select
         pg_database_size(current_database())::text as db_bytes,
         (select count(*)::text from research.prop_decision_lines) as pdl_n,
         (select count(distinct game_id)::text from research.prop_decision_lines) as pdl_games,
         (select coalesce(sum(odds_american),0)::text from research.prop_decision_lines) as pdl_sum,
         (select count(*)::text from analytics.game_odds_history) as goh_n,
         (select min(snapshot_at) from analytics.game_odds_history) as goh_min,
         (select count(*)::text from analytics.player_prop_current) as ppc_n,
         (select count(*)::text from analytics.player_prop_movement_summary) as pp_summary,
         (select count(*)::text from analytics.game_line_movement_summary) as gl_summary,
         (select count(*)::text from analytics.player_prop_market_movement) as player_mm,
         (select count(*)::text from analytics.game_odds_market_movement) as game_mm`
    );
    const b = before.rows[0]!;
    const dbBytesBefore = Number(b.db_bytes);
    report.sourceBefore = {
      dbBytes: dbBytesBefore,
      dbMb: round(dbBytesBefore / (1024 * 1024), 2),
      propDecisionLines: Number(b.pdl_n),
      propDecisionLineGames: Number(b.pdl_games),
      propDecisionOddsSum: b.pdl_sum,
      gameOddsHistory: Number(b.goh_n),
      gameOddsHistoryMin: b.goh_min,
      playerPropCurrent: Number(b.ppc_n),
      playerPropMovementSummary: Number(b.pp_summary),
      gameLineMovementSummary: Number(b.gl_summary),
      playerServing: Number(b.player_mm),
      gameServing: Number(b.game_mm),
    };
    if (execute && (Number(b.player_mm) !== 0 || Number(b.game_mm) !== 0)) {
      report.note = 'Serving tables were not empty; execute uses idempotent UPSERT scoped to historical v1 keys.';
    }
    if (execute && Number(b.player_mm) === 0 && Number(b.game_mm) !== 0) {
      throw new Error('Unexpected partial serving state before initial backfill');
    }

    const pdl = await client.query<{
      game_id: string;
      player_id: string;
      sportsbook: string;
      prop_type: string;
      side: string;
      line_value: string | number | null;
      odds_american: number | null;
      decision_at: Date | null;
    }>(
      `select game_id, player_id, sportsbook, prop_type, side, line_value, odds_american, decision_at
       from research.prop_decision_lines`
    );
    const closingProps: ClosingProp[] = pdl.rows.map((r) => ({
      gameId: String(r.game_id),
      playerId: String(r.player_id),
      vendor: String(r.sportsbook).trim().toLowerCase(),
      canonical: canonicalizePropType(r.prop_type),
      side: String(r.side).trim().toLowerCase(),
      line: finiteNumber(r.line_value),
      oddsAmerican: finiteNumber(r.odds_american),
      decisionAt: r.decision_at ? new Date(r.decision_at).toISOString() : null,
    }));

    const goh = await client.query<{
      game_id: string;
      vendor: string;
      home_spread: string | number | null;
      home_spread_odds: number | null;
      away_spread: string | number | null;
      away_spread_odds: number | null;
      total: string | number | null;
      over_odds: number | null;
      under_odds: number | null;
      home_moneyline: number | null;
      away_moneyline: number | null;
      snapshot_at: Date;
    }>(
      `select distinct on (h.game_id, lower(h.vendor))
         h.game_id,
         lower(h.vendor) as vendor,
         h.home_spread,
         h.home_spread_odds,
         h.away_spread,
         h.away_spread_odds,
         h.total,
         h.over_odds,
         h.under_odds,
         h.home_moneyline,
         h.away_moneyline,
         h.snapshot_at
       from analytics.game_odds_history h
       join analytics.games g on g.game_id = h.game_id
       where g.start_time is not null
         and h.snapshot_at <= g.start_time
       order by h.game_id, lower(h.vendor), h.snapshot_at desc`
    );
    const closingOdds: ClosingOddsRow[] = goh.rows.map((r) => ({
      gameId: String(r.game_id),
      vendor: String(r.vendor),
      homeSpread: finiteNumber(r.home_spread),
      homeSpreadOdds: finiteNumber(r.home_spread_odds),
      awaySpread: finiteNumber(r.away_spread),
      awaySpreadOdds: finiteNumber(r.away_spread_odds),
      total: finiteNumber(r.total),
      overOdds: finiteNumber(r.over_odds),
      underOdds: finiteNumber(r.under_odds),
      homeMl: finiteNumber(r.home_moneyline),
      awayMl: finiteNumber(r.away_moneyline),
      snapshotAt: r.snapshot_at ? new Date(r.snapshot_at).toISOString() : null,
    }));

    const s3 = new S3Storage({ bucket });
    const propObjects = await listArchiveObjects(s3, OPENING_PLAYER_PROPS_S3_PREFIX);
    const oddsObjects = await listArchiveObjects(s3, OPENING_GAME_ODDS_S3_PREFIX);

    const openingProps: OpeningProp[] = [];
    await mapPool(propObjects, 8, async (obj) => {
      const body = await s3.getJson(obj.key);
      const gid = gameIdFromS3Key(obj.key);
      for (const row of extractProviderRows(body)) {
        const parsed = parseOpeningProp(row as Record<string, unknown>, gid);
        if (parsed) openingProps.push(parsed);
      }
    });

    const openingOdds: OpeningOddsRow[] = [];
    await mapPool(oddsObjects, 8, async (obj) => {
      const body = await s3.getJson(obj.key);
      const gid = gameIdFromS3Key(obj.key);
      for (const row of extractProviderRows(body)) {
        const parsed = parseOpeningOdds(row as Record<string, unknown>, gid);
        if (parsed) openingOdds.push(parsed);
      }
    });

    const player = buildPlayerServingDataset({ openingProps, closingProps });
    const game = buildGameOddsServingDataset({ openingOdds, closingOdds });

    const joinOk =
      !isMaterialCountMiss(player.counts.productGradeMatched, CERTIFIED_PLAYER_PRODUCT_GRADE_MATCHES) &&
      !isMaterialCountMiss(player.counts.v1MatchedBeforeDedupe, CERTIFIED_PLAYER_V1_ALLOWLIST_MATCHES) &&
      !isMaterialCountMiss(game.matched.length, CERTIFIED_GAME_SPORTSBOOK_MATCHES) &&
      !isMaterialCountMiss(game.unmatched.length, CERTIFIED_GAME_UNMATCHED_SPORTSBOOK_ROWS);

    const unmatchedVendors = [...new Set(game.unmatched.map((r) => r.vendor))].sort();
    const classCounts = movementClassCounts(player.servingRows);
    const meaningful = meaningfulMovementRate(player.servingRows);

    report.sourceCertification = {
      playerOpeningObjects: propObjects.length,
      playerOpeningRows: player.counts.openingRows,
      expectedPlayerOpeningRows: CERTIFIED_PLAYER_OPENING_ROWS,
      expectedPlayerOpeningGames: CERTIFIED_PLAYER_OPENING_GAMES,
      pdlRows: closingProps.length,
      gameOpeningObjects: oddsObjects.length,
      gameOpeningRows: openingOdds.length,
      expectedGameOpeningRows: CERTIFIED_GAME_OPENING_ROWS,
      expectedGameOpeningGames: CERTIFIED_GAME_OPENING_GAMES,
    };
    report.dryRunCandidateCounts = {
      ...player.counts,
      expectedProductGrade: CERTIFIED_PLAYER_PRODUCT_GRADE_MATCHES,
      expectedV1Allowlist: CERTIFIED_PLAYER_V1_ALLOWLIST_MATCHES,
      allowlistNote:
        '7E 24,412 is four-book × all canonical props including blocks/steals/rebounds_assists. v1 insert is the 7-market allowlist (21,132).',
      gameSportsbookOpening: game.sportsbookOpen.length,
      expectedGameSportsbookOpening: CERTIFIED_GAME_SPORTSBOOK_OPENING_ROWS,
      gameMatched: game.matched.length,
      expectedGameMatched: CERTIFIED_GAME_SPORTSBOOK_MATCHES,
      gameUnmatched: game.unmatched.length,
      gameUnmatchedVendors: unmatchedVendors,
      predictionMarketOpening: game.predictionOpen.length,
      joinOk,
    };

    if (!joinOk) {
      console.log(JSON.stringify(report, null, 2));
      throw new Error('STOP: dry-run candidate counts differ materially from certified 7E baselines. No INSERT.');
    }

    if (execute) {
      const playerInserted = await upsertBatches(
        client,
        'analytics.player_prop_market_movement',
        PLAYER_COLUMNS,
        '(game_id, player_id, prop_type, vendor)',
        player.servingRows.map(playerValues),
        PLAYER_UPSERT_BATCH_SIZE
      );
      const gameInserted = await upsertBatches(
        client,
        'analytics.game_odds_market_movement',
        GAME_COLUMNS,
        '(game_id, vendor)',
        game.servingRows.map(gameValues),
        GAME_UPSERT_BATCH_SIZE
      );
      report.execute = { playerUpserted: playerInserted, gameUpserted: gameInserted };
    }

    if (execute || certify) {
      const after = await client.query<{
        db_bytes: string;
        player_n: string;
        game_n: string;
        player_bytes: string;
        game_bytes: string;
        pdl_n: string;
        pdl_sum: string;
        goh_n: string;
        ppc_n: string;
        pp_summary: string;
        gl_summary: string;
        player_live: string;
        game_live: string;
      }>(
        `select
           pg_database_size(current_database())::text as db_bytes,
           (select count(*)::text from analytics.player_prop_market_movement) as player_n,
           (select count(*)::text from analytics.game_odds_market_movement) as game_n,
           pg_total_relation_size('analytics.player_prop_market_movement')::text as player_bytes,
           pg_total_relation_size('analytics.game_odds_market_movement')::text as game_bytes,
           (select count(*)::text from research.prop_decision_lines) as pdl_n,
           (select coalesce(sum(odds_american),0)::text from research.prop_decision_lines) as pdl_sum,
           (select count(*)::text from analytics.game_odds_history) as goh_n,
           (select count(*)::text from analytics.player_prop_current) as ppc_n,
           (select count(*)::text from analytics.player_prop_movement_summary) as pp_summary,
           (select count(*)::text from analytics.game_line_movement_summary) as gl_summary,
           (select count(*)::text from analytics.player_prop_market_movement where comparison_kind = 'live_current') as player_live,
           (select count(*)::text from analytics.game_odds_market_movement where comparison_kind = 'live_current') as game_live`
      );
      const a = after.rows[0]!;
      const dbBytesAfter = Number(a.db_bytes);
      report.storage = {
        dbBytesBefore,
        dbBytesAfter,
        deltaBytes: dbBytesAfter - dbBytesBefore,
        deltaMb: round((dbBytesAfter - dbBytesBefore) / (1024 * 1024), 3),
        playerTableBytes: Number(a.player_bytes),
        gameTableBytes: Number(a.game_bytes),
      };
      report.sourceAfter = {
        propDecisionLines: Number(a.pdl_n),
        propDecisionOddsSum: a.pdl_sum,
        gameOddsHistory: Number(a.goh_n),
        playerPropCurrent: Number(a.ppc_n),
        playerPropMovementSummary: Number(a.pp_summary),
        gameLineMovementSummary: Number(a.gl_summary),
      };
      report.sourceImmutable =
        a.pdl_n === b.pdl_n &&
        a.pdl_sum === b.pdl_sum &&
        a.goh_n === b.goh_n &&
        a.ppc_n === b.ppc_n &&
        a.pp_summary === b.pp_summary &&
        a.gl_summary === b.gl_summary;
      report.liveCurrentRows = { player: Number(a.player_live), game: Number(a.game_live) };

      const vendorCounts = await client.query<{ vendor: string; n: string }>(
        `select vendor, count(*)::text as n from analytics.player_prop_market_movement group by vendor order by vendor`
      );
      const propCounts = await client.query<{ prop_type: string; n: string }>(
        `select prop_type, count(*)::text as n from analytics.player_prop_market_movement group by prop_type order by prop_type`
      );
      const classDb = await client.query<{ movement_class: string; n: string }>(
        `select movement_class, count(*)::text as n from analytics.player_prop_market_movement group by movement_class order by movement_class`
      );
      const gameCov = await client.query<{
        n: string;
        games: string;
        vendors: string;
        spread_n: string;
        total_n: string;
        home_ml_n: string;
        away_ml_n: string;
      }>(
        `select
           count(*)::text as n,
           count(distinct game_id)::text as games,
           count(distinct vendor)::text as vendors,
           count(*) filter (where comparison_home_spread is not null)::text as spread_n,
           count(*) filter (where comparison_total is not null)::text as total_n,
           count(*) filter (where comparison_home_ml is not null)::text as home_ml_n,
           count(*) filter (where comparison_away_ml is not null)::text as away_ml_n
         from analytics.game_odds_market_movement`
      );
      const idAudit = await client.query<{
        player_games_mapped: string;
        player_games_unmapped: string;
        player_ids_mapped: string;
        player_ids_unmapped: string;
        game_odds_mapped: string;
        game_odds_unmapped: string;
      }>(
        `select
           (select count(distinct m.game_id) from analytics.player_prop_market_movement m join analytics.games g on g.game_id = m.game_id)::text as player_games_mapped,
           (select count(distinct m.game_id) from analytics.player_prop_market_movement m left join analytics.games g on g.game_id = m.game_id where g.game_id is null)::text as player_games_unmapped,
           (select count(distinct m.player_id) from analytics.player_prop_market_movement m join analytics.players p on p.player_id = m.player_id)::text as player_ids_mapped,
           (select count(distinct m.player_id) from analytics.player_prop_market_movement m left join analytics.players p on p.player_id = m.player_id where p.player_id is null)::text as player_ids_unmapped,
           (select count(distinct m.game_id) from analytics.game_odds_market_movement m join analytics.games g on g.game_id = m.game_id)::text as game_odds_mapped,
           (select count(distinct m.game_id) from analytics.game_odds_market_movement m left join analytics.games g on g.game_id = m.game_id where g.game_id is null)::text as game_odds_unmapped`
      );

      report.playerBackfill = {
        total: Number(a.player_n),
        byVendor: Object.fromEntries(vendorCounts.rows.map((r) => [r.vendor, Number(r.n)])),
        byProp: Object.fromEntries(propCounts.rows.map((r) => [r.prop_type, Number(r.n)])),
        byClass: Object.fromEntries(classDb.rows.map((r) => [r.movement_class, Number(r.n)])),
        expectedVendors: [...PLAYER_PROP_V1_VENDORS],
        expectedProps: [...PLAYER_PROP_V1_PROP_TYPES],
      };
      report.movementDistribution = classCounts;
      report.meaningfulMovementRate = round(meaningful, 1);
      report.gameBackfill = {
        total: Number(a.game_n),
        ...Object.fromEntries(
          Object.entries(gameCov.rows[0] ?? {}).map(([k, v]) => [k, Number(v)])
        ),
      };
      report.identityAudit = idAudit.rows[0];
      report.consensusCoverage = consensusCoverageFromPlayerRows(player.servingRows);
      report.outliers = game.outliers;
      report.ambiguity = {
        groups: player.counts.ambiguousGroups,
        rows: player.counts.ambiguousRows,
        v1Groups: player.counts.v1AmbiguousGroups,
        v1Rows: player.counts.v1AmbiguousRows,
      };
      report.unmatchedV1Sample = player.unmatchedV1.slice(0, 8).map((r) => ({
        gameId: r.gameId,
        playerId: r.playerId,
        vendor: r.vendor,
        prop: r.canonical,
      }));
      report.unmatchedGameSample = game.unmatched.slice(0, 8).map((r) => ({
        gameId: r.gameId,
        vendor: r.vendor,
      }));

      const samples: Json[] = [];
      for (const cls of ['A', 'B', 'C', 'D'] as const) {
        const hit = player.servingRows.find((r) => r.movement_class === cls);
        if (hit) samples.push({ class: cls, row: hit });
      }
      const evenMarket = (() => {
        const groups = new Map<string, PlayerServingRow[]>();
        for (const r of player.servingRows) {
          const k = `${r.game_id}|${r.player_id}|${r.prop_type}`;
          const list = groups.get(k) ?? [];
          list.push(r);
          groups.set(k, list);
        }
        for (const [k, list] of groups) {
          const c = playerPropConsensus(list.map((r) => ({ vendor: r.vendor, line: r.comparison_line })));
          if (c.available && c.count === 2 && c.median !== c.min && c.median !== c.max) {
            return {
              key: k,
              books: list.map((r) => ({ vendor: r.vendor, line: r.comparison_line })),
              consensus: c,
              note: '26.0 consensus does not imply a sportsbook offered 26.0.',
            };
          }
        }
        for (const [k, list] of groups) {
          const c = playerPropConsensus(list.map((r) => ({ vendor: r.vendor, line: r.comparison_line })));
          if (c.available && c.count === 2) {
            return { key: k, books: list.map((r) => ({ vendor: r.vendor, line: r.comparison_line })), consensus: c };
          }
        }
        return null;
      })();
      report.reconciliationSamples = samples;
      report.consensusSamples = { evenSplitOrTwoBook: evenMarket };
    }

    report.dryRun = dryRun && !execute;
    console.log(JSON.stringify(report, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
