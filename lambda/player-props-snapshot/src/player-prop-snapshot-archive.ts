/**
 * Durable player-prop snapshot archive (append-only S3).
 *
 * Canonical format used by the worker, prune gate, reader, and reconcile.
 * Do not write under source=existing_ingestion or entity=player_props_raw_v2.
 */

import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

export const PLAYER_PROP_SNAPSHOT_ARCHIVE_ENTITY = 'player_prop_snapshots';
export const PLAYER_PROP_SNAPSHOT_ARCHIVE_VERSION = 'player_prop_snapshots.v1';
export const PLAYER_PROP_SNAPSHOT_SOURCE = 'balldontlie';
export const PLAYER_PROP_SNAPSHOT_LEAGUE = 'nba';

/** Recovered 2025–26 dump. Immutable. Never write, rename, or delete. */
export const LEGACY_EXISTING_INGESTION_SOURCE = 'existing_ingestion';
export const LEGACY_PLAYER_PROPS_RAW_V2_ENTITY = 'player_props_raw_v2';
export const LEGACY_PROTECTED_PREFIX =
  'raw/source=existing_ingestion/league=nba/season=2025/entity=player_props_raw_v2';

export type ArchiveStatus = 'pending' | 'archived' | 'failed';
export type SnapshotTiming = 'pregame' | 'post_tip' | 'unknown';

export type ArchiveWriteOutcome =
  | { ok: true; result: 'written' | 'already_exists'; key: string; rowCount: number; checksum: string }
  | { ok: false; error: 'conflict' | 'protected_prefix' | 'write_failed'; message: string; key: string };

export type PlayerPropArchiveRow = {
  game_id: string;
  source_game_id: number | null;
  player_id: string;
  source_player_id: number | null;
  player_name: string | null;
  team_id: string | null;
  opponent_id: string | null;
  sportsbook: string;
  prop_type: string;
  market_type: string;
  side: string;
  line_value: number | null;
  odds_american: number | null;
  odds_decimal: number | null;
  implied_probability: number | null;
  snapshot_at: string;
  game_start_time: string | null;
  source: typeof PLAYER_PROP_SNAPSHOT_SOURCE;
  pull_run_id: number;
  game_run_id: string;
  provider_updated_at: string | null;
  raw_json: unknown;
};

export type PlayerPropArchiveEnvelope = {
  schemaVersion: 1;
  archiveVersion: typeof PLAYER_PROP_SNAPSHOT_ARCHIVE_VERSION;
  source: typeof PLAYER_PROP_SNAPSHOT_SOURCE;
  league: typeof PLAYER_PROP_SNAPSHOT_LEAGUE;
  season: number;
  pull_run_id: number;
  game_id: string;
  source_game_id: number | null;
  game_date: string;
  snapshot_at: string;
  game_start_time: string | null;
  timing: SnapshotTiming;
  row_count: number;
  checksum: string;
  rows: PlayerPropArchiveRow[];
};

export type ArchiveObjectIdentity = {
  rawPrefix?: string;
  season: number;
  gameDate: string;
  gameId: string;
  pullRunId: number;
  snapshotAt: Date | string;
};

export function nbaSeasonStartYearFromGameDate(gameDate: string): number {
  const y = Number(gameDate.slice(0, 4));
  const month = Number(gameDate.slice(5, 7));
  if (!Number.isFinite(y) || !Number.isFinite(month)) {
    throw new Error(`Invalid game_date: ${gameDate}`);
  }
  return month >= 8 ? y : y - 1;
}

export function compactUtcTimestamp(isoOrDate: Date | string): string {
  const iso = typeof isoOrDate === 'string' ? new Date(isoOrDate).toISOString() : isoOrDate.toISOString();
  return iso.replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');
}

export function normalizeRawPrefix(rawPrefix: string | undefined | null): string {
  const raw = (rawPrefix ?? 'raw').trim().replace(/^\/+|\/+$/g, '');
  return raw || 'raw';
}

export function playerPropSnapshotEntityPrefix(
  rawPrefix: string | undefined,
  season: number
): string {
  const raw = normalizeRawPrefix(rawPrefix);
  return (
    `${raw}/source=${PLAYER_PROP_SNAPSHOT_SOURCE}/league=${PLAYER_PROP_SNAPSHOT_LEAGUE}` +
    `/season=${season}/entity=${PLAYER_PROP_SNAPSHOT_ARCHIVE_ENTITY}`
  );
}

export function playerPropSnapshotGameDatePrefix(
  rawPrefix: string | undefined,
  season: number,
  gameDate: string
): string {
  return `${playerPropSnapshotEntityPrefix(rawPrefix, season)}/game_date=${gameDate}`;
}

export function playerPropSnapshotGamePrefix(
  rawPrefix: string | undefined,
  season: number,
  gameDate: string,
  gameId: string
): string {
  return `${playerPropSnapshotGameDatePrefix(rawPrefix, season, gameDate)}/game_id=${gameId}`;
}

export function buildPlayerPropSnapshotArchiveKey(id: ArchiveObjectIdentity): string {
  const snapshot = compactUtcTimestamp(id.snapshotAt);
  return (
    `${playerPropSnapshotGamePrefix(id.rawPrefix, id.season, id.gameDate, id.gameId)}` +
    `/snapshot_at=${snapshot}__pull=${id.pullRunId}.json.gz`
  );
}

export function isProtectedHistoricalKey(key: string): boolean {
  const n = key.replace(/\\/g, '/');
  return (
    n.includes(`/source=${LEGACY_EXISTING_INGESTION_SOURCE}/`) ||
    n.includes(`/entity=${LEGACY_PLAYER_PROPS_RAW_V2_ENTITY}/`) ||
    n.startsWith(LEGACY_PROTECTED_PREFIX) ||
    n.includes(LEGACY_PROTECTED_PREFIX)
  );
}

export function classifySnapshotTiming(
  snapshotAt: Date | string,
  gameStartTime: Date | string | null | undefined
): SnapshotTiming {
  if (gameStartTime == null) return 'unknown';
  const snap = typeof snapshotAt === 'string' ? Date.parse(snapshotAt) : snapshotAt.getTime();
  const start = typeof gameStartTime === 'string' ? Date.parse(gameStartTime) : gameStartTime.getTime();
  if (!Number.isFinite(snap) || !Number.isFinite(start)) return 'unknown';
  return snap < start ? 'pregame' : 'post_tip';
}

export function isValidPregameResearchSnapshot(
  snapshotAt: Date | string,
  gameStartTime: Date | string | null | undefined
): boolean {
  return classifySnapshotTiming(snapshotAt, gameStartTime) === 'pregame';
}

export function checksumCanonical(value: unknown): string {
  return createHash('sha256').update(stableStringify(value), 'utf8').digest('hex');
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) out[key] = sortValue(obj[key]);
    return out;
  }
  return value;
}

export function buildArchiveEnvelope(args: {
  season: number;
  pullRunId: number;
  gameId: string;
  sourceGameId: number | null;
  gameDate: string;
  snapshotAt: Date | string;
  gameStartTime: Date | string | null;
  rows: PlayerPropArchiveRow[];
}): PlayerPropArchiveEnvelope {
  const snapshotIso =
    typeof args.snapshotAt === 'string' ? new Date(args.snapshotAt).toISOString() : args.snapshotAt.toISOString();
  const startIso =
    args.gameStartTime == null
      ? null
      : typeof args.gameStartTime === 'string'
        ? new Date(args.gameStartTime).toISOString()
        : args.gameStartTime.toISOString();
  const body = {
    pull_run_id: args.pullRunId,
    game_id: args.gameId,
    rows: args.rows,
  };
  return {
    schemaVersion: 1,
    archiveVersion: PLAYER_PROP_SNAPSHOT_ARCHIVE_VERSION,
    source: PLAYER_PROP_SNAPSHOT_SOURCE,
    league: PLAYER_PROP_SNAPSHOT_LEAGUE,
    season: args.season,
    pull_run_id: args.pullRunId,
    game_id: args.gameId,
    source_game_id: args.sourceGameId,
    game_date: args.gameDate,
    snapshot_at: snapshotIso,
    game_start_time: startIso,
    timing: classifySnapshotTiming(snapshotIso, startIso),
    row_count: args.rows.length,
    checksum: checksumCanonical(body),
    rows: args.rows,
  };
}

export function gzipEnvelope(envelope: PlayerPropArchiveEnvelope): Buffer {
  return gzipSync(Buffer.from(`${JSON.stringify(envelope)}\n`, 'utf8'));
}

export function gunzipEnvelope(buf: Buffer): PlayerPropArchiveEnvelope {
  const text = gunzipSync(buf).toString('utf8');
  return JSON.parse(text) as PlayerPropArchiveEnvelope;
}

export type ArchiveObjectMeta = {
  checksum: string;
  rowCount: number;
  pullRunId: number;
  gameId: string;
  archiveVersion: string;
};

export function envelopeToObjectMeta(envelope: PlayerPropArchiveEnvelope): ArchiveObjectMeta {
  return {
    checksum: envelope.checksum,
    rowCount: envelope.row_count,
    pullRunId: envelope.pull_run_id,
    gameId: envelope.game_id,
    archiveVersion: envelope.archiveVersion,
  };
}

export function s3UserMetadata(meta: ArchiveObjectMeta): Record<string, string> {
  return {
    checksum: meta.checksum,
    'row-count': String(meta.rowCount),
    'pull-run-id': String(meta.pullRunId),
    'game-id': meta.gameId,
    'archive-version': meta.archiveVersion,
  };
}

export function parseS3UserMetadata(
  meta: Record<string, string> | undefined
): Partial<ArchiveObjectMeta> {
  if (!meta) return {};
  const rowCount = meta['row-count'] != null ? Number(meta['row-count']) : undefined;
  const pullRunId = meta['pull-run-id'] != null ? Number(meta['pull-run-id']) : undefined;
  return {
    checksum: meta.checksum,
    rowCount: Number.isFinite(rowCount) ? rowCount : undefined,
    pullRunId: Number.isFinite(pullRunId) ? pullRunId : undefined,
    gameId: meta['game-id'],
    archiveVersion: meta['archive-version'],
  };
}

export function decideIdempotentWrite(args: {
  key: string;
  existing: { checksum?: string; rowCount?: number; pullRunId?: number; gameId?: string } | null;
  next: ArchiveObjectMeta;
}): { action: 'put' } | { action: 'skip' } | { action: 'conflict'; message: string } {
  if (isProtectedHistoricalKey(args.key)) {
    return {
      action: 'conflict',
      message: `Refusing to write protected historical prefix: ${args.key}`,
    };
  }
  if (!args.existing) return { action: 'put' };
  const sameChecksum = args.existing.checksum != null && args.existing.checksum === args.next.checksum;
  const sameRows = args.existing.rowCount != null && args.existing.rowCount === args.next.rowCount;
  const sameRun = args.existing.pullRunId != null && args.existing.pullRunId === args.next.pullRunId;
  const sameGame = args.existing.gameId != null && args.existing.gameId === args.next.gameId;
  if (sameChecksum && (args.existing.rowCount == null || sameRows) && (args.existing.pullRunId == null || sameRun)) {
    return { action: 'skip' };
  }
  if (sameRun && sameGame && sameChecksum) return { action: 'skip' };
  return {
    action: 'conflict',
    message:
      `Archive conflict for ${args.key}: existing checksum=${args.existing.checksum ?? 'n/a'} ` +
      `rows=${args.existing.rowCount ?? 'n/a'} vs next checksum=${args.next.checksum} rows=${args.next.rowCount}`,
  };
}

export function archiveSuccessInvariant(rowsStored: number, rowsArchived: number, archiveStatus: ArchiveStatus): boolean {
  if (rowsStored <= 0) return true;
  return archiveStatus === 'archived' && rowsArchived > 0;
}

export type PruneArchivePolicy = {
  requireArchive: boolean;
  requiredAfter: Date | null;
};

export function parseArchiveRequiredAfter(raw: string | undefined | null): Date | null {
  const v = (raw ?? '').trim();
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t) : null;
}

export function isLegacyGameRun(args: {
  startedAt: Date | string;
  pullRunIdOnSnapshot: number | null | undefined;
  requiredAfter: Date | null;
}): boolean {
  if (args.pullRunIdOnSnapshot == null) return true;
  if (args.requiredAfter == null) return false;
  const started = typeof args.startedAt === 'string' ? Date.parse(args.startedAt) : args.startedAt.getTime();
  return started < args.requiredAfter.getTime();
}

export function mayPruneRawSnapshot(args: {
  requireArchive: boolean;
  requiredAfter: Date | null;
  snapshotFetchedAt: Date | string;
  snapshotPullRunId: number | null | undefined;
  gameRunStartedAt: Date | string | null;
  archiveStatus: ArchiveStatus | null;
}): { eligible: boolean; reason: string } {
  if (!args.requireArchive) {
    return { eligible: true, reason: 'archive-not-required' };
  }
  if (args.snapshotPullRunId == null) {
    return { eligible: true, reason: 'legacy-null-pull-run' };
  }
  if (
    args.requiredAfter &&
    args.gameRunStartedAt != null &&
    isLegacyGameRun({
      startedAt: args.gameRunStartedAt,
      pullRunIdOnSnapshot: args.snapshotPullRunId,
      requiredAfter: args.requiredAfter,
    })
  ) {
    return { eligible: true, reason: 'legacy-before-cutoff' };
  }
  if (args.archiveStatus === 'archived') {
    return { eligible: true, reason: 'archive-verified' };
  }
  return {
    eligible: false,
    reason: `archive-missing status=${args.archiveStatus ?? 'unknown'} pull_run_id=${args.snapshotPullRunId}`,
  };
}

export type NormalizedPropLike = {
  game_id: number;
  player_id: number;
  player_name: string | null;
  team_id: number | null;
  sportsbook: string;
  prop_type: string;
  market_type: string;
  side: string;
  line_value: number | null;
  odds_american: number;
  odds_decimal: number;
  implied_probability: number;
  raw_json: unknown;
  provider_updated_at: Date | null;
};

export function rowsFromNormalized(args: {
  normalized: NormalizedPropLike[];
  analyticsGameId: string;
  pullRunId: number;
  snapshotAt: Date | string;
  gameStartTime: Date | string | null;
  opponentId?: string | null;
}): PlayerPropArchiveRow[] {
  const snapshotIso =
    typeof args.snapshotAt === 'string' ? new Date(args.snapshotAt).toISOString() : args.snapshotAt.toISOString();
  const startIso =
    args.gameStartTime == null
      ? null
      : typeof args.gameStartTime === 'string'
        ? new Date(args.gameStartTime).toISOString()
        : args.gameStartTime.toISOString();
  return args.normalized.map((r) => ({
    game_id: args.analyticsGameId,
    source_game_id: r.game_id,
    player_id: String(r.player_id),
    source_player_id: r.player_id,
    player_name: r.player_name,
    team_id: r.team_id != null ? String(r.team_id) : null,
    opponent_id: args.opponentId ?? null,
    sportsbook: r.sportsbook,
    prop_type: r.prop_type,
    market_type: r.market_type,
    side: r.side,
    line_value: r.line_value,
    odds_american: r.odds_american,
    odds_decimal: r.odds_decimal,
    implied_probability: r.implied_probability,
    snapshot_at: snapshotIso,
    game_start_time: startIso,
    source: PLAYER_PROP_SNAPSHOT_SOURCE,
    pull_run_id: args.pullRunId,
    game_run_id: `${args.pullRunId}:${args.analyticsGameId}`,
    provider_updated_at: r.provider_updated_at ? r.provider_updated_at.toISOString() : null,
    raw_json: r.raw_json,
  }));
}

export function filterPregameRows(rows: PlayerPropArchiveRow[]): PlayerPropArchiveRow[] {
  return rows.filter((r) => isValidPregameResearchSnapshot(r.snapshot_at, r.game_start_time));
}

export type InMemoryS3Object = {
  body: Buffer;
  metadata: Record<string, string>;
};

export class InMemoryArchiveStore {
  readonly objects = new Map<string, InMemoryS3Object>();

  async head(key: string): Promise<{ metadata: Record<string, string> } | null> {
    const obj = this.objects.get(key);
    return obj ? { metadata: obj.metadata } : null;
  }

  async get(key: string): Promise<InMemoryS3Object | null> {
    return this.objects.get(key) ?? null;
  }

  async put(key: string, body: Buffer, metadata: Record<string, string>): Promise<void> {
    if (isProtectedHistoricalKey(key)) {
      throw new Error(`Refusing to write protected historical prefix: ${key}`);
    }
    this.objects.set(key, { body, metadata });
  }
}

export async function writeArchiveObject(args: {
  store: {
    head(key: string): Promise<{ metadata: Record<string, string> } | null>;
    get(key: string): Promise<InMemoryS3Object | null>;
    put(key: string, body: Buffer, metadata: Record<string, string>): Promise<void>;
  };
  key: string;
  envelope: PlayerPropArchiveEnvelope;
}): Promise<ArchiveWriteOutcome> {
  const next = envelopeToObjectMeta(args.envelope);
  if (isProtectedHistoricalKey(args.key)) {
    return { ok: false, error: 'protected_prefix', message: `protected key ${args.key}`, key: args.key };
  }
  const existingHead = await args.store.head(args.key);
  let existing = existingHead ? parseS3UserMetadata(existingHead.metadata) : null;
  if (existingHead && !existing?.checksum) {
    const body = await args.store.get(args.key);
    if (body) {
      try {
        const env = gunzipEnvelope(body.body);
        existing = envelopeToObjectMeta(env);
      } catch {
        existing = existing ?? {};
      }
    }
  }
  const decision = decideIdempotentWrite({
    key: args.key,
    existing: existingHead ? existing : null,
    next,
  });
  if (decision.action === 'conflict') {
    return { ok: false, error: 'conflict', message: decision.message, key: args.key };
  }
  if (decision.action === 'skip') {
    return {
      ok: true,
      result: 'already_exists',
      key: args.key,
      rowCount: next.rowCount,
      checksum: next.checksum,
    };
  }
  try {
    await args.store.put(args.key, gzipEnvelope(args.envelope), s3UserMetadata(next));
    return {
      ok: true,
      result: 'written',
      key: args.key,
      rowCount: next.rowCount,
      checksum: next.checksum,
    };
  } catch (err) {
    return {
      ok: false,
      error: 'write_failed',
      message: err instanceof Error ? err.message : 'write failed',
      key: args.key,
    };
  }
}
