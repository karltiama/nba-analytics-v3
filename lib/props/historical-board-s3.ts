/**
 * Read-only S3 adapter. GetObject is the only command this module sends.
 * On Vercel, the first request exchanges the runtime OIDC token for a
 * one-hour role session. Local commands keep the default AWS chain.
 */
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { awsCredentialsProvider } from '@vercel/oidc-aws-credentials-provider';
import { HISTORICAL_BOARD_BUCKET, HISTORICAL_BOARD_REGION } from '@/lib/props/historical-board-config';
import {
  HISTORICAL_BOARD_MAX_COMPRESSED_BYTES,
  HISTORICAL_BOARD_S3_PREFIX,
  type HistoricalBoardObjectStore,
} from '@/lib/props/historical-board-archive';

if (typeof window !== 'undefined') throw new Error('archive_client_rejected');

export type HistoricalBoardS3Body = Uint8Array | Buffer | null;

export type HistoricalBoardS3Get = (input: { Bucket: string; Key: string }) => Promise<{ Body?: HistoricalBoardS3Body }>;

type ObjectBody = {
  transformToWebStream?: () => ReadableStream<Uint8Array>;
  transformToByteArray?: () => Promise<Uint8Array>;
};

export type HistoricalBoardS3Sender = {
  send: (
    command: GetObjectCommand,
    options?: { abortSignal?: AbortSignal }
  ) => Promise<{ Body?: ObjectBody; ContentLength?: number }>;
};

export function s3HistoricalBoardStore(args: {
  bucket: string;
  getObject: HistoricalBoardS3Get;
}): HistoricalBoardObjectStore {
  return {
    async getObject(objectKey: string) {
      if (!objectKey.startsWith(HISTORICAL_BOARD_S3_PREFIX)) throw new Error('archive_key_rejected');
      const result = await args.getObject({ Bucket: args.bucket, Key: objectKey });
      if (!result.Body) return null;
      return Buffer.from(result.Body);
    },
  };
}

async function readBounded(body: ObjectBody): Promise<Buffer> {
  if (body.transformToWebStream) {
    const reader = body.transformToWebStream().getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const step = await reader.read();
      if (step.done) break;
      total += step.value.byteLength;
      if (total > HISTORICAL_BOARD_MAX_COMPRESSED_BYTES) {
        await reader.cancel();
        throw new Error('archive_too_large');
      }
      chunks.push(Buffer.from(step.value));
    }
    return Buffer.concat(chunks);
  }
  if (body.transformToByteArray) {
    const bytes = Buffer.from(await body.transformToByteArray());
    if (bytes.length > HISTORICAL_BOARD_MAX_COMPRESSED_BYTES) throw new Error('archive_too_large');
    return bytes;
  }
  throw new Error('archive_unavailable');
}

function asArchiveError(error: unknown): Error {
  if (error instanceof Error && (error.message === 'archive_too_large' || error.message === 'archive_key_rejected')) {
    return error;
  }
  const name = typeof error === 'object' && error && 'name' in error ? String(error.name) : '';
  const status = typeof error === 'object' && error && '$metadata' in error
    ? (error.$metadata as { httpStatusCode?: number }).httpStatusCode
    : undefined;
  if (name === 'NoSuchKey' || name === 'NotFound' || status === 404) return new Error('archive_object_missing');
  if (name === 'AccessDenied' || name === 'Forbidden' || status === 403) return new Error('archive_access_denied');
  return new Error('archive_unavailable');
}

/** One GetObject. The bucket is the approved private bucket and cannot be overridden. */
export function historicalBoardS3ClientStore(client: HistoricalBoardS3Sender): HistoricalBoardObjectStore {
  return {
    async getObject(objectKey: string) {
      if (!objectKey.startsWith(HISTORICAL_BOARD_S3_PREFIX)) throw new Error('archive_key_rejected');
      try {
        const result = await client.send(
          new GetObjectCommand({
            Bucket: HISTORICAL_BOARD_BUCKET,
            Key: objectKey,
            ChecksumMode: 'ENABLED',
          }),
          { abortSignal: AbortSignal.timeout(10_000) }
        );
        if (result.ContentLength != null && result.ContentLength > HISTORICAL_BOARD_MAX_COMPRESSED_BYTES) {
          throw new Error('archive_too_large');
        }
        if (!result.Body) return null;
        return await readBounded(result.Body);
      } catch (error) {
        throw asArchiveError(error);
      }
    },
  };
}

export const HISTORICAL_BOARD_PRODUCTION_ROLE_ARN =
  'arn:aws:iam::260029269390:role/court-context-historical-board-read-production';
export const HISTORICAL_BOARD_PREVIEW_ROLE_ARN =
  'arn:aws:iam::260029269390:role/court-context-historical-board-read-preview';

const APPROVED_ROLE_ARNS = new Set([
  HISTORICAL_BOARD_PRODUCTION_ROLE_ARN,
  HISTORICAL_BOARD_PREVIEW_ROLE_ARN,
]);

type HistoricalBoardCredentialProvider = ReturnType<typeof awsCredentialsProvider>;

/** Returns a lazy provider. The token is read only when S3 asks for credentials. */
export function historicalBoardCredentialProvider(
  env: { [name: string]: string | undefined },
  createProvider: (roleArn: string) => HistoricalBoardCredentialProvider = (roleArn) =>
    awsCredentialsProvider({
      roleArn,
      clientConfig: { region: HISTORICAL_BOARD_REGION },
    })
): HistoricalBoardCredentialProvider | undefined {
  if (env.VERCEL !== '1') return undefined;
  const roleArn = env.AWS_ROLE_ARN?.trim() ?? '';
  if (!APPROVED_ROLE_ARNS.has(roleArn)) throw new Error('archive_config_rejected');
  return createProvider(roleArn);
}

export function openHistoricalBoardS3Store(): HistoricalBoardObjectStore {
  const credentials = historicalBoardCredentialProvider({
    VERCEL: process.env.VERCEL,
    AWS_ROLE_ARN: process.env.AWS_ROLE_ARN,
  });
  return historicalBoardS3ClientStore(new S3Client({
    region: HISTORICAL_BOARD_REGION,
    ...(credentials ? { credentials } : {}),
  }));
}
