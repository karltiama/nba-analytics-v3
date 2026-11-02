/**
 * Archive-only recovery from raw.player_prop_snapshots_v2.
 * Rebuilds the existing envelope and uses the conditional put. It does not call the provider.
 * The game-run archive failure stays in place until the put succeeds and the bookkeeping update matches one row.
 */

import { getDbPool } from './db';
import { PlayerPropArchiveS3Store } from './s3-archive';
import {
  buildArchiveEnvelope,
  buildPlayerPropSnapshotArchiveKey,
  rowsFromNormalized,
  writeArchiveObject,
  type ArchivePutStore,
  type ArchiveWriteOutcome,
  type NormalizedPropLike,
} from './player-prop-snapshot-archive';

export const PULL_579_RECOVERY = {
  pullRunId: 579,
  gameId: '21717922',
  bdlGameId: 21717922,
  gameDate: '2026-10-21',
  season: 2026,
  expectedRawRows: 3043,
  expectedFetchedRows: 2613,
  snapshotAt: '2026-10-21T19:51:47.684Z',
  archiveError: 'UnknownError',
} as const;

export const PULL_579_ARCHIVE_SUCCESS_SQL = `
UPDATE raw.player_prop_game_runs
SET archive_status = 'archived',
    archive_error = NULL,
    archive_key = $1,
    rows_archived = 3043,
    archive_object_count = 1,
    archive_completed_at = now()
WHERE pull_run_id = 579
  AND game_id = '21717922'
  AND status = 'success'
  AND provider_attempts = 1
  AND rows_stored = 3043
  AND rows_fetched = 2613
  AND archive_status = 'failed'
  AND archive_error = 'UnknownError'
  AND rows_archived = 0
`;

export type RawSnapshotRecoveryRow = {
  game_id: number | string;
  player_id: number | string;
  player_name: string | null;
  team_id: number | string | null;
  sportsbook: string | null;
  prop_type: string | null;
  market_type: string | null;
  side: string | null;
  line_value: number | string | null;
  odds_american: number | string | null;
  odds_decimal: number | string | null;
  implied_probability: number | string | null;
  raw_json: unknown;
  provider_updated_at: Date | string | null;
  observed_at: Date | string | null;
  controller_enqueued_at: Date | string | null;
};

export function buildArchiveRecovery(args: {
  rows: RawSnapshotRecoveryRow[];
  expectedRows: number;
  pullRunId: number;
  gameId: string;
  bdlGameId: number;
  gameDate: string;
  season: number;
  gameStartTime: Date | string;
  rawPrefix?: string;
}): { key: string; envelope: ReturnType<typeof buildArchiveEnvelope> } {
  if (args.rows.length !== args.expectedRows) {
    throw new Error(`archive recovery expected ${args.expectedRows} raw rows, found ${args.rows.length}`);
  }
  if (args.rows.length === 0) throw new Error('archive recovery has no raw rows');
  const snapshotAt = sharedInstant(args.rows, (row) => row.controller_enqueued_at, 'controller_enqueued_at');
  const observedAt = sharedInstant(args.rows, (row) => row.observed_at, 'observed_at');
  const envelope = buildArchiveEnvelope({
    season: args.season,
    pullRunId: args.pullRunId,
    gameId: args.gameId,
    sourceGameId: args.bdlGameId,
    gameDate: args.gameDate,
    snapshotAt,
    gameStartTime: args.gameStartTime,
    rows: rowsFromNormalized({
      normalized: args.rows.map(toNormalized),
      analyticsGameId: args.gameId,
      pullRunId: args.pullRunId,
      snapshotAt,
      gameStartTime: args.gameStartTime,
      opponentId: null,
    }),
    observation: { observedAt, controllerEnqueuedAt: snapshotAt },
  });
  const key = buildPlayerPropSnapshotArchiveKey({
    rawPrefix: args.rawPrefix ?? 'raw',
    season: args.season,
    gameDate: args.gameDate,
    gameId: args.gameId,
    pullRunId: args.pullRunId,
    snapshotAt,
  });
  return { key, envelope };
}

export async function writeRecoveredArchive(args: {
  store: ArchivePutStore;
  rows: RawSnapshotRecoveryRow[];
  expectedRows: number;
  pullRunId: number;
  gameId: string;
  bdlGameId: number;
  gameDate: string;
  season: number;
  gameStartTime: Date | string;
  rawPrefix?: string;
}): Promise<{ key: string; outcome: ArchiveWriteOutcome }> {
  const built = buildArchiveRecovery(args);
  const outcome = await writeArchiveObject({ store: args.store, key: built.key, envelope: built.envelope });
  return { key: built.key, outcome };
}

type GameRunArchiveState = {
  status: string;
  archive_status: string;
  archive_error: string | null;
  rows_stored: number;
  rows_fetched: number;
  provider_attempts: number;
};

export async function runPull579ArchiveRecovery(): Promise<{ key: string; outcome: ArchiveWriteOutcome }> {
  if (process.env.RECOVER_PULL_579 !== '1') {
    throw new Error('refusing pull 579 archive recovery without RECOVER_PULL_579=1');
  }
  const dbUrl = process.env.SUPABASE_DB_URL?.trim();
  const bucket = process.env.NBA_DATA_BUCKET?.trim();
  if (!dbUrl) throw new Error('Missing SUPABASE_DB_URL');
  if (!bucket) throw new Error('Missing NBA_DATA_BUCKET');
  const pool = getDbPool(dbUrl);
  const run = await pool.query<GameRunArchiveState>(
    `SELECT status, archive_status, archive_error, rows_stored, rows_fetched, provider_attempts
     FROM raw.player_prop_game_runs
     WHERE pull_run_id = $1 AND game_id = $2`,
    [PULL_579_RECOVERY.pullRunId, PULL_579_RECOVERY.gameId]
  );
  const gameRun = run.rows[0];
  if (!gameRun || gameRun.status !== 'success' || gameRun.archive_status !== 'failed' || gameRun.archive_error !== PULL_579_RECOVERY.archiveError) {
    throw new Error('pull 579 is not the unrecovered archive failure; no S3 write was attempted');
  }
  if (Number(gameRun.rows_stored) !== PULL_579_RECOVERY.expectedRawRows || Number(gameRun.provider_attempts) !== 1) {
    throw new Error('pull 579 row count or provider_attempts differs; no S3 write was attempted');
  }
  const game = await pool.query<{ start_time: Date; season: string }>(
    `SELECT start_time, season::text AS season FROM analytics.games WHERE game_id = $1`,
    [PULL_579_RECOVERY.gameId]
  );
  const tip = game.rows[0]?.start_time;
  if (!tip) throw new Error('pull 579 game tip is missing; no S3 write was attempted');
  const raw = await pool.query<RawSnapshotRecoveryRow>(
    `SELECT game_id, player_id, player_name, team_id, sportsbook, prop_type, market_type, side,
            line_value, odds_american, odds_decimal, implied_probability, raw_json,
            provider_updated_at, observed_at, controller_enqueued_at
     FROM raw.player_prop_snapshots_v2
     WHERE pull_run_id = $1 AND game_id = $2
     ORDER BY player_id, sportsbook, prop_type, side, line_value`,
    [PULL_579_RECOVERY.pullRunId, PULL_579_RECOVERY.bdlGameId]
  );
  const built = buildArchiveRecovery({
    rows: raw.rows,
    expectedRows: PULL_579_RECOVERY.expectedRawRows,
    pullRunId: PULL_579_RECOVERY.pullRunId,
    gameId: PULL_579_RECOVERY.gameId,
    bdlGameId: PULL_579_RECOVERY.bdlGameId,
    gameDate: PULL_579_RECOVERY.gameDate,
    season: Number(game.rows[0].season),
    gameStartTime: tip,
    rawPrefix: process.env.NBA_RAW_PREFIX,
  });
  if (new Date(built.envelope.snapshot_at).toISOString() !== new Date(PULL_579_RECOVERY.snapshotAt).toISOString()) {
    throw new Error('pull 579 controller clock does not match the preserved archive key; no S3 write was attempted');
  }
  const store = new PlayerPropArchiveS3Store({ bucket, region: process.env.AWS_REGION });
  const outcome = await writeArchiveObject({ store, key: built.key, envelope: built.envelope });
  if (!outcome.ok) {
    throw new Error(`pull 579 archive recovery did not write: ${outcome.message}`);
  }
  const updated = await pool.query(PULL_579_ARCHIVE_SUCCESS_SQL, [built.key]);
  if (updated.rowCount !== 1) {
    throw new Error(`pull 579 object is at ${built.key} but the archive bookkeeping update matched ${updated.rowCount ?? 0} rows`);
  }
  return { key: built.key, outcome };
}

function toNormalized(row: RawSnapshotRecoveryRow): NormalizedPropLike {
  return {
    game_id: finiteNumber(row.game_id, 'game_id'),
    player_id: finiteNumber(row.player_id, 'player_id'),
    player_name: row.player_name,
    team_id: row.team_id == null ? null : finiteNumber(row.team_id, 'team_id'),
    sportsbook: requiredText(row.sportsbook, 'sportsbook'),
    prop_type: requiredText(row.prop_type, 'prop_type'),
    market_type: requiredText(row.market_type, 'market_type'),
    side: requiredText(row.side, 'side'),
    line_value: row.line_value == null ? null : finiteNumber(row.line_value, 'line_value'),
    odds_american: finiteNumber(row.odds_american, 'odds_american'),
    odds_decimal: finiteNumber(row.odds_decimal, 'odds_decimal'),
    implied_probability: finiteNumber(row.implied_probability, 'implied_probability'),
    raw_json: row.raw_json ?? null,
    provider_updated_at: row.provider_updated_at == null ? null : new Date(row.provider_updated_at),
  };
}

function sharedInstant(
  rows: RawSnapshotRecoveryRow[],
  pick: (row: RawSnapshotRecoveryRow) => Date | string | null,
  label: string
): string {
  const first = instant(pick(rows[0]), label);
  for (const row of rows) {
    if (instant(pick(row), label) !== first) throw new Error(`archive recovery ${label} values disagree`);
  }
  return first;
}

function instant(value: Date | string | null, label: string): string {
  if (value == null) throw new Error(`archive recovery missing ${label}`);
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`archive recovery invalid ${label}`);
  return date.toISOString();
}

function finiteNumber(value: number | string | null, label: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`archive recovery invalid ${label}`);
  return parsed;
}

function requiredText(value: string | null, label: string): string {
  if (!value) throw new Error(`archive recovery missing ${label}`);
  return value;
}

if (require.main === module) {
  runPull579ArchiveRecovery()
    .then((result) => {
      const disposition = result.outcome.ok ? result.outcome.result : 'failed';
      console.log(JSON.stringify({ key: result.key, result: disposition }));
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : 'pull 579 archive recovery failed');
      process.exitCode = 1;
    });
}
