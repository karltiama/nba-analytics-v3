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
  resumedFromPage: number | null;
  startCursor: string | number | null;
  lastNextCursor: string | number | null;
  exhausted: boolean;
  status: 'success' | 'skipped' | 'dry-run' | 'already-complete';
};

const PAGE_KEY = /\/page=(\d+)\.json$/;
const MAX_PAGES_FAIL_CLOSED = 2000;

export function assertAdvancingCursor(
  seenNextCursors: Set<string>,
  requestCursor: string | number | null,
  nextCursor: string | number | null
): void {
  if (nextCursor == null) return;
  const next = String(nextCursor);
  const req = requestCursor == null ? null : String(requestCursor);
  if (req != null && next === req) {
    throw new Error(`BDL cursor loop: next_cursor repeated the request cursor ${next}`);
  }
  if (seenNextCursors.has(next)) {
    throw new Error(`BDL cursor loop: next_cursor ${next} already seen`);
  }
  seenNextCursors.add(next);
}

export async function listArchivePageKeys(s3: S3Storage, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  const base = prefix.replace(/\/+$/, '');
  for await (const obj of s3.listByPrefix(`${base}/`)) {
    if (PAGE_KEY.test(obj.key)) keys.push(obj.key);
  }
  keys.sort((a, b) => {
    const na = Number((a.match(PAGE_KEY) ?? [])[1] ?? 0);
    const nb = Number((b.match(PAGE_KEY) ?? [])[1] ?? 0);
    return na - nb;
  });
  return keys;
}

async function resumeState(
  s3: S3Storage,
  prefix: string
): Promise<{
  startPage: number;
  startCursor: string | number | null;
  alreadyComplete: boolean;
  existingPages: number;
  existingRecords: number;
  seenNextCursors: Set<string>;
}> {
  const keys = await listArchivePageKeys(s3, prefix);
  if (!keys.length) {
    return {
      startPage: 1,
      startCursor: null,
      alreadyComplete: false,
      existingPages: 0,
      existingRecords: 0,
      seenNextCursors: new Set(),
    };
  }
  const lastKey = keys[keys.length - 1]!;
  const lastIndex = Number((lastKey.match(PAGE_KEY) ?? [])[1] ?? 0);
  const last = await s3.getJson<BdlEnvelope>(lastKey);
  const nextCursor = (last?.meta?.next_cursor ?? null) as string | number | null;
  const seenNextCursors = new Set<string>();
  let existingRecords = 0;
  for (const key of keys) {
    const body = await s3.getJson<BdlEnvelope>(key);
    existingRecords += Array.isArray(body?.data) ? body!.data.length : 0;
    const nxt = body?.meta?.next_cursor;
    if (nxt != null) seenNextCursors.add(String(nxt));
  }
  return {
    startPage: lastIndex + 1,
    startCursor: nextCursor,
    alreadyComplete: nextCursor == null,
    existingPages: keys.length,
    existingRecords,
    seenNextCursors,
  };
}

export async function archiveCursorEndpointToS3(args: {
  client: BdlArchiveClient;
  s3: S3Storage;
  prefix: string;
  path: string;
  params: Record<string, string | number | string[]>;
  paginationStyle?: PaginationStyle;
  overwrite?: boolean;
  dryRun?: boolean;
  logger?: (msg: string) => void;
}): Promise<ResumableArchiveResult> {
  if (args.dryRun) {
    return {
      pageCount: 0,
      recordCount: 0,
      written: 0,
      skipped: 0,
      resumedFromPage: null,
      startCursor: null,
      lastNextCursor: null,
      exhausted: false,
      status: 'dry-run',
    };
  }
  const log = args.logger ?? ((msg: string) => console.log(msg));
  const style = args.paginationStyle ?? 'cursor';
  const resume = args.overwrite === true
    ? {
        startPage: 1,
        startCursor: null as string | number | null,
        alreadyComplete: false,
        existingPages: 0,
        existingRecords: 0,
        seenNextCursors: new Set<string>(),
      }
    : await resumeState(args.s3, args.prefix);

  if (resume.alreadyComplete) {
    const manifest = {
      schemaVersion: 1,
      source: 'balldontlie',
      entity: args.prefix.split('entity=')[1] ?? 'unknown',
      endpoint: args.path,
      pageCount: resume.existingPages,
      recordCount: resume.existingRecords,
      status: 'success',
      fetchedAt: new Date().toISOString(),
      cursorExhausted: true,
    };
    await args.s3.putJson(`${args.prefix}/_manifest.json`, manifest, { overwrite: true });
    return {
      pageCount: resume.existingPages,
      recordCount: resume.existingRecords,
      written: 0,
      skipped: resume.existingPages,
      resumedFromPage: resume.existingPages,
      startCursor: null,
      lastNextCursor: null,
      exhausted: true,
      status: 'already-complete',
    };
  }

  let pageCount = resume.existingPages;
  let recordCount = resume.existingRecords;
  let written = 0;
  let skipped = 0;
  let lastNextCursor: string | number | null = resume.startCursor;
  let requestCursor: string | number | null = resume.startCursor;
  const seen = resume.seenNextCursors;

  if (resume.existingPages > 0) {
    log(
      `[archive] resume prefix=${args.prefix} next page=${resume.startPage} cursor=${String(resume.startCursor)}`
    );
  }

  for await (const page of args.client.paginate({
    path: args.path,
    params: args.params,
    paginationStyle: style,
    perPage: 100,
    startCursor: style === 'cursor' ? resume.startCursor : undefined,
    startPage: resume.startPage,
  })) {
    pageCount += 1;
    if (pageCount > MAX_PAGES_FAIL_CLOSED) {
      throw new Error(`Refusing to continue past ${MAX_PAGES_FAIL_CLOSED} pages (fail-closed loop guard)`);
    }
    const n = Array.isArray(page.body.data) ? page.body.data.length : 0;
    recordCount += n;
    const nextCursor = (page.body.meta?.next_cursor ?? null) as string | number | null;
    assertAdvancingCursor(seen, requestCursor, page.hasMore ? nextCursor : null);
    lastNextCursor = nextCursor;
    requestCursor = nextCursor;
    const key = `${args.prefix}/page=${page.pageIndex}.json`;
    const result = await args.s3.putJson(key, page.body, { overwrite: args.overwrite === true });
    if (result.written) written += 1;
    else skipped += 1;
    if (page.pageIndex === 1 || page.pageIndex % 10 === 0 || !page.hasMore) {
      log(
        `[archive] page=${page.pageIndex} records=${n} written=${result.written} next_cursor=${nextCursor == null ? 'null' : String(nextCursor)}`
      );
    }
    if (!page.hasMore) break;
  }

  const exhausted = lastNextCursor == null;
  const manifest = {
    schemaVersion: 1,
    source: 'balldontlie',
    entity: args.prefix.split('entity=')[1] ?? 'unknown',
    endpoint: args.path,
    pageCount,
    recordCount,
    status: exhausted && pageCount > 0 ? 'success' : 'skipped',
    fetchedAt: new Date().toISOString(),
    cursorExhausted: exhausted,
  };
  await args.s3.putJson(`${args.prefix}/_manifest.json`, manifest, { overwrite: true });
  return {
    pageCount,
    recordCount,
    written,
    skipped,
    resumedFromPage: resume.existingPages > 0 ? resume.existingPages : null,
    startCursor: resume.startCursor,
    lastNextCursor,
    exhausted,
    status: exhausted && pageCount > 0 ? 'success' : 'skipped',
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
