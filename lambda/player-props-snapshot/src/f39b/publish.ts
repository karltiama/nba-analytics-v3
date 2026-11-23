import { normalizePlayerPropRows } from '../normalize';
import {
  buildArchiveEnvelope,
  buildPlayerPropSnapshotArchiveKey,
  isValidPregameResearchSnapshot,
  nbaSeasonStartYearFromGameDate,
  rowsFromNormalized,
  verifyStoredArchive,
  writeArchiveObject,
  type PlayerPropArchiveEnvelope,
} from '../player-prop-snapshot-archive';
import {
  publicationEvidenceProblem,
  PUBLICATION_MANIFEST_VERSION,
  sealManifest,
  type PublicationManifest,
  type PublicationStatus,
} from './manifest';
import { validateProviderPull, type ProviderPage } from './pages';
import { InMemoryPrototypeStore } from './store';

export const BASE_SCHEDULE_FRESHNESS_MS = 30 * 60 * 1000;

export type PublishRequest = {
  store: InMemoryPrototypeStore;
  gameId: string;
  bdlGameId: number;
  gameDate: string;
  gameStartTime: string;
  pullRunId: number;
  pages: readonly ProviderPage[];
  observedAt: string;
  controllerEnqueuedAt: string;
};

export type PublishResult = {
  ok: boolean;
  published: boolean;
  reason: string;
  archiveKey: string | null;
  manifestKey: string | null;
  idempotent: boolean;
};

export function pointerKey(gameId: string): string {
  return `current/source=balldontlie/league=nba/entity=player_prop_current/game_id=${gameId}/pointer.json`;
}

export function manifestKeyFor(archiveKey: string): string {
  return `${archiveKey}.publication.json`;
}

export type CurrentPointer = {
  schemaVersion: 1;
  gameId: string;
  archiveKey: string;
  manifestKey: string;
  pullRunId: number;
  observedAt: string;
  controllerEnqueuedAt: string;
  gameStartTime: string;
  envelopeChecksum: string;
  manifestChecksum: string;
  previousArchiveKey: string | null;
};

function parsePointer(body: Buffer): CurrentPointer | null {
  try {
    const value = JSON.parse(body.toString('utf8')) as CurrentPointer;
    if (value.schemaVersion !== 1 || !value.archiveKey || !value.observedAt) return null;
    if (!Number.isInteger(value.pullRunId)) return null;
    return value;
  } catch {
    return null;
  }
}

/** Newer observed_at wins. The same instant uses the higher pull_run_id. */
export function observationPrecedes(left: { observedAt: string; pullRunId: number }, right: { observedAt: string; pullRunId: number }): boolean {
  const delta = Date.parse(left.observedAt) - Date.parse(right.observedAt);
  if (delta !== 0) return delta < 0;
  return left.pullRunId < right.pullRunId;
}

async function putNewObject(
  store: InMemoryPrototypeStore,
  key: string,
  body: Buffer,
  metadata: Record<string, string>
): Promise<{ ok: true; identical: boolean } | { ok: false; reason: string }> {
  const created = await store.put(key, body, metadata, { kind: 'if-none-match', etag: '*' });
  if (created.ok) return { ok: true, identical: false };
  if (created.status !== 409 && created.status !== 412) return { ok: false, reason: 'conditional_conflict' };
  const existing = await store.get(key);
  if (!existing) return { ok: false, reason: 'conditional_conflict' };
  if (Buffer.compare(existing.body, body) === 0) return { ok: true, identical: true };
  return { ok: false, reason: 'archive_conflict' };
}

async function readManifest(store: InMemoryPrototypeStore, key: string): Promise<PublicationManifest | null> {
  const object = await store.get(key);
  if (!object) return null;
  try {
    return JSON.parse(object.body.toString('utf8')) as PublicationManifest;
  } catch {
    return null;
  }
}

/**
 * Archive a complete pull, verify it, then move the current pointer.
 * An older observation, a post-tip observation, or a failed conditional write
 * leaves any existing pointer where it is.
 */
export async function publishCurrentSnapshot(request: PublishRequest): Promise<PublishResult> {
  const validated = validateProviderPull(request.pages, request.bdlGameId);
  if (!validated.ok) {
    return { ok: false, published: false, reason: validated.reason, archiveKey: null, manifestKey: null, idempotent: false };
  }
  const normalized = normalizePlayerPropRows(validated.rows);
  if (normalized.length === 0 || validated.rows.length === 0) {
    return { ok: false, published: false, reason: 'empty_snapshot', archiveKey: null, manifestKey: null, idempotent: false };
  }

  const season = nbaSeasonStartYearFromGameDate(request.gameDate);
  const archiveKey = buildPlayerPropSnapshotArchiveKey({
    rawPrefix: 'raw',
    season,
    gameDate: request.gameDate,
    gameId: request.gameId,
    pullRunId: request.pullRunId,
    snapshotAt: request.controllerEnqueuedAt,
  });
  const manifestKey = manifestKeyFor(archiveKey);
  const rows = rowsFromNormalized({
    normalized,
    analyticsGameId: request.gameId,
    pullRunId: request.pullRunId,
    snapshotAt: request.controllerEnqueuedAt,
    gameStartTime: request.gameStartTime,
    opponentId: null,
  });
  const envelope = buildArchiveEnvelope({
    season,
    pullRunId: request.pullRunId,
    gameId: request.gameId,
    sourceGameId: request.bdlGameId,
    gameDate: request.gameDate,
    snapshotAt: request.controllerEnqueuedAt,
    gameStartTime: request.gameStartTime,
    rows,
    observation: {
      observedAt: request.observedAt,
      controllerEnqueuedAt: request.controllerEnqueuedAt,
    },
  });

  let archived: { ok: true; identical: boolean } | { ok: false; reason: string };
  try {
    const written = await writeArchiveObject({ store: request.store, key: archiveKey, envelope });
    if (!written.ok) archived = { ok: false, reason: written.error };
    else archived = { ok: true, identical: written.result === 'already_exists' };
  } catch {
    archived = { ok: false, reason: 'archive_write_failed' };
  }
  if (!archived.ok) {
    return { ok: false, published: false, reason: archived.reason, archiveKey, manifestKey: null, idempotent: false };
  }

  let verified: Awaited<ReturnType<typeof verifyStoredArchive>>;
  try {
    verified = await verifyStoredArchive({
      store: request.store,
      key: archiveKey,
      expectedChecksum: envelope.checksum,
      expected: {
        gameId: request.gameId,
        pullRunId: request.pullRunId,
        gameDate: request.gameDate,
        controllerEnqueuedAt: request.controllerEnqueuedAt,
      },
    });
  } catch {
    return { ok: false, published: false, reason: 'archive_read_failed', archiveKey, manifestKey: null, idempotent: false };
  }
  if (!verified.ok) {
    return { ok: false, published: false, reason: verified.reason, archiveKey, manifestKey: null, idempotent: false };
  }

  const pregame = isValidPregameResearchSnapshot(request.observedAt, request.gameStartTime);
  const status: PublicationStatus = pregame ? 'complete' : 'post_tip';
  const manifest = sealManifest({
    manifestVersion: PUBLICATION_MANIFEST_VERSION,
    archiveKey,
    archiveVersion: envelope.archiveVersion,
    gameId: request.gameId,
    gameDate: request.gameDate,
    pullRunId: request.pullRunId,
    source: envelope.source,
    rowCount: envelope.row_count,
    rowsFetched: validated.rows.length,
    pages: validated.evidence,
    observedAt: envelope.observed_at ?? request.observedAt,
    controllerEnqueuedAt: envelope.controller_enqueued_at ?? request.controllerEnqueuedAt,
    envelopeChecksum: envelope.checksum,
    status,
    eligible: pregame,
  });
  if (publicationEvidenceProblem(manifest, verified.envelope) && pregame) {
    return { ok: false, published: false, reason: 'manifest_rejected', archiveKey, manifestKey, idempotent: false };
  }

  let manifestWrite: { ok: true; identical: boolean } | { ok: false; reason: string };
  try {
    manifestWrite = await putNewObject(
      request.store,
      manifestKey,
      Buffer.from(`${JSON.stringify(manifest)}\n`, 'utf8'),
      { 'manifest-version': manifest.manifestVersion, checksum: manifest.manifestChecksum }
    );
  } catch {
    manifestWrite = { ok: false, reason: 'manifest_write_failed' };
  }
  if (!manifestWrite.ok) {
    return { ok: false, published: false, reason: manifestWrite.reason, archiveKey, manifestKey, idempotent: false };
  }

  if (!pregame) {
    return { ok: false, published: false, reason: 'post_tip', archiveKey, manifestKey, idempotent: false };
  }

  const evidence = publicationEvidenceProblem(manifest, verified.envelope);
  if (evidence) {
    return { ok: false, published: false, reason: 'manifest_rejected', archiveKey, manifestKey, idempotent: false };
  }

  try {
    const pointed = await publishPointer(request.store, manifest, request.gameStartTime, verified.envelope);
    return { ...pointed, archiveKey, manifestKey };
  } catch {
    return { ok: false, published: false, reason: 'pointer_write_failed', archiveKey, manifestKey, idempotent: false };
  }
}

async function publishPointer(
  store: InMemoryPrototypeStore,
  manifest: PublicationManifest,
  gameStartTime: string,
  envelope: PlayerPropArchiveEnvelope
): Promise<{ ok: boolean; published: boolean; reason: string; idempotent: boolean }> {
  const key = pointerKey(manifest.gameId);
  const currentObject = await store.get(key);
  const current = currentObject ? parsePointer(currentObject.body) : null;
  if (currentObject && !current) {
    return { ok: false, published: false, reason: 'pointer_unreadable', idempotent: false };
  }
  if (current && current.archiveKey === manifest.archiveKey && current.envelopeChecksum === manifest.envelopeChecksum) {
    return { ok: true, published: true, reason: 'already_current', idempotent: true };
  }
  if (current && !observationPrecedes(current, { observedAt: manifest.observedAt, pullRunId: manifest.pullRunId })) {
    return { ok: false, published: false, reason: 'older_snapshot', idempotent: false };
  }
  const next: CurrentPointer = {
    schemaVersion: 1,
    gameId: manifest.gameId,
    archiveKey: manifest.archiveKey,
    manifestKey: manifestKeyFor(manifest.archiveKey),
    pullRunId: manifest.pullRunId,
    observedAt: manifest.observedAt,
    controllerEnqueuedAt: manifest.controllerEnqueuedAt,
    gameStartTime,
    envelopeChecksum: envelope.checksum,
    manifestChecksum: manifest.manifestChecksum,
    previousArchiveKey: current?.archiveKey ?? null,
  };
  const body = Buffer.from(`${JSON.stringify(next)}\n`, 'utf8');
  const condition = currentObject
    ? ({ kind: 'if-match', etag: currentObject.etag } as const)
    : ({ kind: 'if-none-match', etag: '*' } as const);
  const put = await store.put(key, body, { 'pointer-game': manifest.gameId }, condition);
  if (put.ok) return { ok: true, published: true, reason: 'published', idempotent: false };
  if (put.status !== 409 && put.status !== 412) {
    return { ok: false, published: false, reason: 'pointer_conflict', idempotent: false };
  }
  const again = await store.get(key);
  const winner = again ? parsePointer(again.body) : null;
  if (winner && winner.archiveKey === manifest.archiveKey && winner.envelopeChecksum === manifest.envelopeChecksum) {
    return { ok: true, published: true, reason: 'already_current', idempotent: true };
  }
  if (!winner || !observationPrecedes(winner, { observedAt: manifest.observedAt, pullRunId: manifest.pullRunId })) {
    return { ok: false, published: false, reason: 'older_snapshot', idempotent: false };
  }
  const retry = await store.put(key, body, { 'pointer-game': manifest.gameId }, { kind: 'if-match', etag: again!.etag });
  if (!retry.ok) return { ok: false, published: false, reason: 'pointer_conflict', idempotent: false };
  return { ok: true, published: true, reason: 'published', idempotent: false };
}

export async function readVerifiedEnvelope(
  store: InMemoryPrototypeStore,
  pointer: CurrentPointer
): Promise<{ manifest: PublicationManifest; envelope: PlayerPropArchiveEnvelope } | null> {
  const manifest = await readManifest(store, pointer.manifestKey);
  if (!manifest) return null;
  const stored = await verifyStoredArchive({
    store,
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
