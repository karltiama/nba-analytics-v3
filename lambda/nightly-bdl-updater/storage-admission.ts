/**
 * Scheduled nightly admission.
 * The operation kind is fixed in this module. A Lambda event cannot supply it.
 * The pre-fetch bound is the largest slate the scheduled window will submit.
 * The post-fetch check measures the JSON actually about to be written.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

import {
  decideStoredStorageWrite,
  type ClusterMeasurementReader,
} from '../../lib/ops/cluster-measurement-access';
import {
  CLUSTER_MEASUREMENT_TABLE_NAME,
  createClusterMeasurementDynamoReader,
} from '../../lib/ops/cluster-measurement-dynamo';
import {
  CURRENT_SEASON_BOX_OPERATION_CAP_BYTES,
  type StorageWriteDecision,
} from '../../lib/ops/storage-budget';
import type { AdmissionMeasurement, StorageReservationStore } from '../../lib/ops/storage-admission';
import {
  createDynamoStorageReservationStore,
  STORAGE_RESERVATION_TABLE_NAME,
} from '../../lib/ops/storage-reservation-dynamo';
import { collectClusterMeasurement } from '../../lib/ops/cluster-measurement';
import { createClusterMeasurementPgLeasor } from '../../lib/ops/cluster-measurement-pg';
import { createLambdaPgPool } from '../../lib/runtime/lambda-pg-pool';
import {
  INJURY_MAX_ROWS,
  NIGHTLY_MAX_CLOCK,
  NIGHTLY_MAX_FINAL_GAMES,
  NIGHTLY_MAX_FORWARD_DAYS,
  NIGHTLY_MAX_GAME_JSON_BYTES,
  NIGHTLY_MAX_NAME,
  NIGHTLY_MAX_PLAYER_JSON_BYTES,
  NIGHTLY_MAX_PLAYERS_PER_GAME,
  NIGHTLY_MAX_SCHEDULE_GAMES,
  NIGHTLY_MAX_STAT_LINES,
  NIGHTLY_MAX_STATUS,
  NIGHTLY_MAX_TEAM_JSON_BYTES,
  NIGHTLY_MAX_VENUE,
} from '../../lib/ops/storage-growth-bounds';
import { normalizedPlayerGameStatsEnabled } from './player-game-stat-documents';

export const NIGHTLY_STORAGE_KIND = 'current_season_ingestion' as const;

/** Regular-season maximum games on one ET date. */
export const NIGHTLY_GAMES_PER_DATE = 15;
/** Two 15-player lists. The stored season average is 27 lines. */
export const NIGHTLY_PLAYERS_PER_GAME = 30;
export const NIGHTLY_BOX_DATES = 2;
export const NIGHTLY_TEAMS = 30;

const SCALAR_BYTES = 16;
const JSON_DOCUMENT_BYTES = 256;

export type NightlyAdmissionDeps = {
  measurementReader: ClusterMeasurementReader;
  now: string;
  /** Omitted in production until the reservation table is injected. */
  reservations?: StorageReservationStore;
  invocationId?: string;
  observedDatabaseGrowth?: { beforeBytes: number; afterBytes: number } | null;
  /** Production measures PostgreSQL directly. Tests keep the injected reader. */
  measureCluster?: () => Promise<AdmissionMeasurement>;
  /** Scheduled production wiring. An explicit recovery payload must not write. */
  productionAdmission?: boolean;
};

/** One games query. Five pages of 100 is more than the 240-game schedule envelope. */
export const NIGHTLY_MAX_PAGES_PER_QUERY = 5;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function ymdMs(value: string): number | null {
  if (!YMD.test(value)) return null;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) return null;
  return parsed;
}

/**
 * The scheduled invocation reads yesterday and today for finals, and today
 * through the forward window for the slate. A wider span is a catch-up and
 * must not write.
 */
export function scheduledNightlyWindowRefusal(input: {
  yesterdayEt: string;
  todayEt: string;
  scheduleEndEt: string;
  forwardDays: number;
}): string | null {
  const yesterday = ymdMs(input.yesterdayEt);
  const today = ymdMs(input.todayEt);
  const scheduleEnd = ymdMs(input.scheduleEndEt);
  if (yesterday == null || today == null || scheduleEnd == null) {
    return 'nightly date window is not a calendar day';
  }
  if (today - yesterday !== 86_400_000) {
    return 'nightly box window is not yesterday and today';
  }
  if (!Number.isInteger(input.forwardDays) || input.forwardDays < 0 || input.forwardDays > NIGHTLY_MAX_FORWARD_DAYS) {
    return `nightly forward window exceeds the physical envelope of ${NIGHTLY_MAX_FORWARD_DAYS} days`;
  }
  if (scheduleEnd !== today + input.forwardDays * 86_400_000) {
    return 'nightly schedule window is outside the approved forward range';
  }
  return null;
}

const NIGHTLY_MEASUREMENT_SOURCE = 'nightly-bdl-updater:pg_database';

function unusableNightlyMeasurement(): AdmissionMeasurement {
  return {
    clusterBytes: null,
    measuredAt: null,
    source: NIGHTLY_MEASUREMENT_SOURCE,
    valid: false,
    complete: false,
  };
}

export function wireProductionNightly(
  env: NodeJS.ProcessEnv,
  context?: { awsRequestId?: string }
): NightlyAdmissionDeps {
  const now = new Date().toISOString();
  const table = (env.STORAGE_RESERVATION_TABLE ?? '').trim();
  const invocationId = context?.awsRequestId?.trim() ?? '';
  const refused: NightlyAdmissionDeps = {
    now,
    measurementReader: productionMeasurementReader(env),
  };
  if (table !== STORAGE_RESERVATION_TABLE_NAME || invocationId === '' || !(env.SUPABASE_DB_URL ?? '').trim()) {
    return refused;
  }
  let reservations: StorageReservationStore;
  try {
    reservations = createDynamoStorageReservationStore(new DynamoDBClient({}), table);
  } catch {
    return refused;
  }
  const measureCluster = async (): Promise<AdmissionMeasurement> => {
    const pool = createLambdaPgPool(env);
    try {
      const lease = await createClusterMeasurementPgLeasor(pool).acquire();
      const collected = await collectClusterMeasurement(lease);
      if (!collected.valid || collected.clusterBytes == null || !collected.databaseObservedAt) {
        return unusableNightlyMeasurement();
      }
      return {
        clusterBytes: collected.clusterBytes,
        measuredAt: new Date().toISOString(),
        databaseObservedAt: collected.databaseObservedAt,
        source: NIGHTLY_MEASUREMENT_SOURCE,
        valid: true,
        complete: true,
      };
    } catch {
      return unusableNightlyMeasurement();
    } finally {
      await pool.end();
    }
  };
  return {
    now,
    invocationId,
    reservations,
    productionAdmission: true,
    measurementReader: refused.measurementReader,
    measureCluster,
  };
}

export const NIGHTLY_ADMISSION_TABLES = [
  'raw.games',
  'raw.game_period_scores',
  'raw.player_game_stat_document',
  'raw.player_game_stats_row',
  'raw.players',
  'analytics.players',
  'analytics.games',
  'analytics.player_game_logs',
  'analytics.team_game_stats',
  'analytics.team_season_averages',
  'analytics.player_season_averages',
  'analytics.player_period_scoring',
] as const;

function tooLong(value: unknown, max: number): boolean {
  return typeof value === 'string' && value.length > max;
}

/** Row and field caps for one scheduled invocation. A passing JSON estimate is not enough. */
export function nightlyBatchRefusal(input: {
  scheduleGames: readonly Record<string, unknown>[];
  finalGames: readonly Record<string, unknown>[];
  stats: readonly Record<string, unknown>[];
}): string | null {
  if (input.scheduleGames.length > NIGHTLY_MAX_SCHEDULE_GAMES || input.finalGames.length > NIGHTLY_MAX_FINAL_GAMES) {
    return `nightly batch exceeds the physical envelope of ${NIGHTLY_MAX_SCHEDULE_GAMES} schedule games and ${NIGHTLY_MAX_FINAL_GAMES} final games`;
  }
  if (input.stats.length > NIGHTLY_MAX_STAT_LINES) {
    return `nightly batch exceeds the physical envelope of ${NIGHTLY_MAX_STAT_LINES} stat lines`;
  }
  const linesByGame = new Map<string, number>();
  for (const stat of input.stats) {
    const game = stat.game;
    const gameId = game != null && typeof game === 'object' ? String((game as { id?: unknown }).id ?? '') : '';
    linesByGame.set(gameId, (linesByGame.get(gameId) ?? 0) + 1);
    if (tooLong(stat.min, NIGHTLY_MAX_CLOCK)) return 'nightly stat minute string exceeds the physical envelope';
    const documentCaps = { player: NIGHTLY_MAX_PLAYER_JSON_BYTES, team: NIGHTLY_MAX_TEAM_JSON_BYTES, game: NIGHTLY_MAX_GAME_JSON_BYTES };
    for (const field of ['player', 'team', 'game'] as const) {
      if (stat[field] != null && jsonUtf8Bytes(stat[field]) > documentCaps[field]) {
        return 'nightly stat document exceeds the physical envelope';
      }
    }
  }
  for (const count of linesByGame.values()) {
    if (count > NIGHTLY_MAX_PLAYERS_PER_GAME) {
      return `nightly batch exceeds the physical envelope of ${NIGHTLY_MAX_PLAYERS_PER_GAME} players per game`;
    }
  }
  for (const game of [...input.scheduleGames, ...input.finalGames]) {
    if (tooLong(game.status, NIGHTLY_MAX_STATUS) || tooLong(game.time, NIGHTLY_MAX_CLOCK) || tooLong(game.period_detail, NIGHTLY_MAX_STATUS)) {
      return 'nightly game field exceeds the physical envelope';
    }
    if (tooLong(game.venue, NIGHTLY_MAX_VENUE)) return 'nightly venue exceeds the physical envelope';
    if (
      (game.home_team != null && jsonUtf8Bytes(game.home_team) > NIGHTLY_MAX_TEAM_JSON_BYTES) ||
      (game.visitor_team != null && jsonUtf8Bytes(game.visitor_team) > NIGHTLY_MAX_TEAM_JSON_BYTES)
    ) {
      return 'nightly team document exceeds the physical envelope';
    }
    for (const side of ['home_team', 'visitor_team'] as const) {
      const team = game[side];
      if (team != null && typeof team === 'object') {
        const name = (team as { full_name?: unknown; name?: unknown }).full_name ?? (team as { name?: unknown }).name;
        if (tooLong(name, NIGHTLY_MAX_NAME)) return 'nightly team name exceeds the physical envelope';
      }
    }
  }
  return null;
}

export { NIGHTLY_MAX_FORWARD_DAYS, INJURY_MAX_ROWS };

export function scheduledNormalizedStorageEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return normalizedPlayerGameStatsEnabled(env);
}

/**
 * Bytes the scheduled window can submit before the provider responds.
 * Schedule dates are today through the forward window. Box dates are yesterday
 * and today. Yesterday is the one date outside a forward window that starts today.
 * Each figure is the upsert parameter list: scalars at 16 bytes and each JSON
 * document the writer stringifies at 256 bytes.
 */
export function estimateNightlyWindowPayloadBytes(forwardDays: number): number {
  const forward = Number.isFinite(forwardDays)
    ? Math.min(120, Math.max(0, Math.floor(forwardDays)))
    : 14;
  const scheduleDates = forward === 0 ? 0 : 1 + forward;
  const uniqueDates = forward === 0 ? NIGHTLY_BOX_DATES : scheduleDates + 1;
  const games = uniqueDates * NIGHTLY_GAMES_PER_DATE;
  const boxGames = NIGHTLY_BOX_DATES * NIGHTLY_GAMES_PER_DATE;
  const lines = boxGames * NIGHTLY_PLAYERS_PER_GAME;
  const rawGame = 11 * SCALAR_BYTES + 2 * JSON_DOCUMENT_BYTES;
  const analyticsGame = 9 * SCALAR_BYTES;
  const stat = 24 * SCALAR_BYTES + 3 * JSON_DOCUMENT_BYTES;
  const log = 24 * SCALAR_BYTES;
  const teamStat = 40 * SCALAR_BYTES;
  const seasonAverage = 14 * SCALAR_BYTES;
  const periodLine = 8 * SCALAR_BYTES;
  return (
    games * (rawGame + analyticsGame) +
    lines * (stat + log + periodLine) +
    boxGames * 2 * teamStat +
    (NIGHTLY_TEAMS + lines) * seasonAverage
  );
}

export function jsonUtf8Bytes(value: unknown): number {
  try {
    const text = JSON.stringify(value);
    if (typeof text !== 'string') return CURRENT_SEASON_BOX_OPERATION_CAP_BYTES + 1;
    return Buffer.byteLength(text);
  } catch {
    return CURRENT_SEASON_BOX_OPERATION_CAP_BYTES + 1;
  }
}

/** Provider JSON about to be written, measured after fetch and before any upsert. */
export function submittedNightlyBytes(scheduleGames: unknown, stats: unknown): number {
  return jsonUtf8Bytes(scheduleGames) + jsonUtf8Bytes(stats);
}

export async function admitNightlyStorage(input: {
  reader: ClusterMeasurementReader;
  now: string;
  estimatedPayloadBytes: number;
}): Promise<StorageWriteDecision> {
  return decideStoredStorageWrite({
    reader: input.reader,
    kind: NIGHTLY_STORAGE_KIND,
    now: input.now,
    payload: { estimatedPayloadBytes: input.estimatedPayloadBytes },
  });
}

export function productionMeasurementReader(env: NodeJS.ProcessEnv = process.env): ClusterMeasurementReader {
  const configured = env.STORAGE_MEASUREMENT_TABLE_NAME;
  const table = typeof configured === 'string' && configured.trim() !== ''
    ? configured.trim()
    : CLUSTER_MEASUREMENT_TABLE_NAME;
  return createClusterMeasurementDynamoReader(new DynamoDBClient({}), table);
}
