/**
 * Narrow writer for raw.acquisition_requests (db/schemas/MIGRATION_acquisition_requests.sql).
 * Parameterized SQL over any `{ query }` client (pg Pool/Client). No ORM, no reads, no deletes.
 *
 * Lifecycle: insertPending → updateArchiveOutcome → recordParseResult.
 * Legality of status transitions is enforced by the table guard trigger; this module
 * pre-checks the row-level CHECK constraints so a malformed row fails before any I/O.
 */

import type { AcqLedgerArchiveStatus, AcqLedgerRow } from './ledger';

export type AcqSqlQueryable = {
  query(sql: string, params?: unknown[]): Promise<{ rowCount: number | null }>;
};

export const ACQ_LEDGER_COLUMNS = [
  'request_id',
  'pull_run_id',
  'provider',
  'league',
  'endpoint_family',
  'endpoint_path',
  'scope_kind',
  'scope_id',
  'season',
  'season_type_requested',
  'page_index',
  'attempt',
  'parent_request_id',
  'controller_enqueued_at',
  'request_started_at',
  'response_received_at',
  'body_completed_at',
  'http_status',
  'transport_error',
  'body_sha256',
  'body_bytes',
  'envelope_sha256',
  's3_key',
  'archive_status',
  'archived_at',
  'archive_error',
  'parse_ok',
  'parse_error',
  'collector_name',
  'collector_version',
] as const satisfies readonly (keyof AcqLedgerRow)[];

export const ACQ_LEDGER_INSERT_SQL = `insert into raw.acquisition_requests (${ACQ_LEDGER_COLUMNS.join(', ')})
values (${ACQ_LEDGER_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')})`;

export const ACQ_LEDGER_ARCHIVE_OUTCOME_SQL = `update raw.acquisition_requests
set archive_status = $2, s3_key = $3, envelope_sha256 = $4, archived_at = $5, archive_error = $6
where request_id = $1`;

export const ACQ_LEDGER_PARSE_RESULT_SQL = `update raw.acquisition_requests
set parse_ok = $2, parse_error = $3
where request_id = $1 and archive_status = 'archived'`;

const HEX64 = /^[0-9a-f]{64}$/;
const ACQ_ZONE = /\/entity=acq_[a-z0-9_]+\//;
const SCOPE_KINDS = new Set(['game', 'date', 'global', 'query']);
const STATUSES = new Set<AcqLedgerArchiveStatus>(['pending', 'archived', 'archive_failed', 'immutability_conflict']);

/** Mirrors the table CHECK constraints. Empty array = row is insertable. */
export function validateLedgerRow(row: AcqLedgerRow): string[] {
  const errors: string[] = [];
  for (const k of [
    'request_id',
    'pull_run_id',
    'provider',
    'league',
    'endpoint_family',
    'endpoint_path',
    'scope_id',
    'request_started_at',
    'collector_name',
    'collector_version',
  ] as const) {
    if (typeof row[k] !== 'string' || row[k] === '') errors.push(`${k} required`);
  }
  if (!SCOPE_KINDS.has(row.scope_kind)) errors.push('scope_kind invalid');
  if (row.season != null && !(Number.isInteger(row.season) && row.season >= 1900 && row.season <= 2999)) {
    errors.push('season out of range');
  }
  if (!(Number.isInteger(row.page_index) && row.page_index >= 0 && row.page_index <= 9999)) {
    errors.push('page_index out of range');
  }
  if (!(Number.isInteger(row.attempt) && row.attempt >= 1)) errors.push('attempt must be >= 1');
  if (!STATUSES.has(row.archive_status)) errors.push('archive_status invalid');
  if (row.body_sha256 != null && !HEX64.test(row.body_sha256)) errors.push('body_sha256 not hex64');
  if (row.envelope_sha256 != null && !HEX64.test(row.envelope_sha256)) errors.push('envelope_sha256 not hex64');
  if (row.body_bytes != null && !(Number.isInteger(row.body_bytes) && row.body_bytes >= 0)) {
    errors.push('body_bytes invalid');
  }
  if ((row.http_status == null) === (row.transport_error == null)) {
    errors.push('response_xor_transport_error');
  }
  if (
    row.http_status != null &&
    (row.body_sha256 == null || row.body_bytes == null || row.response_received_at == null || row.body_completed_at == null)
  ) {
    errors.push('response_has_body');
  }
  if (row.archive_status === 'archived' && (row.s3_key == null || row.envelope_sha256 == null || row.archived_at == null)) {
    errors.push('archived_complete');
  }
  if (row.archive_status !== 'archived' && (row.envelope_sha256 != null || row.archived_at != null)) {
    errors.push('archive_evidence_only_when_archived');
  }
  if (row.s3_key != null && !ACQ_ZONE.test(row.s3_key)) errors.push('acq_zone_key');
  if (row.response_received_at != null && Date.parse(row.response_received_at) < Date.parse(row.request_started_at)) {
    errors.push('clock_order');
  }
  return errors;
}

export function ledgerInsertParams(row: AcqLedgerRow): unknown[] {
  return ACQ_LEDGER_COLUMNS.map((c) => row[c]);
}

export type AcqLedgerWriter = {
  /** Insert a row in any lifecycle state (normally 'pending' before archive). */
  insertRow(row: AcqLedgerRow): Promise<void>;
  /** pending|archive_failed → archived|archive_failed|immutability_conflict (row from ledgerRowFromEnvelope). */
  updateArchiveOutcome(row: AcqLedgerRow): Promise<void>;
  /** Only archived rows can carry a validation result. */
  recordParseResult(requestId: string, ok: boolean, error: string | null): Promise<void>;
};

export class AcqLedgerWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AcqLedgerWriteError';
  }
}

function expectOneRow(res: { rowCount: number | null }, what: string, requestId: string) {
  if (res.rowCount !== 1) {
    throw new AcqLedgerWriteError(`${what} affected ${res.rowCount ?? 0} rows (request ${requestId})`);
  }
}

function assertValid(row: AcqLedgerRow) {
  const errors = validateLedgerRow(row);
  if (errors.length > 0) {
    throw new AcqLedgerWriteError(`ledger row rejected (request ${row.request_id}): ${errors.join(', ')}`);
  }
}

export function createPgAcqLedgerWriter(db: AcqSqlQueryable): AcqLedgerWriter {
  return {
    async insertRow(row) {
      assertValid(row);
      expectOneRow(await db.query(ACQ_LEDGER_INSERT_SQL, ledgerInsertParams(row)), 'ledger insert', row.request_id);
    },
    async updateArchiveOutcome(row) {
      assertValid(row);
      if (row.archive_status === 'pending') {
        throw new AcqLedgerWriteError(`archive outcome cannot be pending (request ${row.request_id})`);
      }
      expectOneRow(
        await db.query(ACQ_LEDGER_ARCHIVE_OUTCOME_SQL, [
          row.request_id,
          row.archive_status,
          row.s3_key,
          row.envelope_sha256,
          row.archived_at,
          row.archive_error,
        ]),
        'ledger archive outcome',
        row.request_id
      );
    },
    async recordParseResult(requestId, ok, error) {
      expectOneRow(
        await db.query(ACQ_LEDGER_PARSE_RESULT_SQL, [requestId, ok, ok ? null : error ?? 'parse failed']),
        'ledger parse result',
        requestId
      );
    },
  };
}

/** Test double that enforces the same lifecycle rules as the table guard trigger. */
export function createMemoryAcqLedgerWriter(): AcqLedgerWriter & { rows: Map<string, AcqLedgerRow> } {
  const rows = new Map<string, AcqLedgerRow>();
  return {
    rows,
    async insertRow(row) {
      assertValid(row);
      if (rows.has(row.request_id)) throw new AcqLedgerWriteError(`duplicate request_id ${row.request_id}`);
      rows.set(row.request_id, { ...row });
    },
    async updateArchiveOutcome(row) {
      assertValid(row);
      const old = rows.get(row.request_id);
      if (!old) throw new AcqLedgerWriteError(`ledger archive outcome affected 0 rows (request ${row.request_id})`);
      const legal =
        (old.archive_status === 'pending' && row.archive_status !== 'pending') ||
        (old.archive_status === 'archive_failed' &&
          (row.archive_status === 'archived' || row.archive_status === 'immutability_conflict')) ||
        (old.archive_status === row.archive_status && old.archive_status !== 'archived');
      if (!legal) {
        throw new AcqLedgerWriteError(`transition ${old.archive_status} -> ${row.archive_status} not allowed`);
      }
      if (old.s3_key != null && row.s3_key !== old.s3_key) throw new AcqLedgerWriteError('s3_key is write-once');
      rows.set(row.request_id, {
        ...old,
        archive_status: row.archive_status,
        s3_key: row.s3_key,
        envelope_sha256: row.envelope_sha256,
        archived_at: row.archived_at,
        archive_error: row.archive_error,
      });
    },
    async recordParseResult(requestId, ok, error) {
      const old = rows.get(requestId);
      if (!old || old.archive_status !== 'archived') {
        throw new AcqLedgerWriteError(`ledger parse result affected 0 rows (request ${requestId})`);
      }
      rows.set(requestId, { ...old, parse_ok: ok, parse_error: ok ? null : error ?? 'parse failed' });
    },
  };
}
