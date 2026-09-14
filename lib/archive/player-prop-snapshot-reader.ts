/**
 * Research reader for append-only player-prop snapshot archives.
 * Does not load objects back into Postgres.
 */

import {
  filterPregameRows,
  gunzipEnvelope,
  isProtectedHistoricalKey,
  playerPropSnapshotGameDatePrefix,
  playerPropSnapshotGamePrefix,
  type InMemoryS3Object,
  type PlayerPropArchiveEnvelope,
  type PlayerPropArchiveRow,
} from '@/lib/archive/player-prop-snapshot-archive';

export type ArchiveReadStore = {
  get(key: string): Promise<InMemoryS3Object | null>;
  listKeys?(prefix: string): Promise<string[]>;
};

export async function readPlayerPropArchiveByKey(
  store: ArchiveReadStore,
  key: string
): Promise<PlayerPropArchiveEnvelope | null> {
  if (isProtectedHistoricalKey(key)) {
    throw new Error(`Refusing to treat protected historical prefix as the new archive: ${key}`);
  }
  const obj = await store.get(key);
  if (!obj) return null;
  return gunzipEnvelope(obj.body);
}

export async function listPlayerPropArchiveKeys(args: {
  listKeys: (prefix: string) => Promise<string[]>;
  rawPrefix?: string;
  season: number;
  gameDate: string;
  gameId?: string;
}): Promise<string[]> {
  const prefix = args.gameId
    ? playerPropSnapshotGamePrefix(args.rawPrefix, args.season, args.gameDate, args.gameId)
    : playerPropSnapshotGameDatePrefix(args.rawPrefix, args.season, args.gameDate);
  const keys = await args.listKeys(prefix);
  return keys.filter((key) => !isProtectedHistoricalKey(key) && key.endsWith('.json.gz'));
}

export function researchPregameRowsFromEnvelope(
  envelope: PlayerPropArchiveEnvelope
): PlayerPropArchiveRow[] {
  return filterPregameRows(envelope.rows);
}
