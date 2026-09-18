/**
 * Phase 3A helper — copy selected PDFs from the certified S3 archive to a local tmp workspace.
 * Read-only vs S3. Does not fetch NBA.com. Not a parser.
 *
 *   npx tsx scripts/ops/materialize-official-injury-report-gold-candidates.ts
 */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { S3Storage } from '@/lib/aws/s3';

const MANIFEST = path.join(
  process.cwd(),
  'reports',
  'operations',
  'official-injury-report-raw-archive.records.ndjson'
);
const CANDIDATE_LIST = path.join(
  process.cwd(),
  'tmp',
  'official-injury-report-gold-fixtures',
  '_tools',
  'candidate_list.json'
);
const OUT_DIR = path.join(process.cwd(), 'tmp', 'official-injury-report-gold-fixtures');

type ArchiveRow = {
  report_date: string;
  requested_token: string;
  filename_family: string;
  season: string;
  s3_pdf_key: string;
  sha256: string | null;
  byte_length: number | null;
  result: string;
};

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function loadArchive(): Map<string, ArchiveRow> {
  const map = new Map<string, ArchiveRow>();
  for (const line of readFileSync(MANIFEST, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as ArchiveRow;
    if (row.result !== 'ARCHIVED' && row.result !== 'ALREADY_ARCHIVED_CHECKSUM_MATCH') continue;
    if (!row.sha256) continue;
    const key = `${row.report_date}|${row.requested_token}`;
    if (!map.has(key)) map.set(key, row);
  }
  return map;
}

async function main() {
  const bucket = process.env.NBA_DATA_BUCKET?.trim();
  if (!bucket) throw new Error('NBA_DATA_BUCKET is required');
  const store = new S3Storage({ bucket });
  const archive = loadArchive();
  const list = JSON.parse(readFileSync(CANDIDATE_LIST, 'utf8')) as {
    candidates: Array<{ report_date: string; requested_token: string; why: string }>;
  };
  mkdirSync(path.join(OUT_DIR, 'pdfs'), { recursive: true });
  const results: unknown[] = [];
  for (const c of list.candidates) {
    const row = archive.get(`${c.report_date}|${c.requested_token}`);
    if (!row) {
      results.push({ ...c, ok: false, error: 'not_in_archive_manifest' });
      console.error(`MISSING ${c.report_date} ${c.requested_token}`);
      continue;
    }
    const body = await store.getBytes(row.s3_pdf_key);
    if (!body) {
      results.push({ ...c, ok: false, error: 's3_missing', s3_key: row.s3_pdf_key });
      console.error(`S3 MISS ${row.s3_pdf_key}`);
      continue;
    }
    const buf = Buffer.from(body);
    const digest = sha256(buf);
    const match = digest === row.sha256;
    const filename = `Injury-Report_${c.report_date}_${c.requested_token}.pdf`;
    if (match) writeFileSync(path.join(OUT_DIR, 'pdfs', filename), buf);
    results.push({
      ...c,
      ok: match,
      error: match ? null : `checksum_mismatch archive=${row.sha256} local=${digest}`,
      s3_key: row.s3_pdf_key,
      sha256: digest,
      archive_sha256: row.sha256,
      byte_length: buf.length,
      filename_family: row.filename_family,
      season: row.season,
      local_path: match ? `tmp/official-injury-report-gold-fixtures/pdfs/${filename}` : null,
    });
    console.error(`${match ? 'OK' : 'MISMATCH'} ${filename} ${digest.slice(0, 12)}`);
  }
  writeFileSync(path.join(OUT_DIR, 'materialize-log.json'), JSON.stringify({ fetched_at: new Date().toISOString(), results }, null, 2) + '\n');
  const ok = results.filter((r) => (r as { ok?: boolean }).ok).length;
  const fail = results.length - ok;
  console.log(JSON.stringify({ ok, fail }, null, 2));
  if (fail) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
