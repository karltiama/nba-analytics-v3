import { verifyStoredArchive, type PlayerPropArchiveEnvelope, type PlayerPropArchiveRow } from '@/lambda/player-props-snapshot/src/player-prop-snapshot-archive';
import { publicationEvidenceProblem, type PublicationManifest } from '@/lambda/player-props-snapshot/src/f39b/manifest';
import { BASE_SCHEDULE_FRESHNESS_MS, isCurrentBoardGameId, pointerKey, type CurrentPointer } from './pointer';

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

async function readManifest(store: CurrentBoardStore, key: string): Promise<PublicationManifest | null> {
  const object = await store.get(key);
  if (!object) return null;
  try {
    return JSON.parse(object.body.toString('utf8')) as PublicationManifest;
  } catch {
    return null;
  }
}

export async function readVerifiedEnvelope(
  store: CurrentBoardStore,
  pointer: CurrentPointer
): Promise<{ manifest: PublicationManifest; envelope: PlayerPropArchiveEnvelope } | null> {
  const manifest = await readManifest(store, pointer.manifestKey);
  if (!manifest) return null;
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
  });
  if (!stored.ok) return null;
  if (publicationEvidenceProblem(manifest, stored.envelope)) return null;
  if (manifest.manifestChecksum !== pointer.manifestChecksum) return null;
  if (manifest.archiveKey !== pointer.archiveKey) return null;
  return { manifest, envelope: stored.envelope };
}

function unavailable(gameId: string, reason: 'missing' | 'stale' | 'expired' | 'unavailable'): CurrentBoardResponse {
  return { available: false, gameId, snapshotClass: null, reason };
}

/**
 * Resolves only the archive named by this game's current pointer.
 * The caller cannot pass a historical key.
 */
export async function readCurrentBoard(args: {
  store: CurrentBoardStore;
  gameId: string;
  now: string;
  freshnessMs?: number;
}): Promise<CurrentBoardResponse> {
  if (!isCurrentBoardGameId(args.gameId)) return unavailable(args.gameId, 'unavailable');
  let object: CurrentBoardObject | null;
  try {
    object = await args.store.get(pointerKey(args.gameId));
  } catch {
    return unavailable(args.gameId, 'unavailable');
  }
  if (!object) return unavailable(args.gameId, 'missing');
  const pointer = parsePointer(object.body);
  if (!pointer || pointer.gameId !== args.gameId) return unavailable(args.gameId, 'unavailable');
  const nowMs = Date.parse(args.now);
  const tipMs = Date.parse(pointer.gameStartTime);
  const observedMs = Date.parse(pointer.observedAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(tipMs) || !Number.isFinite(observedMs)) {
    return unavailable(args.gameId, 'unavailable');
  }
  if (nowMs >= tipMs) return unavailable(args.gameId, 'expired');
  const freshness = args.freshnessMs ?? BASE_SCHEDULE_FRESHNESS_MS;
  if (nowMs - observedMs > freshness) return unavailable(args.gameId, 'stale');
  let verified: Awaited<ReturnType<typeof readVerifiedEnvelope>>;
  try {
    verified = await readVerifiedEnvelope(args.store, pointer);
  } catch {
    return unavailable(args.gameId, 'unavailable');
  }
  if (!verified) return unavailable(args.gameId, 'unavailable');
  return {
    available: true,
    gameId: args.gameId,
    snapshotClass: 'current_stored_snapshot',
    observedAt: pointer.observedAt,
    snapshot: {
      archiveKey: pointer.archiveKey,
      pullRunId: pointer.pullRunId,
      envelopeChecksum: pointer.envelopeChecksum,
      manifestChecksum: pointer.manifestChecksum,
    },
    rows: verified.envelope.rows.map(boardRow),
    freshness: 'fresh',
    eligibility: 'pregame',
    completeness: {
      status: 'complete',
      rowsFetched: verified.manifest.rowsFetched,
      rowCount: verified.manifest.rowCount,
      pagesRead: verified.manifest.pages.pagesRead,
      cursorClosed: true,
    },
  };
}
