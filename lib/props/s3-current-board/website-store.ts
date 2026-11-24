/**
 * Production website credentials for the existing current-board reader.
 * Vercel exchanges its OIDC token for a one-hour role session when S3 asks.
 * This module does not verify snapshots and it does not read when the flag is off.
 */
import { S3Client } from '@aws-sdk/client-s3';
import { awsCredentialsProvider } from '@vercel/oidc-aws-credentials-provider';
import { createAwsCurrentBoardStore, type AwsCurrentBoardStore } from '@/lib/props/s3-current-board/aws-store';
import { currentPropsSource, type CurrentPropsSource } from '@/lib/props/s3-current-board/source';
import type { CurrentBoardStore } from '@/lib/props/s3-current-board/read';

if (typeof window !== 'undefined') throw new Error('current_board_client_rejected');

export const CURRENT_BOARD_BUCKET = 'nba-analytics-data-260029269390';
export const CURRENT_BOARD_REGION = 'us-east-1';
export const CURRENT_BOARD_READ_ROLE_ARN =
  'arn:aws:iam::260029269390:role/court-context-current-board-read-production';

type CredentialProvider = ReturnType<typeof awsCredentialsProvider>;

/** Selects the production role. The token stays unread until S3 requests credentials. */
export function currentBoardCredentialProvider(
  env: { [name: string]: string | undefined },
  createProvider: (roleArn: string) => CredentialProvider = (roleArn) =>
    awsCredentialsProvider({
      roleArn,
      clientConfig: { region: CURRENT_BOARD_REGION },
    })
): CredentialProvider | undefined {
  if (env.VERCEL !== '1') return undefined;
  const environment = env.VERCEL_TARGET_ENV ?? env.VERCEL_ENV;
  if (environment !== 'production') throw new Error('current_board_config_rejected');
  return createProvider(CURRENT_BOARD_READ_ROLE_ARN);
}

export function openWebsiteCurrentBoardStore(args: {
  env?: { [name: string]: string | undefined };
  credentials?: CredentialProvider;
  client?: S3Client;
} = {}): AwsCurrentBoardStore {
  if (args.client) {
    return createAwsCurrentBoardStore({
      bucket: CURRENT_BOARD_BUCKET,
      region: CURRENT_BOARD_REGION,
      readOnly: true,
      client: args.client,
    });
  }
  const credentials = args.credentials ?? currentBoardCredentialProvider(args.env ?? process.env);
  if (!credentials) throw new Error('current_board_config_rejected');
  return createAwsCurrentBoardStore({
    bucket: CURRENT_BOARD_BUCKET,
    region: CURRENT_BOARD_REGION,
    readOnly: true,
    client: new S3Client({ region: CURRENT_BOARD_REGION, credentials }),
  });
}

/** No store, and therefore no S3 client, unless the current-board flag is exactly "s3". */
export function websiteCurrentBoardStore(
  env: { [name: string]: string | undefined } = process.env,
  open: (args: { env: { [name: string]: string | undefined } }) => CurrentBoardStore = (args) =>
    openWebsiteCurrentBoardStore({ env: args.env })
): CurrentBoardStore | undefined {
  const source: CurrentPropsSource = currentPropsSource(env);
  if (source !== 's3') return undefined;
  return open({ env });
}
