import {
  verifyStoredArchive,
  type ArchiveReadPhases,
  type PlayerPropArchiveEnvelope,
  type PlayerPropArchiveRow,
} from '@/lambda/player-props-snapshot/src/player-prop-snapshot-archive';
import { publicationEvidenceProblem, type PublicationManifest } from '@/lambda/player-props-snapshot/src/f39b/manifest';
import { CURRENT_BOARD_DECODE_LIMITS, CURRENT_BOARD_MAX_COMPRESSED_BYTES } from './bounds';
import { BASE_SCHEDULE_FRESHNESS_MS, isCurrentBoardGameId, pointerKey, type CurrentPointer } from './pointer';
import {
  sharedVerifiedSnapshotCache,
  type VerifiedSnapshot,
  type VerifiedSnapshotCache,
} from './snapshot-cache';

export type CurrentBoardObject = {
  body: Buffer;
  metadata: Record<string, string>;
};

/** GetObject for one known key. Callers cannot pass an archive key into the reader. */
export type CurrentBoardStore = {
  get(key: string): Promise<CurrentBoardObject | null>;
};

export type CurrentBoardRow = {
  sportsbook: string;
  playerId: string;
  propType: string;
  marketType: string;
  side: string;
  line: number | null;
  oddsAmerican: number | null;
  oddsDecimal: number | null;
  impliedProbability: number | null;
};

export type CurrentBoardResponse =
  | {
      available: true;
      gameId: string;
      snapshotClass: 'current_stored_snapshot';
      observedAt: string;
      snapshot: {
        archiveKey: string;
        pullRunId: number;
        envelopeChecksum: string;
        manifestChecksum: string;
      };
      rows: CurrentBoardRow[];
      freshness: 'fresh';
      eligibility: 'pregame';
      completeness: {
        status: 'complete';
        rowsFetched: number;
        rowCount: number;
        pagesRead: number;
        cursorClosed: true;
      };
    }
  | {
      available: false;
      gameId: string;
      snapshotClass: null;
      reason: 'missing' | 'stale' | 'expired' | 'unavailable';
    };

export type CurrentBoardReadTiming = {
  event: 'current_board_read';
  gameId: string;
  result: 'fresh' | 'stale' | 'expired' | 'missing' | 'unavailable';
  cache: 'hit' | 'miss' | 'shared' | 'bypass';
  pointerMs: number;
  manifestMs: number;
  archiveMs: number;
  decompressMs: number;
  verifyMs: number;
  totalMs: number;
  compressedBytes: number | null;
  decodedBytes: number | null;
};

/** Closed unless a server route passes the read-only website store. */
export function defaultCurrentBoardStore(): CurrentBoardStore {
  return {
    async get(): Promise<CurrentBoardObject | null> {
      throw new Error('current board store is not configured');
    },
  };
}

function boardRow(row: PlayerPropArchiveRow): CurrentBoardRow {
  return {
    sportsbook: row.sportsbook,
    playerId: row.player_id,
    propType: row.prop_type,
    marketType: row.market_type,
    side: row.side,
    line: row.line_value,
    oddsAmerican: row.odds_american,
    oddsDecimal: row.odds_decimal,
    impliedProbability: row.implied_probability,
  };
}

function parsePointer(body: Buffer): CurrentPointer | null {
  try {
    const value = JSON.parse(body.toString('utf8')) as CurrentPointer;
    if (value.schemaVersion !== 1 || !value.archiveKey || !value.manifestKey) return null;
    if (!Number.isInteger(value.pullRunId)) return null;
    return value;
  } catch {
    return null;
  }
}

function roundMs(value: number): number {
  return Math.max(0, Math.round(value * 1000) / 1000);
}

function ms(started: number): number {
  return roundMs(performance.now() - started);
}

async function readManifest(store: CurrentBoardStore, key: string): Promise<PublicationManifest | null> {
  const object = await store.get(key);
  if (!object) return null;
  if (object.body.length > CURRENT_BOARD_MAX_COMPRESSED_BYTES) return null;
  try {
    return JSON.parse(object.body.toString('utf8')) as PublicationManifest;
  } catch {
    return null;
  }
}

function pointerAgrees(pointer: CurrentPointer, manifest: PublicationManifest): boolean {
  return manifest.manifestChecksum === pointer.manifestChecksum
    && manifest.archiveKey === pointer.archiveKey
    && manifest.envelopeChecksum === pointer.envelopeChecksum
    && manifest.gameId === pointer.gameId
    && manifest.pullRunId === pointer.pullRunId;
}

function responseFrom(
  gameId: string,
  pointer: CurrentPointer,
  manifest: PublicationManifest,
  envelope: PlayerPropArchiveEnvelope,
): CurrentBoardResponse {
  return {
    available: true,
    gameId,
    snapshotClass: 'current_stored_snapshot',
    observedAt: pointer.observedAt,
    snapshot: {
      archiveKey: pointer.archiveKey,
      pullRunId: pointer.pullRunId,
      envelopeChecksum: pointer.envelopeChecksum,
      manifestChecksum: pointer.manifestChecksum,
    },
    rows: envelope.rows.map(boardRow),
    freshness: 'fresh',
    eligibility: 'pregame',
    completeness: {
      status: 'complete',
      rowsFetched: manifest.rowsFetched,
      rowCount: manifest.rowCount,
      pagesRead: manifest.pages.pagesRead,
      cursorClosed: true,
    },
  };
}

async function loadVerifiedSnapshot(
  store: CurrentBoardStore,
  pointer: CurrentPointer,
  manifest: PublicationManifest,
  phases: ArchiveReadPhases,
): Promise<VerifiedSnapshot | null> {
  const stored = await verifyStoredArchive({
    store: {
      get: (key) => store.get(key),
      putIfAbsent() {
        return Promise.reject(new Error('current board reader does not write'));
      },
    },
    key: pointer.archiveKey,
    expectedChecksum: pointer.envelopeChecksum,
    expected: {
      gameId: pointer.gameId,
      pullRunId: pointer.pullRunId,
      gameDate: manifest.gameDate,
      controllerEnqueuedAt: pointer.controllerEnqueuedAt,
    },
    limits: CURRENT_BOARD_DECODE_LIMITS,
    phases,
  });
  if (!stored.ok) return null;
  if (publicationEvidenceProblem(manifest, stored.envelope)) return null;
  return {
    archiveKey: pointer.archiveKey,
    envelopeChecksum: pointer.envelopeChecksum,
    envelope: stored.envelope,
    decodedBytes: stored.uncompressedBytes,
  };
}

export async function readVerifiedEnvelope(
  store: CurrentBoardStore,
  pointer: CurrentPointer,
): Promise<{ manifest: PublicationManifest; envelope: PlayerPropArchiveEnvelope } | null> {
  const manifest = await readManifest(store, pointer.manifestKey);
  if (!manifest || !pointerAgrees(pointer, manifest)) return null;
  const phases: ArchiveReadPhases = {
    fetchMs: 0,
    decompressMs: 0,
    verifyMs: 0,
    compressedBytes: 0,
    uncompressedBytes: 0,
  };
  const snapshot = await loadVerifiedSnapshot(store, pointer, manifest, phases);
  if (!snapshot) return null;
  return { manifest, envelope: snapshot.envelope };
}

function unavailable(gameId: string, reason: 'missing' | 'stale' | 'expired' | 'unavailable'): CurrentBoardResponse {
  return { available: false, gameId, snapshotClass: null, reason };
}

function emitTiming(
  timing: CurrentBoardReadTiming,
  sink?: (timing: CurrentBoardReadTiming) => void,
): void {
  if (sink) {
    sink(timing);
    return;
  }
  console.info(JSON.stringify(timing));
}

/**
 * Resolves only the archive named by this game's current pointer.
 * The caller cannot pass a historical key.
 * The pointer is read on every call. A cache hit still has to match that pointer.
 */
export async function readCurrentBoard(args: {
  store: CurrentBoardStore;
  gameId: string;
  now: string;
  freshnessMs?: number;
  cache?: VerifiedSnapshotCache;
  timing?: (timing: CurrentBoardReadTiming) => void;
}): Promise<CurrentBoardResponse> {
  const started = performance.now();
  const phases: ArchiveReadPhases = {
    fetchMs: 0,
    decompressMs: 0,
    verifyMs: 0,
    compressedBytes: 0,
    uncompressedBytes: 0,
  };
  let pointerMs = 0;
  let manifestMs = 0;
  let cache: CurrentBoardReadTiming['cache'] = 'bypass';
  const finish = (
    response: CurrentBoardResponse,
    decodedBytes: number | null,
  ): CurrentBoardResponse => {
    emitTiming({
      event: 'current_board_read',
      gameId: args.gameId,
      result: response.available ? 'fresh' : response.reason,
      cache,
      pointerMs,
      manifestMs,
      archiveMs: roundMs(phases.fetchMs),
      decompressMs: roundMs(phases.decompressMs),
      verifyMs: roundMs(phases.verifyMs),
      totalMs: ms(started),
      compressedBytes: phases.compressedBytes > 0 ? phases.compressedBytes : null,
      decodedBytes,
    }, args.timing);
    return response;
  };

  if (!isCurrentBoardGameId(args.gameId)) return finish(unavailable(args.gameId, 'unavailable'), null);
  let object: CurrentBoardObject | null;
  const pointerStarted = performance.now();
  try {
    object = await args.store.get(pointerKey(args.gameId));
  } catch {
    pointerMs = ms(pointerStarted);
    return finish(unavailable(args.gameId, 'unavailable'), null);
  }
  pointerMs = ms(pointerStarted);
  if (!object) return finish(unavailable(args.gameId, 'missing'), null);
  const pointer = parsePointer(object.body);
  if (!pointer || pointer.gameId !== args.gameId) return finish(unavailable(args.gameId, 'unavailable'), null);
  const nowMs = Date.parse(args.now);
  const tipMs = Date.parse(pointer.gameStartTime);
  const observedMs = Date.parse(pointer.observedAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(tipMs) || !Number.isFinite(observedMs)) {
    return finish(unavailable(args.gameId, 'unavailable'), null);
  }
  if (nowMs >= tipMs) return finish(unavailable(args.gameId, 'expired'), null);
  const freshness = args.freshnessMs ?? BASE_SCHEDULE_FRESHNESS_MS;
  if (nowMs - observedMs > freshness) return finish(unavailable(args.gameId, 'stale'), null);

  const manifestStarted = performance.now();
  let manifest: PublicationManifest | null;
  try {
    manifest = await readManifest(args.store, pointer.manifestKey);
  } catch {
    manifestMs = ms(manifestStarted);
    return finish(unavailable(args.gameId, 'unavailable'), null);
  }
  manifestMs = ms(manifestStarted);
  if (!manifest || !pointerAgrees(pointer, manifest)) {
    return finish(unavailable(args.gameId, 'unavailable'), null);
  }
  const agreedManifest = manifest;

  try {
    const cacheStore = args.cache ?? sharedVerifiedSnapshotCache();
    const loaded = await cacheStore.load(pointer.archiveKey, pointer.envelopeChecksum, () => (
      loadVerifiedSnapshot(args.store, pointer, agreedManifest, phases)
    ));
    cache = loaded.outcome;
    const snapshot = loaded.snapshot;
    const evidenceStarted = performance.now();
    const evidenceFailed = !snapshot
      || snapshot.archiveKey !== pointer.archiveKey
      || snapshot.envelopeChecksum !== pointer.envelopeChecksum
      || publicationEvidenceProblem(agreedManifest, snapshot.envelope) != null;
    phases.verifyMs += performance.now() - evidenceStarted;
    if (evidenceFailed || !snapshot) return finish(unavailable(args.gameId, 'unavailable'), null);
    return finish(responseFrom(args.gameId, pointer, agreedManifest, snapshot.envelope), snapshot.decodedBytes);
  } catch {
    return finish(unavailable(args.gameId, 'unavailable'), null);
  }
}
