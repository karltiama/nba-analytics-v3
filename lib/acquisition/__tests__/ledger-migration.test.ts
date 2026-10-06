import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AcqLedgerRow } from '@/lib/acquisition';

const SQL = readFileSync(path.resolve(__dirname, '../../../db/schemas/MIGRATION_acquisition_requests.sql'), 'utf8').replace(
  /\r\n/g,
  '\n',
);

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

function functionBody(name: string): string {
  const m = SQL.match(new RegExp(`create or replace function raw\\.${name}\\(\\)([\\s\\S]*?)\\$\\$([\\s\\S]*?)\\$\\$;`));
  if (!m) throw new Error(`function raw.${name} not found`);
  return m[2];
}

function functionHeader(name: string): string {
  const m = SQL.match(new RegExp(`create or replace function raw\\.${name}\\(\\)([\\s\\S]*?)\\$\\$`));
  if (!m) throw new Error(`function raw.${name} not found`);
  return m[1];
}

const GUARD = functionBody('acquisition_requests_guard');
const TRUNCATE_GUARD = functionBody('acquisition_requests_block_truncate');

describe('raw.acquisition_requests ledger hardening (DATA2A-LEDGER-FIX)', () => {
  it('DELETE guard: row-level trigger raises on delete', () => {
    expect(SQL).toMatch(
      /create trigger acquisition_requests_guard_trg\s+before update or delete on raw\.acquisition_requests\s+for each row execute function raw\.acquisition_requests_guard\(\);/,
    );
    expect(GUARD).toMatch(/if tg_op = 'DELETE' then\s+raise exception 'raw\.acquisition_requests is append-only/);
  });

  it('TRUNCATE guard: statement-level BEFORE TRUNCATE trigger raises', () => {
    expect(SQL).toMatch(
      /create trigger acquisition_requests_block_truncate_trg\s+before truncate on raw\.acquisition_requests\s+for each statement execute function raw\.acquisition_requests_block_truncate\(\);/,
    );
    expect(TRUNCATE_GUARD).toMatch(/^\s*begin\s+raise exception '[^']*\(truncate rejected\)'\s*;\s+end;\s*$/);
  });

  it('envelope_sha256 is write-once once non-null', () => {
    expect(GUARD).toMatch(
      /if old\.envelope_sha256 is not null and new\.envelope_sha256 is distinct from old\.envelope_sha256 then\s+raise exception/,
    );
  });

  it('archived_at is write-once once non-null', () => {
    expect(GUARD).toMatch(
      /if old\.archived_at is not null and new\.archived_at is distinct from old\.archived_at then\s+raise exception/,
    );
  });

  it('s3_key stays write-once once non-null', () => {
    expect(GUARD).toMatch(/if old\.s3_key is not null and new\.s3_key is distinct from old\.s3_key then\s+raise exception/);
  });

  it('archive evidence is frozen once status is terminal', () => {
    expect(GUARD).toMatch(
      /if old\.archive_status in \('archived', 'immutability_conflict'\)\s+and \(new\.s3_key, new\.envelope_sha256, new\.archived_at\)\s+is distinct from \(old\.s3_key, old\.envelope_sha256, old\.archived_at\) then\s+raise exception/,
    );
  });

  it('archived rows carry full evidence; non-archived rows carry no archive identity', () => {
    expect(SQL).toMatch(
      /check \(archive_status <> 'archived'\s+or \(s3_key is not null and envelope_sha256 is not null and archived_at is not null\)\)/,
    );
    expect(SQL).toMatch(
      /constraint acquisition_requests_archive_evidence_only_when_archived\s+check \(archive_status = 'archived' or \(envelope_sha256 is null and archived_at is null\)\)/,
    );
  });

  it('archived and immutability_conflict are terminal (and only those)', () => {
    const terminal = GUARD.match(
      /if old\.archive_status in \(([^)]*)\) then\s+raise exception 'archive_status % is terminal/,
    );
    expect(terminal).not.toBeNull();
    expect(terminal![1].split(',').map((s) => s.trim()).sort()).toEqual(["'archived'", "'immutability_conflict'"]);
  });

  it('no transition back to pending', () => {
    expect(GUARD).toMatch(/if new\.archive_status = 'pending' then\s+raise exception 'archive_status cannot return to pending/);
  });

  it('allow-list: pending -> archived|archive_failed|immutability_conflict; archive_failed -> archived|immutability_conflict', () => {
    const allow = GUARD.match(
      /if not \(\(old\.archive_status = 'pending'\s+and new\.archive_status in \(([^)]*)\)\)\s+or \(old\.archive_status = 'archive_failed'\s+and new\.archive_status in \(([^)]*)\)\)\) then\s+raise exception/,
    );
    expect(allow).not.toBeNull();
    const list = (s: string) => s.split(',').map((x) => x.trim().replace(/'/g, '')).sort();
    expect(list(allow![1])).toEqual(['archive_failed', 'archived', 'immutability_conflict']);
    expect(list(allow![2])).toEqual(['archived', 'immutability_conflict']);
  });

  it('transition checks only fire on a status change (same-status diagnostic updates allowed)', () => {
    expect(GUARD).toMatch(/if new\.archive_status is distinct from old\.archive_status then\s+if old\.archive_status in/);
  });

  it('guard functions pin search_path and reference no unqualified objects', () => {
    const fnCount = (SQL.match(/create or replace function/g) ?? []).length;
    expect(fnCount).toBe(2);
    for (const name of ['acquisition_requests_guard', 'acquisition_requests_block_truncate']) {
      expect(functionHeader(name)).toMatch(/\bset search_path = ''\s+as\s*$/);
      const body = functionBody(name).replace(/is distinct from/g, '').replace(/'[^']*'/g, "''");
      expect(body).not.toMatch(/\b(select|insert|update|delete|perform|from|join|execute|nextval)\b/i);
    }
  });

  it('explicitly revokes table access from public, anon, authenticated; no schema-level grant changes', () => {
    expect(SQL).toMatch(/^revoke all on table raw\.acquisition_requests from public, anon, authenticated;$/m);
    expect(SQL).not.toMatch(/\bgrant\b/i);
    expect(SQL).not.toMatch(/\bon schema\b/i);
  });

  it('stays re-runnable', () => {
    const creates = SQL.match(/^create (table|unique index|index) .*$/gm) ?? [];
    expect(creates.length).toBeGreaterThan(0);
    for (const c of creates) expect(c, c).toMatch(/ if not exists /);
    expect(SQL).not.toMatch(/^create function/m);
    const triggers = [...SQL.matchAll(/^create trigger (\w+)/gm)].map((m) => m[1]);
    expect(triggers.sort()).toEqual(['acquisition_requests_block_truncate_trg', 'acquisition_requests_guard_trg']);
    for (const t of triggers) {
      expect(SQL).toMatch(new RegExp(`drop trigger if exists ${t} on raw\\.acquisition_requests;\\ncreate trigger ${t}\\b`));
    }
  });
});
