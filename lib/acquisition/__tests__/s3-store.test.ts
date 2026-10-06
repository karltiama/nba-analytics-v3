import { readFileSync } from 'node:fs';
import path from 'node:path';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import { S3AcqArchiveStore, isPreconditionFailed } from '@/lib/acquisition/s3-store';

type Sent = { name: string; input: Record<string, unknown> };

function stubClient(handler: (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => unknown): S3Client & { sent: Sent[] } {
  const sent: Sent[] = [];
  return {
    sent,
    async send(cmd: { constructor: { name: string }; input: Record<string, unknown> }) {
      sent.push({ name: cmd.constructor.name, input: cmd.input });
      return handler(cmd);
    },
  } as unknown as S3Client & { sent: Sent[] };
}

const PUT = {
  key: 'raw/source=balldontlie/league=nba/season=2026/entity=acq_odds/x.json.gz',
  body: Buffer.from('gz'),
  metadata: { 'body-sha256': 'a'.repeat(64) },
  contentType: 'application/json',
  contentEncoding: 'gzip',
};

describe('S3AcqArchiveStore', () => {
  it('uses conditional PutObject with IfNoneMatch "*"', async () => {
    const client = stubClient(() => ({}));
    const store = new S3AcqArchiveStore({ bucket: 'b', client });
    expect(await store.putIfAbsent(PUT)).toBe('created');
    expect(client.sent).toHaveLength(1);
    expect(client.sent[0].name).toBe(PutObjectCommand.name);
    expect(client.sent[0].input).toMatchObject({
      Bucket: 'b',
      Key: PUT.key,
      IfNoneMatch: '*',
      ContentEncoding: 'gzip',
      Metadata: PUT.metadata,
    });
  });

  it('maps 412 PreconditionFailed to "exists" and never retries unconditionally', async () => {
    const client = stubClient(() => {
      throw Object.assign(new Error('At least one of the pre-conditions you specified did not hold'), {
        name: 'PreconditionFailed',
        $metadata: { httpStatusCode: 412 },
      });
    });
    const store = new S3AcqArchiveStore({ bucket: 'b', client });
    expect(await store.putIfAbsent(PUT)).toBe('exists');
    expect(client.sent).toHaveLength(1);
  });

  it('propagates 409 ConditionalRequestConflict and other errors', async () => {
    const client = stubClient(() => {
      throw Object.assign(new Error('conflict'), { name: 'ConditionalRequestConflict', $metadata: { httpStatusCode: 409 } });
    });
    await expect(new S3AcqArchiveStore({ bucket: 'b', client }).putIfAbsent(PUT)).rejects.toThrow('conflict');
  });

  it('HEAD returns lowercased metadata, null on 404', async () => {
    const client = stubClient((cmd) => {
      if (cmd.constructor.name === HeadObjectCommand.name && cmd.input.Key === 'missing') {
        throw Object.assign(new Error('NotFound'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });
      }
      return { Metadata: { 'Body-Sha256': 'abc' } };
    });
    const store = new S3AcqArchiveStore({ bucket: 'b', client });
    expect(await store.head('k')).toEqual({ metadata: { 'body-sha256': 'abc' } });
    expect(await store.head('missing')).toBeNull();
  });

  it('GET reads bytes', async () => {
    const client = stubClient((cmd) => {
      expect(cmd.constructor.name).toBe(GetObjectCommand.name);
      return { Body: { transformToByteArray: async () => new Uint8Array([1, 2]) }, Metadata: {} };
    });
    const out = await new S3AcqArchiveStore({ bucket: 'b', client }).get('k');
    expect(out!.body.equals(Buffer.from([1, 2]))).toBe(true);
  });

  it('isPreconditionFailed recognizes name, Code, and status', () => {
    expect(isPreconditionFailed({ name: 'PreconditionFailed' })).toBe(true);
    expect(isPreconditionFailed({ Code: 'PreconditionFailed' })).toBe(true);
    expect(isPreconditionFailed({ $metadata: { httpStatusCode: 412 } })).toBe(true);
    expect(isPreconditionFailed({ $metadata: { httpStatusCode: 409 } })).toBe(false);
  });

  it('source has no delete or unconditional-put path', () => {
    const src = readFileSync(path.resolve(__dirname, '../s3-store.ts'), 'utf8');
    expect(src).not.toMatch(/DeleteObject/);
    expect(src).not.toMatch(/CopyObject/);
    expect((src.match(/new PutObjectCommand\(/g) ?? []).length).toBe(1);
    expect(src).toContain("IfNoneMatch: '*'");
  });
});
