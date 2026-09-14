import { GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { assertWritableOwlsKey, type OwlsObjectStore } from './archive';

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

export class OwlsS3Store implements OwlsObjectStore {
  constructor(
    private readonly bucket: string,
    private readonly client: S3Client = new S3Client({
      region: process.env.AWS_REGION ?? 'us-east-1',
    })
  ) {}

  async head(key: string): Promise<{ metadata: Record<string, string> } | null> {
    try {
      const out = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { metadata: lowercaseMeta(out.Metadata) };
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
      return { body: Buffer.from(bytes), metadata: lowercaseMeta(out.Metadata) };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async put(key: string, body: Buffer, metadata: Record<string, string>): Promise<void> {
    assertWritableOwlsKey(key);
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

  async listKeys(prefix: string): Promise<string[]> {
    const keys: string[] = [];
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
        if (obj.Key) keys.push(obj.Key);
      }
      token = out.IsTruncated ? out.NextContinuationToken : undefined;
    } while (token);
    return keys;
  }
}
