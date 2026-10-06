import { describe, expect, it } from 'vitest';
import {
  ACQ_LEDGER_ARCHIVE_OUTCOME_SQL,
  ACQ_LEDGER_COLUMNS,
  ACQ_LEDGER_INSERT_SQL,
  ACQ_LEDGER_PARSE_RESULT_SQL,
  createMemoryAcqLedgerWriter,
  createPgAcqLedgerWriter,
  ledgerInsertParams,
  validateLedgerRow,
} from '@/lib/acquisition/ledger-pg';
import type { AcqLedgerRow } from '@/lib/acquisition/ledger';

const H = 'a'.repeat(64);
const KEY =
  'raw/source=balldontlie/league=nba/season=2026/entity=acq_games/obs_date=2026-10-22/scope=query/scope_id=abcd1234/obs=x__run=r__req=q__p=0000.json.gz';

function row(partial: Partial<AcqLedgerRow> = {}): AcqLedgerRow {
  return {
    request_id: 'req-1',
    pull_run_id: 'run-1',
    provider: 'balldontlie',
    league: 'nba',
    endpoint_family: 'games',
    endpoint_path: '/v1/games',
    scope_kind: 'query',
    scope_id: 'abcd1234',
    season: 2026,
    season_type_requested: null,
    page_index: 0,
    attempt: 1,
    parent_request_id: null,
    controller_enqueued_at: null,
    request_started_at: '2026-10-22T03:15:00.000Z',
    response_received_at: '2026-10-22T03:15:01.000Z',
    body_completed_at: '2026-10-22T03:15:01.000Z',
    http_status: 200,
    transport_error: null,
    body_sha256: H,
    body_bytes: 10,
    envelope_sha256: null,
    s3_key: null,
    archive_status: 'pending',
    archived_at: null,
    archive_error: null,
    parse_ok: null,
    parse_error: null,
    collector_name: 'game-status-sync',
    collector_version: 'data2e1.v1',
    ...partial,
  };
}

const archived = (p: Partial<AcqLedgerRow> = {}) =>
  row({ archive_status: 'archived', s3_key: KEY, envelope_sha256: H, archived_at: '2026-10-22T03:15:02.000Z', ...p });

function fakeDb(rowCount = 1) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  return {
    calls,
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      return { rowCount };
    },
  };
}

describe('raw.acquisition_requests SQL (narrow writer)', () => {
  it('insert covers every non-default column with positional params only', () => {
    expect(ACQ_LEDGER_COLUMNS).toHaveLength(30);
    expect(ACQ_LEDGER_COLUMNS).not.toContain('created_at');
    expect(ACQ_LEDGER_INSERT_SQL).toMatch(/^insert into raw\.acquisition_requests \(/);
    expect(ACQ_LEDGER_INSERT_SQL).toContain('$30)');
    expect(ACQ_LEDGER_INSERT_SQL).not.toContain('$31');
    expect(ACQ_LEDGER_INSERT_SQL).not.toMatch(/on conflict/i);
    expect(ledgerInsertParams(row())).toHaveLength(30);
  });

  it('never deletes/truncates and updates only archive or parse columns', () => {
    for (const sql of [ACQ_LEDGER_INSERT_SQL, ACQ_LEDGER_ARCHIVE_OUTCOME_SQL, ACQ_LEDGER_PARSE_RESULT_SQL]) {
      expect(sql).not.toMatch(/\bdelete\b|\btruncate\b|\bdrop\b/i);
    }
    expect(ACQ_LEDGER_ARCHIVE_OUTCOME_SQL).toMatch(
      /set archive_status = \$2, s3_key = \$3, envelope_sha256 = \$4, archived_at = \$5, archive_error = \$6\s+where request_id = \$1$/
    );
    expect(ACQ_LEDGER_PARSE_RESULT_SQL).toMatch(/set parse_ok = \$2, parse_error = \$3/);
    expect(ACQ_LEDGER_PARSE_RESULT_SQL).toMatch(/archive_status = 'archived'/);
  });
});

describe('validateLedgerRow mirrors the certified CHECK constraints', () => {
  it('accepts pending / archived / archive_failed / immutability_conflict / transport rows', () => {
    expect(validateLedgerRow(row())).toEqual([]);
    expect(validateLedgerRow(archived())).toEqual([]);
    expect(validateLedgerRow(row({ archive_status: 'archive_failed', s3_key: KEY, archive_error: 'x' }))).toEqual([]);
    expect(validateLedgerRow(row({ archive_status: 'immutability_conflict', s3_key: KEY }))).toEqual([]);
    expect(
      validateLedgerRow(
        row({
          http_status: null,
          transport_error: 'TypeError: fetch failed',
          body_sha256: null,
          body_bytes: null,
          response_received_at: null,
          body_completed_at: null,
        })
      )
    ).toEqual([]);
  });

  it('rejects each constraint violation', () => {
    expect(validateLedgerRow(row({ transport_error: 'x' }))).toContain('response_xor_transport_error');
    expect(validateLedgerRow(row({ body_sha256: null }))).toContain('response_has_body');
    expect(validateLedgerRow(row({ archive_status: 'archived', s3_key: KEY }))).toContain('archived_complete');
    expect(validateLedgerRow(row({ envelope_sha256: H }))).toContain('archive_evidence_only_when_archived');
    expect(validateLedgerRow(archived({ s3_key: 'raw/entity=games/x.json.gz' }))).toContain('acq_zone_key');
    expect(validateLedgerRow(row({ response_received_at: '2026-10-22T03:14:00.000Z' }))).toContain('clock_order');
    expect(validateLedgerRow(row({ page_index: 10000 }))).toContain('page_index out of range');
    expect(validateLedgerRow(row({ attempt: 0 }))).toContain('attempt must be >= 1');
    expect(validateLedgerRow(row({ body_sha256: 'ABC' }))).toContain('body_sha256 not hex64');
    expect(validateLedgerRow(row({ scope_kind: 'team' }))).toContain('scope_kind invalid');
  });
});

describe('createPgAcqLedgerWriter', () => {
  it('insertRow sends the mapped params; invalid rows never reach SQL', async () => {
    const db = fakeDb();
    const w = createPgAcqLedgerWriter(db);
    await w.insertRow(row());
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0].sql).toBe(ACQ_LEDGER_INSERT_SQL);
    expect(db.calls[0].params[0]).toBe('req-1');
    expect(db.calls[0].params[ACQ_LEDGER_COLUMNS.indexOf('archive_status')]).toBe('pending');
    await expect(w.insertRow(row({ transport_error: 'x' }))).rejects.toThrow(/response_xor_transport_error/);
    expect(db.calls).toHaveLength(1);
  });

  it('updateArchiveOutcome writes archive columns only and refuses pending', async () => {
    const db = fakeDb();
    const w = createPgAcqLedgerWriter(db);
    await w.updateArchiveOutcome(archived());
    expect(db.calls[0].params).toEqual(['req-1', 'archived', KEY, H, '2026-10-22T03:15:02.000Z', null]);
    await expect(w.updateArchiveOutcome(row())).rejects.toThrow(/cannot be pending/);
  });

  it('recordParseResult targets archived rows and requires exactly one row', async () => {
    const db = fakeDb();
    const w = createPgAcqLedgerWriter(db);
    await w.recordParseResult('req-1', true, 'ignored');
    expect(db.calls[0].params).toEqual(['req-1', true, null]);
    await w.recordParseResult('req-1', false, 'invalid JSON');
    expect(db.calls[1].params).toEqual(['req-1', false, 'invalid JSON']);
    await expect(createPgAcqLedgerWriter(fakeDb(0)).recordParseResult('req-1', true, null)).rejects.toThrow(/affected 0 rows/);
  });
});

describe('createMemoryAcqLedgerWriter lifecycle (mirrors guard trigger)', () => {
  it('pending → archived → parse_ok; archived is terminal', async () => {
    const w = createMemoryAcqLedgerWriter();
    await w.insertRow(row());
    await w.updateArchiveOutcome(archived());
    await w.recordParseResult('req-1', true, null);
    expect(w.rows.get('req-1')).toMatchObject({ archive_status: 'archived', parse_ok: true });
    await expect(w.updateArchiveOutcome(row({ archive_status: 'archive_failed' }))).rejects.toThrow(/not allowed/);
  });

  it('archive_failed → archived allowed; parse result refused on non-archived rows', async () => {
    const w = createMemoryAcqLedgerWriter();
    await w.insertRow(row({ archive_status: 'archive_failed', s3_key: KEY, archive_error: 'put_failed' }));
    await expect(w.recordParseResult('req-1', true, null)).rejects.toThrow();
    await w.updateArchiveOutcome(archived());
    expect(w.rows.get('req-1')?.archive_status).toBe('archived');
  });
});
