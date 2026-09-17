import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import {
  LEGACY_EXISTING_INGESTION_SOURCE,
  LEGACY_PLAYER_PROPS_RAW_V2_ENTITY,
} from '@/lib/archive/player-prop-snapshot-archive';
import {
  OWLS_ARCHIVE_SCHEMA,
  OWLS_CLOSING_ODDS_ARCHIVE_SCHEMA,
  OWLS_ENTITY_CLOSING_ODDS,
  OWLS_ENTITY_GAMES,
  OWLS_ENTITY_ODDS,
  OWLS_ENTITY_PLAYER_PROPS,
  OWLS_ENTITY_PROP_SNAPSHOTS,
  OWLS_ENTITY_PUBLIC_BETTING,
  OWLS_FIXTURE_SOURCE_PREFIX,
  OWLS_GAMES_ARCHIVE_SCHEMA,
  OWLS_LEAGUE,
  OWLS_ODDS_ARCHIVE_SCHEMA,
  OWLS_PROTECTED_ENTITIES,
  OWLS_PROTECTED_SOURCES,
  OWLS_PROVIDER,
  OWLS_PUBLIC_BETTING_ARCHIVE_SCHEMA,
  OWLS_SNAPSHOT_ARCHIVE_SCHEMA,
  OWLS_SOURCE_PREFIX,
} from './contract';
import type { OwlsArchiveEnvelope, OwlsPage } from './types';

export type OwlsObjectStore = {
  head(key: string): Promise<{ metadata: Record<string, string> } | null>;
  get(key: string): Promise<{ body: Buffer; metadata: Record<string, string> } | null>;
  put(key: string, body: Buffer, metadata: Record<string, string>): Promise<void>;
  listKeys(prefix: string): Promise<string[]>;
};

export class InMemoryOwlsStore implements OwlsObjectStore {
  readonly objects = new Map<string, { body: Buffer; metadata: Record<string, string> }>();

  async head(key: string): Promise<{ metadata: Record<string, string> } | null> {
    const obj = this.objects.get(key);
    return obj ? { metadata: obj.metadata } : null;
  }

  async get(key: string): Promise<{ body: Buffer; metadata: Record<string, string> } | null> {
    return this.objects.get(key) ?? null;
  }

  async put(key: string, body: Buffer, metadata: Record<string, string>): Promise<void> {
    assertWritableOwlsKey(key);
    this.objects.set(key, { body, metadata });
  }

  async listKeys(prefix: string): Promise<string[]> {
    return [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
  }
}

export function normalizeRawPrefix(rawPrefix?: string | null): string {
  return (rawPrefix ?? 'raw').trim().replace(/^\/+|\/+$/g, '') || 'raw';
}

export function isProtectedOwlsKey(key: string): boolean {
  const n = key.replace(/\\/g, '/');
  if (n.includes(`/source=${LEGACY_EXISTING_INGESTION_SOURCE}/`)) return true;
  if (n.includes(`/entity=${LEGACY_PLAYER_PROPS_RAW_V2_ENTITY}`)) return true;
  for (const source of OWLS_PROTECTED_SOURCES) {
    if (n.includes(`/source=${source}/`)) return true;
  }
  for (const entity of OWLS_PROTECTED_ENTITIES) {
    if (n.includes(`/entity=${entity}/`) || n.includes(`/entity=${entity}`)) return true;
  }
  return false;
}

export function assertWritableOwlsKey(key: string): void {
  if (isProtectedOwlsKey(key)) {
    throw new Error(`Refusing to write protected historical prefix: ${key}`);
  }
}

export function owlsSourcePrefix(fixture: boolean): string {
  return fixture ? OWLS_FIXTURE_SOURCE_PREFIX : OWLS_SOURCE_PREFIX;
}

export function entityForEndpoint(endpoint: string): string {
  if (endpoint.includes('player-props') || endpoint === 'history_player_props') return OWLS_ENTITY_PLAYER_PROPS;
  if (endpoint.includes('closing-odds') || endpoint === 'history_closing_odds') return OWLS_ENTITY_CLOSING_ODDS;
  if (endpoint.includes('public-betting') || endpoint === 'history_public_betting') return OWLS_ENTITY_PUBLIC_BETTING;
  if (endpoint.includes('history/odds') || endpoint === 'history_odds') return OWLS_ENTITY_ODDS;
  if (endpoint.includes('history/props') || endpoint === 'history_props') return OWLS_ENTITY_PROP_SNAPSHOTS;
  return OWLS_ENTITY_GAMES;
}

export function schemaForEntity(entity: string): string {
  if (entity === OWLS_ENTITY_PROP_SNAPSHOTS) return OWLS_SNAPSHOT_ARCHIVE_SCHEMA;
  if (entity === OWLS_ENTITY_GAMES) return OWLS_GAMES_ARCHIVE_SCHEMA;
  if (entity === OWLS_ENTITY_CLOSING_ODDS) return OWLS_CLOSING_ODDS_ARCHIVE_SCHEMA;
  if (entity === OWLS_ENTITY_PUBLIC_BETTING) return OWLS_PUBLIC_BETTING_ARCHIVE_SCHEMA;
  if (entity === OWLS_ENTITY_ODDS) return OWLS_ODDS_ARCHIVE_SCHEMA;
  return OWLS_ARCHIVE_SCHEMA;
}

export function padPage(pageIndex: number): string {
  return String(pageIndex).padStart(4, '0');
}

export function sanitizeProviderGameId(id: string): string {
  return id.replace(/\s+/g, '_');
}

export function buildOwlsArchiveKey(args: {
  rawPrefix?: string;
  fixture?: boolean;
  season: string | number;
  entity: string;
  gameDate: string;
  providerGameId: string;
  pageIndex: number;
}): string {
  const raw = normalizeRawPrefix(args.rawPrefix);
  const source = owlsSourcePrefix(Boolean(args.fixture));
  return (
    `${raw}/source=${source}/league=${OWLS_LEAGUE}/season=${args.season}` +
    `/entity=${args.entity}/game_date=${args.gameDate}` +
    `/provider_game_id=${args.providerGameId}/page=${padPage(args.pageIndex)}.json.gz`
  );
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

export function gzipJson(value: unknown): Buffer {
  return gzipSync(Buffer.from(`${JSON.stringify(value)}\n`, 'utf8'));
}

export function gunzipJson<T>(buf: Buffer): T {
  const text = gunzipSync(buf).toString('utf8');
  return JSON.parse(text) as T;
}

export function verifyEnvelopeChecksum(envelope: OwlsArchiveEnvelope): boolean {
  const expected = checksumCanonical(envelope.payload);
  return expected === envelope.checksum;
}

export function buildOwlsEnvelope(args: {
  page: OwlsPage;
  backfillRunId: string;
  requestedAt: string;
  archivedAt?: string;
  providerGameId: string | null;
  courtContextGameId?: string | null;
  season: string | null;
  gameDate: string | null;
  fixture: boolean;
  schema?: string;
}): OwlsArchiveEnvelope {
  const payload = args.page.body;
  const fetchedAt = args.requestedAt;
  return {
    schema: args.schema ?? schemaForEntity(entityForEndpoint(args.page.request.path)),
    provider: OWLS_PROVIDER,
    backfill_run_id: args.backfillRunId,
    requested_at: args.requestedAt,
    archived_at: args.archivedAt ?? args.requestedAt,
    fetched_at: fetchedAt,
    request: args.page.request,
    response_metadata: args.page.metadata,
    row_count: args.page.rowCount,
    checksum: checksumCanonical(payload),
    page_index: args.page.pageIndex,
    offset: args.page.offset,
    limit: args.page.limit,
    provider_game_id: args.providerGameId,
    court_context_game_id: args.courtContextGameId ?? null,
    season: args.season,
    game_date: args.gameDate,
    fixture: args.fixture,
    payload,
  };
}

export type OwlsArchiveWriteOutcome =
  | { ok: true; result: 'written' | 'already_exists'; key: string; checksum: string; rowCount: number }
  | { ok: false; error: 'conflict' | 'protected_prefix' | 'checksum_mismatch'; message: string; key: string };

export async function writeOwlsArchiveObject(args: {
  store: OwlsObjectStore;
  key: string;
  envelope: OwlsArchiveEnvelope;
}): Promise<OwlsArchiveWriteOutcome> {
  if (isProtectedOwlsKey(args.key)) {
    return { ok: false, error: 'protected_prefix', message: `protected key ${args.key}`, key: args.key };
  }
  if (!verifyEnvelopeChecksum(args.envelope)) {
    return {
      ok: false,
      error: 'checksum_mismatch',
      message: `envelope checksum does not match payload for ${args.key}`,
      key: args.key,
    };
  }
  const body = gzipJson(args.envelope);
  const metadata = {
    checksum: args.envelope.checksum,
    'row-count': String(args.envelope.row_count),
    'backfill-run-id': args.envelope.backfill_run_id,
    'archive-schema': args.envelope.schema,
    provider: OWLS_PROVIDER,
  };
  const existing = await args.store.head(args.key);
  if (existing) {
    const existingChecksum = existing.metadata.checksum;
    if (existingChecksum && existingChecksum === args.envelope.checksum) {
      return {
        ok: true,
        result: 'already_exists',
        key: args.key,
        checksum: args.envelope.checksum,
        rowCount: args.envelope.row_count,
      };
    }
    const existingObj = await args.store.get(args.key);
    if (existingObj) {
      try {
        const prev = gunzipJson<OwlsArchiveEnvelope>(existingObj.body);
        if (prev.checksum === args.envelope.checksum) {
          return {
            ok: true,
            result: 'already_exists',
            key: args.key,
            checksum: args.envelope.checksum,
            rowCount: args.envelope.row_count,
          };
        }
        return {
          ok: false,
          error: 'conflict',
          message: `Archive conflict for ${args.key}: existing checksum=${prev.checksum} vs next=${args.envelope.checksum}`,
          key: args.key,
        };
      } catch {
        return {
          ok: false,
          error: 'conflict',
          message: `Archive conflict for ${args.key}: existing object is unreadable`,
          key: args.key,
        };
      }
    }
  }
  await args.store.put(args.key, body, metadata);
  return {
    ok: true,
    result: 'written',
    key: args.key,
    checksum: args.envelope.checksum,
    rowCount: args.envelope.row_count,
  };
}

export async function readOwlsEnvelope(
  store: OwlsObjectStore,
  key: string
): Promise<OwlsArchiveEnvelope> {
  const obj = await store.get(key);
  if (!obj) throw new Error(`Missing Owls archive object: ${key}`);
  let envelope: OwlsArchiveEnvelope;
  try {
    envelope = gunzipJson<OwlsArchiveEnvelope>(obj.body);
  } catch (err) {
    throw new Error(`Corrupted Owls archive (gunzip/json failed): ${key}: ${String(err)}`);
  }
  if (!verifyEnvelopeChecksum(envelope)) {
    throw new Error(`Corrupted Owls archive (checksum mismatch): ${key}`);
  }
  return envelope;
}

export function estimateGzipBytes(envelope: OwlsArchiveEnvelope): number {
  return gzipJson(envelope).byteLength;
}
