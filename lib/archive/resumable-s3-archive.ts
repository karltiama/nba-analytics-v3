/**
 * Resumable S3 page writer for trial archive jobs. Postgres-free.
 */

import { S3Storage } from '@/lib/aws/s3';
import { BdlArchiveClient, type BdlEnvelope, type PaginationStyle } from '@/lib/balldontlie/archive-client';

export type ResumableArchiveResult = {
  pageCount: number;
  recordCount: number;
  written: number;
  skipped: number;
  status: 'success' | 'skipped' | 'dry-run';
};

export async function archiveCursorEndpointToS3(args: {
  client: BdlArchiveClient;
  s3: S3Storage;
  prefix: string;
  path: string;
  params: Record<string, string | number | string[]>;
  paginationStyle?: PaginationStyle;
  overwrite?: boolean;
  dryRun?: boolean;
}): Promise<ResumableArchiveResult> {
  if (args.dryRun) {
    return { pageCount: 0, recordCount: 0, written: 0, skipped: 0, status: 'dry-run' };
  }
  let pageCount = 0;
  let recordCount = 0;
  let written = 0;
  let skipped = 0;
  const style = args.paginationStyle ?? 'cursor';
  for await (const page of args.client.paginate({
    path: args.path,
    params: args.params,
    paginationStyle: style,
    perPage: 100,
  })) {
    pageCount += 1;
    recordCount += Array.isArray(page.body.data) ? page.body.data.length : 0;
    const key = `${args.prefix}/page=${page.pageIndex}.json`;
    const result = await args.s3.putJson(key, page.body, { overwrite: args.overwrite === true });
    if (result.written) written += 1;
    else skipped += 1;
  }
  const manifest = {
    schemaVersion: 1,
    source: 'balldontlie',
    entity: args.prefix.split('entity=')[1] ?? 'unknown',
    endpoint: args.path,
    pageCount,
    recordCount,
    status: pageCount > 0 ? 'success' : 'skipped',
    fetchedAt: new Date().toISOString(),
  };
  await args.s3.putJson(`${args.prefix}/_manifest.json`, manifest, { overwrite: true });
  return {
    pageCount,
    recordCount,
    written,
    skipped,
    status: pageCount > 0 ? 'success' : 'skipped',
  };
}

export async function archiveJsonObjectToS3(args: {
  s3: S3Storage;
  key: string;
  body: unknown;
  overwrite?: boolean;
}): Promise<{ written: boolean }> {
  const result = await args.s3.putJson(args.key, args.body as object, {
    overwrite: args.overwrite === true,
  });
  return { written: result.written };
}

export type { BdlEnvelope };
