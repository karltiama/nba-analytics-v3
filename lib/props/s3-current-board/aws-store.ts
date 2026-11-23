/**
 * Server-side S3 adapter for the current props board.
 * Checksums stay in the archive envelope. The ETag is the value S3 returns.
 */
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { isProtectedHistoricalKey } from '@/lambda/player-props-snapshot/src/player-prop-snapshot-archive';
import { classifyConditionalPutError } from '@/lambda/player-props-snapshot/src/s3-archive';
import type { ConditionalPutResult } from '@/lambda/player-props-snapshot/src/player-prop-snapshot-archive';
import type { ObjectCondition, PutResult, StoredObject } from '@/lambda/player-props-snapshot/src/f39b/store';

if (typeof window !== 'undefined') throw new Error('s3 current board client rejected');

export class S3ObjectError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'S3ObjectError';
    this.retryable = retryable;
  }
}

export type AwsCurrentBoardConfig = {
  bucket: string;
  region?: string;
  rawPrefix?: string;
  readOnly?: boolean;
  client?: S3Client;
};

const POINTER_KEY = /^current\/source=balldontlie\/league=nba\/entity=player_prop_current\/game_id=\d+\/pointer\.json$/;

export function assertCurrentBoardKey(key: string, rawPrefix = 'raw'): void {
  if (!key || key.startsWith('/') || key.includes('\\') || key.includes('..')) {
    throw new S3ObjectError('s3 key is not a current-board object', false);
  }
  if (isProtectedHistoricalKey(key)) {
    throw new S3ObjectError('s3 key is a protected historical object', false);
  }
  if (POINTER_KEY.test(key)) return;
  const prefix = `${rawPrefix.replace(/^\/+|\/+$/g, '') || 'raw'}/source=balldontlie/league=nba/`;
  const archive = key.startsWith(prefix) && key.includes('/entity=player_prop_snapshots/');
  const manifest = archive && key.endsWith('.json.gz.publication.json');
  const object = archive && (key.endsWith('.json.gz') || manifest);
  if (!object) throw new S3ObjectError('s3 key is not a current-board object', false);
}

export class AwsCurrentBoardStore {
  readonly bucket: string;
  readonly readOnly: boolean;
  private readonly client: S3Client;
  private readonly rawPrefix: string;

  constructor(config: AwsCurrentBoardConfig & { client: S3Client }) {
    this.bucket = config.bucket;
    this.readOnly = config.readOnly === true;
    this.client = config.client;
    this.rawPrefix = config.rawPrefix ?? 'raw';
  }

  async get(key: string): Promise<StoredObject | null> {
    assertCurrentBoardKey(key, this.rawPrefix);
    try {
      const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!out.Body || !out.ETag) throw new S3ObjectError('s3 object is missing a body or etag', false);
      const bytes = await out.Body.transformToByteArray();
      return { body: Buffer.from(bytes), metadata: lowercaseMeta(out.Metadata), etag: out.ETag };
    } catch (err) {
      if (err instanceof S3ObjectError) throw err;
      if (isMissing(err)) return null;
      throw classifyFailure(err);
    }
  }

  async put(
    key: string,
    body: Buffer,
    metadata: Record<string, string>,
    condition: ObjectCondition
  ): Promise<PutResult> {
    assertCurrentBoardKey(key, this.rawPrefix);
    if (this.readOnly) throw new S3ObjectError('s3 current board is read only', false);
    try {
      const out = await this.client.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: 'application/json',
        ...(key.endsWith('.json.gz') ? { ContentEncoding: 'gzip' } : {}),
        Metadata: metadata,
        ...(condition.kind === 'if-none-match' ? { IfNoneMatch: '*' } : { IfMatch: condition.etag }),
      }));
      if (!out.ETag) throw new S3ObjectError('s3 put returned no etag', false);
      return { ok: true, etag: out.ETag, created: condition.kind === 'if-none-match' };
    } catch (err) {
      if (err instanceof S3ObjectError) throw err;
      const conditional = classifyConditionalPutError(err);
      if (conditional === 'conditional_conflict') return { ok: false, status: 409, etag: null };
      if (conditional === 'precondition_failed') return { ok: false, status: 412, etag: null };
      throw classifyFailure(err);
    }
  }

  async putIfAbsent(
    key: string,
    body: Buffer,
    metadata: Record<string, string>
  ): Promise<ConditionalPutResult> {
    const result = await this.put(key, body, metadata, { kind: 'if-none-match', etag: '*' });
    if (result.ok) return 'created';
    return result.status === 409 ? 'conditional_conflict' : 'precondition_failed';
  }
}

export function createAwsCurrentBoardStore(config: AwsCurrentBoardConfig): AwsCurrentBoardStore {
  const bucket = config.bucket?.trim() ?? '';
  if (!bucket || /[/\\\s]/.test(bucket)) throw new S3ObjectError('s3 bucket is not configured', false);
  const client = config.client ?? new S3Client({ region: config.region ?? process.env.AWS_REGION ?? 'us-east-1' });
  return new AwsCurrentBoardStore({ ...config, bucket, client });
}

function lowercaseMeta(meta: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(meta ?? {})) out[key.toLowerCase()] = value;
  return out;
}

function isMissing(err: unknown): boolean {
  if (typeof err !== 'object' || err == null) return false;
  const value = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return value.name === 'NotFound' || value.name === 'NoSuchKey' || value.$metadata?.httpStatusCode === 404;
}

function classifyFailure(err: unknown): S3ObjectError {
  const value = typeof err === 'object' && err != null
    ? err as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } }
    : {};
  const status = value.$metadata?.httpStatusCode;
  const retryable = status === 429 || status === 500 || status === 502 || status === 503 || status === 504
    || value.name === 'SlowDown'
    || value.name === 'InternalError'
    || value.name === 'ServiceUnavailable';
  const detail = value.message ? `: ${value.message.slice(0, 200)}` : '';
  return new S3ObjectError(`s3 request failed${status ? ` http=${status}` : ''}${detail}`, retryable);
}
