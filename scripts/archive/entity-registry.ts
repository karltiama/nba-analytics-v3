/**
 * Declarative registry of entities to archive from Postgres to S3.
 *
 * Each entry owns its own SQL so the orchestrator stays small and the SQL
 * stays auditable. Read-only against Postgres (SELECTs only).
 *
 * Design notes:
 * - Partitioned entities expose `listPartitions` and key by ET calendar date
 *   (matching existing lambdas / scripts which all use America/New_York).
 * - Pagination is keyset over a stable indexed column per entity. Cursors are
 *   opaque values produced/consumed by `fetchBatch` itself.
 * - Season scoping:
 *     * Tables with a `season` column or a join to `analytics.games` filter directly.
 *     * Append-only "raw" tables (`raw.player_prop_snapshots_v2`, etc.) scope by
 *       `<timestamp_col> within [seasonStart, seasonEnd]` using SeasonContext.
 *     * Static dimensions (teams, players) and "_current" snapshot tables are
 *       season-independent.
 */

import type { Pool } from 'pg';

export type SeasonContext = {
  /** Season label as stored in `analytics.games.season` (numeric label, e.g. 2025 for 2025-26 NBA season). */
  season: number;
  /** Earliest ET calendar date covered by this season's games (YYYY-MM-DD). */
  seasonStart: string;
  /** Latest ET calendar date covered by this season's games (YYYY-MM-DD). */
  seasonEnd: string;
};

export type FetchBatchResult = {
  rows: unknown[];
  nextCursor: unknown | null;
};

export type EntityDef = {
  /** Stable name used in S3 key `entity=<...>`. */
  entity: string;
  /** Human-readable source table reference (recorded in manifest). */
  sourceTable: string;
  /** Whether to write a single `data.jsonl` or `dt=YYYY-MM-DD/data.jsonl` files. */
  partitionStrategy: 'none' | 'date';
  /** Documentation only - column used to derive the dt partition (or null). */
  partitionColumn?: string;
  /** Documentation only - column(s) used for keyset pagination. */
  paginationKey: string;
  /** Whether the entity is scoped to the requested season. */
  seasonScoped: boolean;
  /** Free-form notes recorded in the manifest. */
  notes?: string;

  /**
   * Returns an ordered, distinct list of partition keys (`YYYY-MM-DD`) in scope.
   * Required when `partitionStrategy === 'date'`.
   */
  listPartitions?: (db: Pool, ctx: SeasonContext) => Promise<string[]>;
  /** Total rows for a partition (or for the whole entity when `partition === null`). */
  countRows: (db: Pool, ctx: SeasonContext, partition: string | null) => Promise<number>;
  /** Fetch the next batch of rows for a partition using keyset pagination. */
  fetchBatch: (
    db: Pool,
    ctx: SeasonContext,
    partition: string | null,
    cursor: unknown | null,
    batchSize: number
  ) => Promise<FetchBatchResult>;
};

/**
 * ET calendar-date expression used everywhere we partition by game day.
 * Mirrors `compute-team-stats.ts` and the lambdas that schedule by ET.
 */
const ET_DATE = (col: string) =>
  `(${col} AT TIME ZONE 'America/New_York')::date`;

const SEASON_TEXT = (col = 'season') => `${col} = $1::text`;

async function scalarCount(
  db: Pool,
  sql: string,
  params: unknown[]
): Promise<number> {
  const r = await db.query<{ count: string }>(sql, params);
  return Number(r.rows[0]?.count ?? 0);
}

async function listDistinctPartitions(
  db: Pool,
  sql: string,
  params: unknown[]
): Promise<string[]> {
  const r = await db.query<{ dt: string }>(sql, params);
  return r.rows.map((row) => row.dt);
}

/* ---------------------------------------------------------------------------
 * Static dimensions (no partition, no season filter)
 * -------------------------------------------------------------------------*/

const teams: EntityDef = {
  entity: 'teams',
  sourceTable: 'analytics.teams',
  partitionStrategy: 'none',
  paginationKey: 'team_id',
  seasonScoped: false,
  notes: 'Static dimension; archived in full regardless of season.',
  countRows: (db) => scalarCount(db, 'select count(*)::text as count from analytics.teams', []),
  fetchBatch: async (db, _ctx, _part, cursor, batchSize) => {
    const lastId = (cursor as string | null) ?? '';
    const r = await db.query(
      `select * from analytics.teams
       where team_id > $1
       order by team_id
       limit $2`,
      [lastId, batchSize]
    );
    const rows = r.rows;
    const nextCursor =
      rows.length === batchSize ? (rows[rows.length - 1] as { team_id: string }).team_id : null;
    return { rows, nextCursor };
  },
};

const players: EntityDef = {
  entity: 'players',
  sourceTable: 'analytics.players',
  partitionStrategy: 'none',
  paginationKey: 'player_id',
  seasonScoped: false,
  notes: 'Static dimension; archived in full regardless of season.',
  countRows: (db) => scalarCount(db, 'select count(*)::text as count from analytics.players', []),
  fetchBatch: async (db, _ctx, _part, cursor, batchSize) => {
    const lastId = (cursor as string | null) ?? '';
    const r = await db.query(
      `select * from analytics.players
       where player_id > $1
       order by player_id
       limit $2`,
      [lastId, batchSize]
    );
    const rows = r.rows;
    const nextCursor =
      rows.length === batchSize ? (rows[rows.length - 1] as { player_id: string }).player_id : null;
    return { rows, nextCursor };
  },
};

/* ---------------------------------------------------------------------------
 * Season-scoped, date-partitioned by game ET date
 * -------------------------------------------------------------------------*/

const games: EntityDef = {
  entity: 'games',
  sourceTable: 'analytics.games',
  partitionStrategy: 'date',
  partitionColumn: `${ET_DATE('start_time')}`,
  paginationKey: 'game_id',
  seasonScoped: true,
  notes: `Partitioned by ${ET_DATE('start_time')}.`,
  listPartitions: (db, ctx) =>
    listDistinctPartitions(
      db,
      `select distinct to_char(${ET_DATE('start_time')}, 'YYYY-MM-DD') as dt
       from analytics.games
       where ${SEASON_TEXT('season')} and start_time is not null
       order by 1`,
      [String(ctx.season)]
    ),
  countRows: (db, ctx, partition) =>
    scalarCount(
      db,
      `select count(*)::text as count from analytics.games
       where ${SEASON_TEXT('season')} and ${ET_DATE('start_time')} = $2::date`,
      [String(ctx.season), partition]
    ),
  fetchBatch: async (db, ctx, partition, cursor, batchSize) => {
    const lastId = (cursor as string | null) ?? '';
    const r = await db.query(
      `select * from analytics.games
       where ${SEASON_TEXT('season')}
         and ${ET_DATE('start_time')} = $2::date
         and game_id > $3
       order by game_id
       limit $4`,
      [String(ctx.season), partition, lastId, batchSize]
    );
    const rows = r.rows;
    const nextCursor =
      rows.length === batchSize ? (rows[rows.length - 1] as { game_id: string }).game_id : null;
    return { rows, nextCursor };
  },
};

const playerGameLogs: EntityDef = {
  entity: 'player_game_logs',
  sourceTable: 'analytics.player_game_logs',
  partitionStrategy: 'date',
  partitionColumn: `analytics.games.${ET_DATE('start_time')} (joined)`,
  paginationKey: '(game_id, player_id)',
  seasonScoped: true,
  notes:
    'Box score logs from BDL ingestion. Partitioned by ET game date via join to analytics.games.',
  listPartitions: (db, ctx) =>
    listDistinctPartitions(
      db,
      `select distinct to_char(${ET_DATE('g.start_time')}, 'YYYY-MM-DD') as dt
       from analytics.player_game_logs pgl
       join analytics.games g on g.game_id = pgl.game_id
       where g.season = $1::text and g.start_time is not null
       order by 1`,
      [String(ctx.season)]
    ),
  countRows: (db, ctx, partition) =>
    scalarCount(
      db,
      `select count(*)::text as count
       from analytics.player_game_logs pgl
       join analytics.games g on g.game_id = pgl.game_id
       where g.season = $1::text and ${ET_DATE('g.start_time')} = $2::date`,
      [String(ctx.season), partition]
    ),
  fetchBatch: async (db, ctx, partition, cursor, batchSize) => {
    const c = (cursor as { game_id: string; player_id: string } | null) ?? {
      game_id: '',
      player_id: '',
    };
    const r = await db.query(
      `select pgl.*
       from analytics.player_game_logs pgl
       join analytics.games g on g.game_id = pgl.game_id
       where g.season = $1::text
         and ${ET_DATE('g.start_time')} = $2::date
         and (pgl.game_id, pgl.player_id) > ($3, $4)
       order by pgl.game_id, pgl.player_id
       limit $5`,
      [String(ctx.season), partition, c.game_id, c.player_id, batchSize]
    );
    const rows = r.rows as Array<{ game_id: string; player_id: string }>;
    const nextCursor =
      rows.length === batchSize
        ? { game_id: rows[rows.length - 1].game_id, player_id: rows[rows.length - 1].player_id }
        : null;
    return { rows, nextCursor };
  },
};

const teamGameStats: EntityDef = {
  entity: 'team_game_stats',
  sourceTable: 'analytics.team_game_stats',
  partitionStrategy: 'date',
  partitionColumn: 'game_date',
  paginationKey: '(game_id, team_id)',
  seasonScoped: true,
  notes: 'Has its own season + game_date columns; no join required.',
  listPartitions: (db, ctx) =>
    listDistinctPartitions(
      db,
      `select distinct to_char(game_date, 'YYYY-MM-DD') as dt
       from analytics.team_game_stats
       where ${SEASON_TEXT('season')} and game_date is not null
       order by 1`,
      [String(ctx.season)]
    ),
  countRows: (db, ctx, partition) =>
    scalarCount(
      db,
      `select count(*)::text as count from analytics.team_game_stats
       where ${SEASON_TEXT('season')} and game_date = $2::date`,
      [String(ctx.season), partition]
    ),
  fetchBatch: async (db, ctx, partition, cursor, batchSize) => {
    const c = (cursor as { game_id: string; team_id: string } | null) ?? {
      game_id: '',
      team_id: '',
    };
    const r = await db.query(
      `select * from analytics.team_game_stats
       where ${SEASON_TEXT('season')}
         and game_date = $2::date
         and (game_id, team_id) > ($3, $4)
       order by game_id, team_id
       limit $5`,
      [String(ctx.season), partition, c.game_id, c.team_id, batchSize]
    );
    const rows = r.rows as Array<{ game_id: string; team_id: string }>;
    const nextCursor =
      rows.length === batchSize
        ? { game_id: rows[rows.length - 1].game_id, team_id: rows[rows.length - 1].team_id }
        : null;
    return { rows, nextCursor };
  },
};

const teamSeasonAverages: EntityDef = {
  entity: 'team_season_averages',
  sourceTable: 'analytics.team_season_averages',
  partitionStrategy: 'none',
  paginationKey: 'team_id',
  seasonScoped: true,
  notes: 'One row per team for the requested season.',
  countRows: (db, ctx) =>
    scalarCount(
      db,
      `select count(*)::text as count from analytics.team_season_averages where ${SEASON_TEXT('season')}`,
      [String(ctx.season)]
    ),
  fetchBatch: async (db, ctx, _part, cursor, batchSize) => {
    const lastId = (cursor as string | null) ?? '';
    const r = await db.query(
      `select * from analytics.team_season_averages
       where ${SEASON_TEXT('season')} and team_id > $2
       order by team_id
       limit $3`,
      [String(ctx.season), lastId, batchSize]
    );
    const rows = r.rows;
    const nextCursor =
      rows.length === batchSize ? (rows[rows.length - 1] as { team_id: string }).team_id : null;
    return { rows, nextCursor };
  },
};

/* ---------------------------------------------------------------------------
 * "_current" snapshot tables: archive in full, no season filter
 * -------------------------------------------------------------------------*/

const injuriesCurrent: EntityDef = {
  entity: 'injuries_current',
  sourceTable: 'analytics.player_injury_status_current',
  partitionStrategy: 'none',
  paginationKey: 'player_id',
  seasonScoped: false,
  notes: 'Latest known injury state per player; one row per player.',
  countRows: (db) =>
    scalarCount(
      db,
      'select count(*)::text as count from analytics.player_injury_status_current',
      []
    ),
  fetchBatch: async (db, _ctx, _part, cursor, batchSize) => {
    const lastId = (cursor as string | null) ?? '';
    const r = await db.query(
      `select * from analytics.player_injury_status_current
       where player_id > $1
       order by player_id
       limit $2`,
      [lastId, batchSize]
    );
    const rows = r.rows;
    const nextCursor =
      rows.length === batchSize ? (rows[rows.length - 1] as { player_id: string }).player_id : null;
    return { rows, nextCursor };
  },
};

const oddsCurrent: EntityDef = {
  entity: 'odds_current',
  sourceTable: 'analytics.game_odds_current',
  partitionStrategy: 'none',
  paginationKey: 'game_id',
  seasonScoped: true,
  notes: 'Latest pre-game odds per game; filtered to games in the requested season.',
  countRows: (db, ctx) =>
    scalarCount(
      db,
      `select count(*)::text as count
       from analytics.game_odds_current goc
       join analytics.games g on g.game_id = goc.game_id
       where g.season = $1::text`,
      [String(ctx.season)]
    ),
  fetchBatch: async (db, ctx, _part, cursor, batchSize) => {
    const lastId = (cursor as string | null) ?? '';
    const r = await db.query(
      `select goc.* from analytics.game_odds_current goc
       join analytics.games g on g.game_id = goc.game_id
       where g.season = $1::text and goc.game_id > $2
       order by goc.game_id
       limit $3`,
      [String(ctx.season), lastId, batchSize]
    );
    const rows = r.rows;
    const nextCursor =
      rows.length === batchSize ? (rows[rows.length - 1] as { game_id: string }).game_id : null;
    return { rows, nextCursor };
  },
};

const playerPropsCurrent: EntityDef = {
  entity: 'player_props_current',
  sourceTable: 'analytics.player_props_current',
  partitionStrategy: 'none',
  paginationKey: 'id',
  seasonScoped: false,
  notes:
    'Latest prop lines (Prop Explorer source). Not season-scoped because the row uses an integer game_id and season is implicit; archive full snapshot.',
  countRows: (db) =>
    scalarCount(db, 'select count(*)::text as count from analytics.player_props_current', []),
  fetchBatch: async (db, _ctx, _part, cursor, batchSize) => {
    const lastId = (cursor as string | null) ?? '00000000-0000-0000-0000-000000000000';
    const r = await db.query(
      `select * from analytics.player_props_current
       where id > $1::uuid
       order by id
       limit $2`,
      [lastId, batchSize]
    );
    const rows = r.rows;
    const nextCursor =
      rows.length === batchSize ? String((rows[rows.length - 1] as { id: string }).id) : null;
    return { rows, nextCursor };
  },
};

/* ---------------------------------------------------------------------------
 * Append-only history tables: date-partitioned by snapshot/fetch ET date,
 * scoped to season window via timestamp range.
 * -------------------------------------------------------------------------*/

const injuriesHistory: EntityDef = {
  entity: 'injuries_history',
  sourceTable: 'analytics.player_injury_status_history',
  partitionStrategy: 'date',
  partitionColumn: `${ET_DATE('snapshot_at')}`,
  paginationKey: 'id',
  seasonScoped: true,
  notes: 'Filtered to snapshots within [seasonStart, seasonEnd] (ET).',
  listPartitions: (db, ctx) =>
    listDistinctPartitions(
      db,
      `select distinct to_char(${ET_DATE('snapshot_at')}, 'YYYY-MM-DD') as dt
       from analytics.player_injury_status_history
       where ${ET_DATE('snapshot_at')} between $1::date and $2::date
       order by 1`,
      [ctx.seasonStart, ctx.seasonEnd]
    ),
  countRows: (db, ctx, partition) =>
    scalarCount(
      db,
      `select count(*)::text as count from analytics.player_injury_status_history
       where ${ET_DATE('snapshot_at')} = $1::date
         and ${ET_DATE('snapshot_at')} between $2::date and $3::date`,
      [partition, ctx.seasonStart, ctx.seasonEnd]
    ),
  fetchBatch: async (db, ctx, partition, cursor, batchSize) => {
    const lastId = (cursor as number | null) ?? 0;
    const r = await db.query(
      `select * from analytics.player_injury_status_history
       where ${ET_DATE('snapshot_at')} = $1::date
         and ${ET_DATE('snapshot_at')} between $2::date and $3::date
         and id > $4
       order by id
       limit $5`,
      [partition, ctx.seasonStart, ctx.seasonEnd, lastId, batchSize]
    );
    const rows = r.rows as Array<{ id: number | string }>;
    const nextCursor =
      rows.length === batchSize ? Number(rows[rows.length - 1].id) : null;
    return { rows, nextCursor };
  },
};

const oddsHistory: EntityDef = {
  entity: 'odds_history',
  sourceTable: 'analytics.game_odds_history',
  partitionStrategy: 'date',
  partitionColumn: `${ET_DATE('snapshot_at')}`,
  paginationKey: 'id',
  seasonScoped: true,
  notes: 'Filtered via games join (game_id -> season) AND ET-date partition on snapshot_at.',
  listPartitions: (db, ctx) =>
    listDistinctPartitions(
      db,
      `select distinct to_char(${ET_DATE('goh.snapshot_at')}, 'YYYY-MM-DD') as dt
       from analytics.game_odds_history goh
       join analytics.games g on g.game_id = goh.game_id
       where g.season = $1::text
       order by 1`,
      [String(ctx.season)]
    ),
  countRows: (db, ctx, partition) =>
    scalarCount(
      db,
      `select count(*)::text as count
       from analytics.game_odds_history goh
       join analytics.games g on g.game_id = goh.game_id
       where g.season = $1::text
         and ${ET_DATE('goh.snapshot_at')} = $2::date`,
      [String(ctx.season), partition]
    ),
  fetchBatch: async (db, ctx, partition, cursor, batchSize) => {
    const lastId = (cursor as number | null) ?? 0;
    const r = await db.query(
      `select goh.* from analytics.game_odds_history goh
       join analytics.games g on g.game_id = goh.game_id
       where g.season = $1::text
         and ${ET_DATE('goh.snapshot_at')} = $2::date
         and goh.id > $3
       order by goh.id
       limit $4`,
      [String(ctx.season), partition, lastId, batchSize]
    );
    const rows = r.rows as Array<{ id: number | string }>;
    const nextCursor =
      rows.length === batchSize ? Number(rows[rows.length - 1].id) : null;
    return { rows, nextCursor };
  },
};

const playerPropsRawV2: EntityDef = {
  entity: 'player_props_raw_v2',
  sourceTable: 'raw.player_prop_snapshots_v2',
  partitionStrategy: 'date',
  partitionColumn: `${ET_DATE('fetched_at')}`,
  paginationKey: 'id (uuid)',
  seasonScoped: true,
  notes:
    'Raw BDL prop snapshots (v2). Uses fetched_at ET partition; scoped to [seasonStart, seasonEnd].',
  listPartitions: (db, ctx) =>
    listDistinctPartitions(
      db,
      `select distinct to_char(${ET_DATE('fetched_at')}, 'YYYY-MM-DD') as dt
       from raw.player_prop_snapshots_v2
       where ${ET_DATE('fetched_at')} between $1::date and $2::date
       order by 1`,
      [ctx.seasonStart, ctx.seasonEnd]
    ),
  countRows: (db, ctx, partition) =>
    scalarCount(
      db,
      `select count(*)::text as count from raw.player_prop_snapshots_v2
       where ${ET_DATE('fetched_at')} = $1::date
         and ${ET_DATE('fetched_at')} between $2::date and $3::date`,
      [partition, ctx.seasonStart, ctx.seasonEnd]
    ),
  fetchBatch: async (db, ctx, partition, cursor, batchSize) => {
    const lastId = (cursor as string | null) ?? '00000000-0000-0000-0000-000000000000';
    const r = await db.query(
      `select * from raw.player_prop_snapshots_v2
       where ${ET_DATE('fetched_at')} = $1::date
         and ${ET_DATE('fetched_at')} between $2::date and $3::date
         and id > $4::uuid
       order by id
       limit $5`,
      [partition, ctx.seasonStart, ctx.seasonEnd, lastId, batchSize]
    );
    const rows = r.rows;
    const nextCursor =
      rows.length === batchSize ? String((rows[rows.length - 1] as { id: string }).id) : null;
    return { rows, nextCursor };
  },
};

const rawPlayerInjuries: EntityDef = {
  entity: 'raw_player_injuries',
  sourceTable: 'raw.player_injuries',
  partitionStrategy: 'date',
  partitionColumn: `${ET_DATE('created_at')}`,
  paginationKey: 'snapshot_id',
  seasonScoped: true,
  notes: 'Raw BDL injury rows. Partitioned by created_at ET; scoped to season window.',
  listPartitions: (db, ctx) =>
    listDistinctPartitions(
      db,
      `select distinct to_char(${ET_DATE('created_at')}, 'YYYY-MM-DD') as dt
       from raw.player_injuries
       where ${ET_DATE('created_at')} between $1::date and $2::date
       order by 1`,
      [ctx.seasonStart, ctx.seasonEnd]
    ),
  countRows: (db, ctx, partition) =>
    scalarCount(
      db,
      `select count(*)::text as count from raw.player_injuries
       where ${ET_DATE('created_at')} = $1::date
         and ${ET_DATE('created_at')} between $2::date and $3::date`,
      [partition, ctx.seasonStart, ctx.seasonEnd]
    ),
  fetchBatch: async (db, ctx, partition, cursor, batchSize) => {
    const lastId = (cursor as number | null) ?? 0;
    const r = await db.query(
      `select * from raw.player_injuries
       where ${ET_DATE('created_at')} = $1::date
         and ${ET_DATE('created_at')} between $2::date and $3::date
         and snapshot_id > $4
       order by snapshot_id
       limit $5`,
      [partition, ctx.seasonStart, ctx.seasonEnd, lastId, batchSize]
    );
    const rows = r.rows as Array<{ snapshot_id: number | string }>;
    const nextCursor =
      rows.length === batchSize ? Number(rows[rows.length - 1].snapshot_id) : null;
    return { rows, nextCursor };
  },
};

const rawOddsSnapshots: EntityDef = {
  entity: 'raw_odds_snapshots',
  sourceTable: 'raw.odds_snapshots',
  partitionStrategy: 'date',
  partitionColumn: `${ET_DATE('created_at')}`,
  paginationKey: 'snapshot_id',
  seasonScoped: true,
  notes: 'Raw BDL game-odds rows. Partitioned by created_at ET; scoped to season window.',
  listPartitions: (db, ctx) =>
    listDistinctPartitions(
      db,
      `select distinct to_char(${ET_DATE('created_at')}, 'YYYY-MM-DD') as dt
       from raw.odds_snapshots
       where ${ET_DATE('created_at')} between $1::date and $2::date
       order by 1`,
      [ctx.seasonStart, ctx.seasonEnd]
    ),
  countRows: (db, ctx, partition) =>
    scalarCount(
      db,
      `select count(*)::text as count from raw.odds_snapshots
       where ${ET_DATE('created_at')} = $1::date
         and ${ET_DATE('created_at')} between $2::date and $3::date`,
      [partition, ctx.seasonStart, ctx.seasonEnd]
    ),
  fetchBatch: async (db, ctx, partition, cursor, batchSize) => {
    const lastId = (cursor as number | null) ?? 0;
    const r = await db.query(
      `select * from raw.odds_snapshots
       where ${ET_DATE('created_at')} = $1::date
         and ${ET_DATE('created_at')} between $2::date and $3::date
         and snapshot_id > $4
       order by snapshot_id
       limit $5`,
      [partition, ctx.seasonStart, ctx.seasonEnd, lastId, batchSize]
    );
    const rows = r.rows as Array<{ snapshot_id: number | string }>;
    const nextCursor =
      rows.length === batchSize ? Number(rows[rows.length - 1].snapshot_id) : null;
    return { rows, nextCursor };
  },
};

/* ---------------------------------------------------------------------------
 * Public registry
 * -------------------------------------------------------------------------*/

export const ENTITIES: readonly EntityDef[] = [
  teams,
  players,
  games,
  playerGameLogs,
  teamGameStats,
  teamSeasonAverages,
  injuriesCurrent,
  injuriesHistory,
  oddsCurrent,
  oddsHistory,
  playerPropsCurrent,
  playerPropsRawV2,
  rawPlayerInjuries,
  rawOddsSnapshots,
] as const;

export const ENTITY_NAMES = ENTITIES.map((e) => e.entity);

export function findEntity(name: string): EntityDef | undefined {
  return ENTITIES.find((e) => e.entity === name);
}
