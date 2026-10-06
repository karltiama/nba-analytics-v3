/**
 * S3 adapter for the acquisition archive. Create-only: PutObject with IfNoneMatch "*".
 * Exposes no delete and no unconditional put. Required IAM: s3:PutObject + s3:GetObject
 * (HeadObject is authorized by s3:GetObject) on the acq_* prefixes only.
 */

import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { type AcqArchiveStore, type AcqPutResult, lowercaseKeys } from './archive';

export type S3AcqArchiveStoreConfig = {
  bucket: string;
  region?: string;
  client?: S3Client;
};

export class S3AcqArchiveStore implements AcqArchiveStore {
  readonly bucket: string;
  private readonly client: S3Client;

  constructor(cfg: S3AcqArchiveStoreConfig) {
    if (!cfg.bucket?.trim()) throw new Error('S3AcqArchiveStore requires a bucket');
    this.bucket = cfg.bucket.trim();
    this.client = cfg.client ?? new S3Client({ region: cfg.region ?? process.env.AWS_REGION ?? 'us-east-1' });
  }

  async putIfAbsent(input: Parameters<AcqArchiveStore['putIfAbsent']>[0]): Promise<AcqPutResult> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
          ContentEncoding: input.contentEncoding,
          Metadata: input.metadata,
          IfNoneMatch: '*',
        })
      );
      return 'created';
    } catch (err) {
      if (isPreconditionFailed(err)) return 'exists';
      // 409 ConditionalRequestConflict (concurrent conditional write) and everything
      // else propagate; archiveEnvelope maps them to ARCHIVE_FAILED.
      throw err;
    }
  }

  async head(key: string): Promise<{ metadata: Record<string, string> } | null> {
    try {
      const out = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { metadata: lowercaseKeys(out.Metadata) };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async get(key: string): Promise<{ body: Buffer; metadata: Record<string, string> } | null> {
    try {
      const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!out.Body) return null;
      const bytes = await out.Body.transformToByteArray();
      return { body: Buffer.from(bytes), metadata: lowercaseKeys(out.Metadata) };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }
}

export function isPreconditionFailed(err: unknown): boolean {
  if (typeof err !== 'object' || err == null) return false;
  const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === 'PreconditionFailed' || e.Code === 'PreconditionFailed' || e.$metadata?.httpStatusCode === 412;
}

function isNotFound(err: unknown): boolean {
  if (typeof err !== 'object' || err == null) return false;
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === 'NotFound' || e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404;
}
