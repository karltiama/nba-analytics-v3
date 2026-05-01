/**
 * Thin S3 client wrapper for the NBA data lake.
 *
 * Used by archive scripts (and later curated/feature pipelines). Skip-if-exists
 * is the default for every writer so reruns are safe and idempotent; pass
 * `{ overwrite: true }` to force-replace.
 *
 * Env: AWS_REGION (used when no client/region is provided). The bucket is
 * passed in by the caller (typically NBA_DATA_BUCKET).
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';

export type S3StorageOpts = {
  bucket: string;
  region?: string;
  client?: S3Client;
};

export type WriteResult = {
  written: boolean;
  reason: 'written' | 'exists';
  count?: number;
};

export type ListedObject = {
  key: string;
  size: number;
  lastModified: Date | undefined;
};

export class S3Storage {
  readonly bucket: string;
  private readonly client: S3Client;

  constructor(opts: S3StorageOpts) {
    if (!opts.bucket) {
      throw new Error('S3Storage: bucket is required');
    }
    this.bucket = opts.bucket;
    this.client =
      opts.client ??
      new S3Client({ region: opts.region ?? process.env.AWS_REGION ?? 'us-east-1' });
  }

  async objectExists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (err: unknown) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }

  async putJson(
    key: string,
    obj: unknown,
    opts?: { overwrite?: boolean }
  ): Promise<WriteResult> {
    if (!opts?.overwrite && (await this.objectExists(key))) {
      return { written: false, reason: 'exists' };
    }
    const body = JSON.stringify(obj, null, 2) + '\n';
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: 'application/json',
      })
    );
    return { written: true, reason: 'written' };
  }

  async putJsonLines(
    key: string,
    rows: readonly unknown[],
    opts?: { overwrite?: boolean }
  ): Promise<WriteResult> {
    if (!opts?.overwrite && (await this.objectExists(key))) {
      return { written: false, reason: 'exists', count: 0 };
    }
    const body = serializeJsonLines(rows);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: 'application/x-ndjson',
      })
    );
    return { written: true, reason: 'written', count: rows.length };
  }

  /**
   * Streaming variant: collects rows from an async iterable into an in-memory
   * NDJSON body and uploads in one PutObject. Bounded by partition size.
   */
  async putJsonLinesStream(
    key: string,
    source: AsyncIterable<unknown>,
    opts?: { overwrite?: boolean }
  ): Promise<WriteResult> {
    if (!opts?.overwrite && (await this.objectExists(key))) {
      return { written: false, reason: 'exists', count: 0 };
    }
    const parts: string[] = [];
    let count = 0;
    for await (const row of source) {
      parts.push(JSON.stringify(row));
      count += 1;
    }
    const body = parts.join('\n') + (count > 0 ? '\n' : '');
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: 'application/x-ndjson',
      })
    );
    return { written: true, reason: 'written', count };
  }

  async getJson<T>(key: string): Promise<T | null> {
    try {
      const out = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key })
      );
      if (!out.Body) return null;
      const text = await out.Body.transformToString();
      return JSON.parse(text) as T;
    } catch (err: unknown) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  /** Raw UTF-8 body (e.g. NDJSON lines). */
  async getText(key: string): Promise<string | null> {
    try {
      const out = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key })
      );
      if (!out.Body) return null;
      return await out.Body.transformToString();
    } catch (err: unknown) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async putText(
    key: string,
    body: string,
    opts?: { overwrite?: boolean; contentType?: string }
  ): Promise<WriteResult> {
    if (!opts?.overwrite && (await this.objectExists(key))) {
      return { written: false, reason: 'exists' };
    }
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: opts?.contentType ?? 'text/plain; charset=utf-8',
      })
    );
    return { written: true, reason: 'written' };
  }

  async *listByPrefix(prefix: string): AsyncIterable<ListedObject> {
    let token: string | undefined;
    do {
      const out = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: token,
        })
      );
      for (const obj of out.Contents ?? []) {
        if (obj.Key) {
          yield {
            key: obj.Key,
            size: obj.Size ?? 0,
            lastModified: obj.LastModified,
          };
        }
      }
      token = out.IsTruncated ? out.NextContinuationToken : undefined;
    } while (token);
  }
}

function serializeJsonLines(rows: readonly unknown[]): string {
  if (rows.length === 0) return '';
  return rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
}

function isNotFound(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  if (e.name === 'NotFound' || e.name === 'NoSuchKey') return true;
  if (e.Code === 'NotFound' || e.Code === 'NoSuchKey') return true;
  if (e.$metadata?.httpStatusCode === 404) return true;
  return false;
}
