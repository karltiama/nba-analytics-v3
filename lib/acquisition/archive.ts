/**
 * Immutable acquisition archive writer (DATA1 §3, §2.1 failure policy).
 *
 * - gzip JSON envelope, conditional PutObject (IfNoneMatch: "*"); never overwrites.
 * - On precondition conflict: HEAD the existing object and compare body-sha256.
 *   equal → ARCHIVED / IDEMPOTENT_SUCCESS, different → IMMUTABILITY_CONFLICT (loud).
 * - No overwrite fallback, no delete. Stores expose no delete operation.
 *
 * Collector contract (not implemented here): a collector must NOT validate, normalize,
 * or write serving data unless the outcome is ARCHIVED. ARCHIVE_FAILED and
 * IMMUTABILITY_CONFLICT are fail-closed for that request.
 */

import { gunzipSync, gzipSync } from 'node:zlib';
import { decodeBody, sha256Hex } from './capture';
import { ACQ_ENVELOPE_VERSION, type AcqEnvelopeV1, envelopeSha256, serializeEnvelope } from './envelope';
import { buildAcquisitionKey } from './keys';

export const ACQ_META = {
  bodySha256: 'body-sha256',
  envelopeSha256: 'envelope-sha256',
  requestId: 'request-id',
  pullRunId: 'pull-run-id',
  envelopeVersion: 'envelope-version',
  bodySemantics: 'body-semantics',
} as const;

/** Sentinel body-sha256 for transport-error envelopes (no response body exists). */
export const ACQ_NO_BODY_SHA256 = 'none';

export type AcqPutResult = 'created' | 'exists';

export interface AcqArchiveStore {
  /** Create-only write. Returns 'exists' on precondition failure; throws on any other error. */
  putIfAbsent(input: {
    key: string;
    body: Buffer;
    metadata: Record<string, string>;
    contentType: string;
    contentEncoding: string;
  }): Promise<AcqPutResult>;
  head(key: string): Promise<{ metadata: Record<string, string> } | null>;
  get(key: string): Promise<{ body: Buffer; metadata: Record<string, string> } | null>;
}

export type AcqArchiveStatus = 'ARCHIVED' | 'ARCHIVE_FAILED' | 'IMMUTABILITY_CONFLICT';

export type AcqArchiveOutcome =
  | {
      status: 'ARCHIVED';
      write: 'CREATED' | 'IDEMPOTENT_SUCCESS';
      key: string;
      body_sha256: string;
      envelope_sha256: string;
      gzip_bytes: number;
      archived_at: string;
    }
  | {
      status: 'ARCHIVE_FAILED';
      key: string | null;
      reason: 'invalid_envelope' | 'put_failed' | 'head_failed' | 'readback_missing' | 'readback_mismatch';
      error: string;
    }
  | {
      status: 'IMMUTABILITY_CONFLICT';
      key: string;
      expected_body_sha256: string;
      existing_body_sha256: string | null;
      expected_envelope_sha256: string;
      existing_envelope_sha256: string | null;
    };

export class AcqArchiveError extends Error {
  constructor(
    message: string,
    readonly outcome: AcqArchiveOutcome
  ) {
    super(message);
    this.name = 'AcqArchiveError';
  }
}

export function archiveMetadata(env: AcqEnvelopeV1): Record<string, string> {
  return {
    [ACQ_META.bodySha256]: env.response?.body_sha256 ?? ACQ_NO_BODY_SHA256,
    [ACQ_META.envelopeSha256]: envelopeSha256(env),
    [ACQ_META.requestId]: env.identity.request_id,
    [ACQ_META.pullRunId]: env.identity.pull_run_id,
    [ACQ_META.envelopeVersion]: ACQ_ENVELOPE_VERSION,
    [ACQ_META.bodySemantics]: env.response?.body_semantics ?? 'none',
  };
}

export function encodeEnvelopeObject(env: AcqEnvelopeV1): Buffer {
  return gzipSync(Buffer.from(serializeEnvelope(env), 'utf8'));
}

/** Same observation iff body checksums match (and, for body-less envelopes, envelope checksums match). */
function sameEvidence(expected: Record<string, string>, existing: Record<string, string>): boolean {
  const eb = expected[ACQ_META.bodySha256];
  if (existing[ACQ_META.bodySha256] !== eb) return false;
  if (eb === ACQ_NO_BODY_SHA256) return existing[ACQ_META.envelopeSha256] === expected[ACQ_META.envelopeSha256];
  return true;
}

export async function archiveEnvelope(args: {
  store: AcqArchiveStore;
  envelope: AcqEnvelopeV1;
  rawPrefix?: string;
  now?: () => Date;
  logger?: Pick<Console, 'error'>;
}): Promise<AcqArchiveOutcome> {
  const now = args.now ?? (() => new Date());
  const logger = args.logger ?? console;

  let key: string;
  let metadata: Record<string, string>;
  let body: Buffer;
  try {
    key = buildAcquisitionKey(args.envelope, { rawPrefix: args.rawPrefix });
    metadata = archiveMetadata(args.envelope);
    body = encodeEnvelopeObject(args.envelope);
  } catch (err) {
    return { status: 'ARCHIVE_FAILED', key: null, reason: 'invalid_envelope', error: errMessage(err) };
  }

  let put: AcqPutResult;
  try {
    put = await args.store.putIfAbsent({
      key,
      body,
      metadata,
      contentType: 'application/json',
      contentEncoding: 'gzip',
    });
  } catch (err) {
    return { status: 'ARCHIVE_FAILED', key, reason: 'put_failed', error: errMessage(err) };
  }

  let head: { metadata: Record<string, string> } | null;
  try {
    head = await args.store.head(key);
  } catch (err) {
    return { status: 'ARCHIVE_FAILED', key, reason: 'head_failed', error: errMessage(err) };
  }
  if (!head) {
    return { status: 'ARCHIVE_FAILED', key, reason: 'readback_missing', error: `object missing after ${put}` };
  }
  const existing = lowercaseKeys(head.metadata);

  if (sameEvidence(metadata, existing)) {
    return {
      status: 'ARCHIVED',
      write: put === 'created' ? 'CREATED' : 'IDEMPOTENT_SUCCESS',
      key,
      body_sha256: metadata[ACQ_META.bodySha256],
      envelope_sha256: metadata[ACQ_META.envelopeSha256],
      gzip_bytes: body.byteLength,
      archived_at: now().toISOString(),
    };
  }

  if (put === 'created') {
    // We just created it, yet readback disagrees: storage problem, not a second writer.
    return {
      status: 'ARCHIVE_FAILED',
      key,
      reason: 'readback_mismatch',
      error: 'metadata read back after create does not match the written checksum',
    };
  }

  const conflict: AcqArchiveOutcome = {
    status: 'IMMUTABILITY_CONFLICT',
    key,
    expected_body_sha256: metadata[ACQ_META.bodySha256],
    existing_body_sha256: existing[ACQ_META.bodySha256] ?? null,
    expected_envelope_sha256: metadata[ACQ_META.envelopeSha256],
    existing_envelope_sha256: existing[ACQ_META.envelopeSha256] ?? null,
  };
  logger.error(JSON.stringify({ event: 'acq_archive_immutability_conflict', ...conflict }));
  return conflict;
}

/** Only ARCHIVED permits validate → normalize → serve. */
export function mayProceedAfterArchive(outcome: AcqArchiveOutcome): boolean {
  return outcome.status === 'ARCHIVED';
}

export function assertArchived(outcome: AcqArchiveOutcome): asserts outcome is Extract<AcqArchiveOutcome, { status: 'ARCHIVED' }> {
  if (outcome.status !== 'ARCHIVED') {
    throw new AcqArchiveError(`acquisition archive not safe to proceed: ${outcome.status}`, outcome);
  }
}

/**
 * Read an archived envelope and verify the body checksum against both the object
 * metadata and the envelope. Intended for replay-not-refetch (DATA1 §4.6).
 */
export async function readArchivedEnvelope(store: AcqArchiveStore, key: string): Promise<AcqEnvelopeV1> {
  const obj = await store.get(key);
  if (!obj) throw new Error(`acquisition object not found: ${key}`);
  const env = JSON.parse(gunzipSync(obj.body).toString('utf8')) as AcqEnvelopeV1;
  const meta = lowercaseKeys(obj.metadata);
  if (env.response) {
    const actual = sha256Hex(decodeBody(env.response));
    if (actual !== env.response.body_sha256) throw new Error(`body checksum mismatch inside envelope: ${key}`);
    if (meta[ACQ_META.bodySha256] !== actual) throw new Error(`body checksum mismatch vs object metadata: ${key}`);
  } else if (meta[ACQ_META.bodySha256] !== ACQ_NO_BODY_SHA256) {
    throw new Error(`metadata claims a body but envelope has none: ${key}`);
  }
  if (meta[ACQ_META.envelopeSha256] !== envelopeSha256(env)) {
    throw new Error(`envelope checksum mismatch vs object metadata: ${key}`);
  }
  return env;
}

/** Deterministic in-memory store for tests and local simulation. No AWS. */
export class InMemoryAcqArchiveStore implements AcqArchiveStore {
  readonly objects = new Map<
    string,
    { body: Buffer; metadata: Record<string, string>; contentType: string; contentEncoding: string }
  >();
  putCalls = 0;

  async putIfAbsent(input: Parameters<AcqArchiveStore['putIfAbsent']>[0]): Promise<AcqPutResult> {
    this.putCalls += 1;
    if (this.objects.has(input.key)) return 'exists';
    this.objects.set(input.key, {
      body: Buffer.from(input.body),
      metadata: lowercaseKeys(input.metadata),
      contentType: input.contentType,
      contentEncoding: input.contentEncoding,
    });
    return 'created';
  }

  async head(key: string) {
    const o = this.objects.get(key);
    return o ? { metadata: { ...o.metadata } } : null;
  }

  async get(key: string) {
    const o = this.objects.get(key);
    return o ? { body: Buffer.from(o.body), metadata: { ...o.metadata } } : null;
  }
}

export function lowercaseKeys(meta: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(meta ?? {})) out[k.toLowerCase()] = v;
  return out;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}
