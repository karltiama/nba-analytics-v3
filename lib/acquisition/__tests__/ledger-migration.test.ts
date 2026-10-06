import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AcqLedgerRow } from '@/lib/acquisition';

const SQL = readFileSync(path.resolve(__dirname, '../../../db/schemas/MIGRATION_acquisition_requests.sql'), 'utf8');

const ROW_KEYS: Record<keyof AcqLedgerRow, true> = {
  request_id: true,
  pull_run_id: true,
  provider: true,
  league: true,
  endpoint_family: true,
  endpoint_path: true,
  scope_kind: true,
  scope_id: true,
  season: true,
  season_type_requested: true,
  page_index: true,
  attempt: true,
  parent_request_id: true,
  controller_enqueued_at: true,
  request_started_at: true,
  response_received_at: true,
  body_completed_at: true,
  http_status: true,
  transport_error: true,
  body_sha256: true,
  body_bytes: true,
  envelope_sha256: true,
  s3_key: true,
  archive_status: true,
  archived_at: true,
  archive_error: true,
  parse_ok: true,
  parse_error: true,
  collector_name: true,
  collector_version: true,
};

function tableColumns(sql: string): string[] {
  const body = sql.match(/create table if not exists raw\.acquisition_requests \(([\s\S]*?)\n\);/)![1];
  return body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[a-z0-9_]+\s+(text|integer|bigint|boolean|timestamptz)\b/.test(l))
    .map((l) => l.split(/\s+/)[0]);
}

describe('raw.acquisition_requests migration (prepared only)', () => {
  it('is marked PREPARED ONLY', () => {
    expect(SQL.split('\n')[0]).toMatch(/^-- PREPARED ONLY/);
  });

  it('columns match AcqLedgerRow (+ created_at)', () => {
    expect(tableColumns(SQL).sort()).toEqual([...Object.keys(ROW_KEYS), 'created_at'].sort());
  });

  it('contains the DATA1-required fields', () => {
    const cols = new Set(tableColumns(SQL));
    for (const c of [
      'request_id', 'pull_run_id', 'provider', 'endpoint_family', 'scope_kind', 'scope_id', 'season',
      'season_type_requested', 'page_index', 'attempt', 'controller_enqueued_at', 'request_started_at',
      'response_received_at', 'body_completed_at', 'http_status', 'body_sha256', 'body_bytes', 's3_key',
      'archive_status', 'archived_at', 'parse_ok', 'parse_error', 'collector_version',
    ]) {
      expect(cols.has(c), c).toBe(true);
    }
  });

  it('is append-only and never touches existing tables', () => {
    expect(SQL).toMatch(/before update or delete on raw\.acquisition_requests/);
    expect(SQL).not.toMatch(/\balter table\b/i);
    expect(SQL).not.toMatch(/\bdrop table\b/i);
    expect(SQL).not.toMatch(/\bdelete from\b/i);
  });
});
