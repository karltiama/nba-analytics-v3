import type { PlayerPropArchiveRow } from '../player-prop-snapshot-archive';
import { BASE_SCHEDULE_FRESHNESS_MS, pointerKey, readVerifiedEnvelope, type CurrentPointer } from './publish';
import type { InMemoryPrototypeStore } from './store';

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
    return value;
  } catch {
    return null;
  }
}

/**
 * Resolves only the archive named by this game's current pointer.
 * The caller cannot pass a historical key.
 */
export async function readCurrentBoard(args: {
  store: InMemoryPrototypeStore;
  gameId: string;
  now: string;
  freshnessMs?: number;
}): Promise<CurrentBoardResponse> {
  const object = await args.store.get(pointerKey(args.gameId));
  if (!object) return { available: false, gameId: args.gameId, snapshotClass: null, reason: 'missing' };
  const pointer = parsePointer(object.body);
  if (!pointer || pointer.gameId !== args.gameId) {
    return { available: false, gameId: args.gameId, snapshotClass: null, reason: 'unavailable' };
  }
  const nowMs = Date.parse(args.now);
  const tipMs = Date.parse(pointer.gameStartTime);
  const observedMs = Date.parse(pointer.observedAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(tipMs) || !Number.isFinite(observedMs)) {
    return { available: false, gameId: args.gameId, snapshotClass: null, reason: 'unavailable' };
  }
  if (nowMs >= tipMs) return { available: false, gameId: args.gameId, snapshotClass: null, reason: 'expired' };
  const freshness = args.freshnessMs ?? BASE_SCHEDULE_FRESHNESS_MS;
  if (nowMs - observedMs > freshness) {
    return { available: false, gameId: args.gameId, snapshotClass: null, reason: 'stale' };
  }
  const verified = await readVerifiedEnvelope(args.store, pointer);
  if (!verified) return { available: false, gameId: args.gameId, snapshotClass: null, reason: 'unavailable' };
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
