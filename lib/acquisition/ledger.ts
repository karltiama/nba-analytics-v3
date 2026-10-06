/**
 * Row shape for raw.acquisition_requests (db/schemas/MIGRATION_acquisition_requests.sql).
 * Pure mapping only; this module performs no database I/O.
 */

import type { AcqArchiveOutcome } from './archive';
import type { AcqEnvelopeV1 } from './envelope';

export type AcqLedgerArchiveStatus = 'pending' | 'archived' | 'archive_failed' | 'immutability_conflict';

export type AcqLedgerRow = {
  request_id: string;
  pull_run_id: string;
  provider: string;
  league: string;
  endpoint_family: string;
  endpoint_path: string;
  scope_kind: string;
  scope_id: string;
  season: number | null;
  season_type_requested: string | null;
  page_index: number;
  attempt: number;
  parent_request_id: string | null;
  controller_enqueued_at: string | null;
  request_started_at: string;
  response_received_at: string | null;
  body_completed_at: string | null;
  http_status: number | null;
  transport_error: string | null;
  body_sha256: string | null;
  body_bytes: number | null;
  envelope_sha256: string | null;
  s3_key: string | null;
  archive_status: AcqLedgerArchiveStatus;
  archived_at: string | null;
  archive_error: string | null;
  /** Set later by the validation step; null until validated. */
  parse_ok: boolean | null;
  parse_error: string | null;
  collector_name: string;
  collector_version: string;
};

const STATUS: Record<AcqArchiveOutcome['status'], AcqLedgerArchiveStatus> = {
  ARCHIVED: 'archived',
  ARCHIVE_FAILED: 'archive_failed',
  IMMUTABILITY_CONFLICT: 'immutability_conflict',
};

export function ledgerRowFromEnvelope(env: AcqEnvelopeV1, outcome: AcqArchiveOutcome | null): AcqLedgerRow {
  const archived = outcome?.status === 'ARCHIVED' ? outcome : null;
  return {
    request_id: env.identity.request_id,
    pull_run_id: env.identity.pull_run_id,
    provider: env.provider,
    league: env.league,
    endpoint_family: env.endpoint_family,
    endpoint_path: env.request.path,
    scope_kind: env.scope.kind,
    scope_id: env.scope.scope_id,
    season: env.scope.season,
    season_type_requested: env.scope.season_type_requested,
    page_index: env.request.page_index,
    attempt: env.identity.attempt,
    parent_request_id: env.identity.parent_request_id,
    controller_enqueued_at: env.times.controller_enqueued_at,
    request_started_at: env.times.request_started_at,
    response_received_at: env.times.response_received_at,
    body_completed_at: env.times.body_completed_at,
    http_status: env.response?.http_status ?? null,
    transport_error: env.transport_error ? `${env.transport_error.name}: ${env.transport_error.message}` : null,
    body_sha256: env.response?.body_sha256 ?? null,
    body_bytes: env.response?.body_bytes ?? null,
    envelope_sha256: archived?.envelope_sha256 ?? null,
    s3_key: outcome && outcome.key ? outcome.key : null,
    archive_status: outcome ? STATUS[outcome.status] : 'pending',
    archived_at: archived?.archived_at ?? null,
    archive_error:
      outcome?.status === 'ARCHIVE_FAILED'
        ? `${outcome.reason}: ${outcome.error}`
        : outcome?.status === 'IMMUTABILITY_CONFLICT'
          ? `existing body_sha256=${outcome.existing_body_sha256 ?? 'null'}`
          : null,
    parse_ok: null,
    parse_error: null,
    collector_name: env.collector.name,
    collector_version: env.collector.version,
  };
}
