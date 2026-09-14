/**
 * Lambda S3 adapter for player-prop snapshot archives.
 * Uses the copied canonical format module. No writes to existing_ingestion.
 */

import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  type ArchiveWriteOutcome,
  type InMemoryS3Object,
  type PlayerPropArchiveEnvelope,
  writeArchiveObject,
} from './player-prop-snapshot-archive';

export type PlayerPropArchiveS3Config = {
  bucket: string;
  region?: string;
  client?: S3Client;
};

export class PlayerPropArchiveS3Store {
  readonly bucket: string;
  private readonly client: S3Client;

  constructor(cfg: PlayerPropArchiveS3Config) {
    this.bucket = cfg.bucket;
    this.client = cfg.client ?? new S3Client({ region: cfg.region ?? process.env.AWS_REGION ?? 'us-east-1' });
  }

  async head(key: string): Promise<{ metadata: Record<string, string> } | null> {
    try {
      const out = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { metadata: lowercaseMeta(out.Metadata) };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async get(key: string): Promise<InMemoryS3Object | null> {
    try {
      const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!out.Body) return null;
      const bytes = await out.Body.transformToByteArray();
      return { body: Buffer.from(bytes), metadata: lowercaseMeta(out.Metadata) };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async put(key: string, body: Buffer, metadata: Record<string, string>): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: 'application/json',
        ContentEncoding: 'gzip',
        Metadata: metadata,
      })
    );
  }
}

export async function putPlayerPropArchiveObject(args: {
  store: PlayerPropArchiveS3Store;
  key: string;
  envelope: PlayerPropArchiveEnvelope;
}): Promise<ArchiveWriteOutcome> {
  return writeArchiveObject(args);
}

function lowercaseMeta(meta: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(meta ?? {})) out[k.toLowerCase()] = v;
  return out;
}

function isNotFound(err: unknown): boolean {
  if (typeof err !== 'object' || err == null) return false;
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === 'NotFound' || e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404;
}
