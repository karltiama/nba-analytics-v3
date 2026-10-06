-- PREPARED ONLY. Do not apply until an explicit apply step authorizes it.
-- Acquisition ledger for acq_envelope.v1 (reports/data/immutable-raw-acquisition-contract.md §3.2).
-- One row per HTTP attempt. Never pruned. Row shape: lib/acquisition/ledger.ts (AcqLedgerRow).
-- Append-only: DELETE and TRUNCATE are rejected.
-- Identity, request, clock, and body-checksum columns are write-once.
-- Archive evidence (s3_key, envelope_sha256, archived_at) is write-once once non-null and frozen
-- once archive_status is terminal ('archived', 'immutability_conflict').
-- Allowed archive_status transitions:
--   pending -> archived | archive_failed | immutability_conflict
--   archive_failed -> archived | immutability_conflict
-- Same-status updates (e.g. parse_ok, archive_error diagnostics) are allowed under the evidence rules.

create table if not exists raw.acquisition_requests (
  request_id              text primary key,
  pull_run_id             text not null,
  provider                text not null,
  league                  text not null,
  endpoint_family         text not null,
  endpoint_path           text not null,
  scope_kind              text not null check (scope_kind in ('game', 'date', 'global', 'query')),
  scope_id                text not null,
  season                  integer check (season is null or season between 1900 and 2999),
  season_type_requested   text,
  page_index              integer not null check (page_index between 0 and 9999),
  attempt                 integer not null check (attempt >= 1),
  parent_request_id       text,

  controller_enqueued_at  timestamptz,
  request_started_at      timestamptz not null,
  response_received_at    timestamptz,
  body_completed_at       timestamptz,

  http_status             integer,
  transport_error         text,
  body_sha256             text check (body_sha256 is null or body_sha256 ~ '^[0-9a-f]{64}$'),
  body_bytes              bigint check (body_bytes is null or body_bytes >= 0),
  envelope_sha256         text check (envelope_sha256 is null or envelope_sha256 ~ '^[0-9a-f]{64}$'),

  s3_key                  text,
  archive_status          text not null default 'pending'
                          check (archive_status in ('pending', 'archived', 'archive_failed', 'immutability_conflict')),
  archived_at             timestamptz,
  archive_error           text,

  parse_ok                boolean,
  parse_error             text,

  collector_name          text not null,
  collector_version       text not null,
  created_at              timestamptz not null default now(),

  constraint acquisition_requests_response_xor_transport_error
    check ((http_status is null) <> (transport_error is null)),
  constraint acquisition_requests_response_has_body
    check (http_status is null or (body_sha256 is not null and body_bytes is not null
                                   and response_received_at is not null and body_completed_at is not null)),
  constraint acquisition_requests_archived_complete
    check (archive_status <> 'archived'
           or (s3_key is not null and envelope_sha256 is not null and archived_at is not null)),
  constraint acquisition_requests_archive_evidence_only_when_archived
    check (archive_status = 'archived' or (envelope_sha256 is null and archived_at is null)),
  constraint acquisition_requests_acq_zone_key
    check (s3_key is null or s3_key ~ '/entity=acq_[a-z0-9_]+/'),
  constraint acquisition_requests_clock_order
    check (response_received_at is null or response_received_at >= request_started_at)
);

create unique index if not exists acquisition_requests_s3_key_uidx
  on raw.acquisition_requests (s3_key) where s3_key is not null;
create index if not exists acquisition_requests_pull_run_idx
  on raw.acquisition_requests (pull_run_id, page_index);
create index if not exists acquisition_requests_family_observed_idx
  on raw.acquisition_requests (provider, endpoint_family, response_received_at);
create index if not exists acquisition_requests_scope_idx
  on raw.acquisition_requests (provider, endpoint_family, scope_kind, scope_id);
create index if not exists acquisition_requests_not_archived_idx
  on raw.acquisition_requests (archive_status) where archive_status <> 'archived';

create or replace function raw.acquisition_requests_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'raw.acquisition_requests is append-only (delete of %)', old.request_id;
  end if;

  if (new.request_id, new.pull_run_id, new.provider, new.league, new.endpoint_family, new.endpoint_path,
      new.scope_kind, new.scope_id, new.season, new.season_type_requested, new.page_index, new.attempt,
      new.parent_request_id, new.controller_enqueued_at, new.request_started_at, new.response_received_at,
      new.body_completed_at, new.http_status, new.transport_error, new.body_sha256, new.body_bytes,
      new.collector_name, new.collector_version, new.created_at)
     is distinct from
     (old.request_id, old.pull_run_id, old.provider, old.league, old.endpoint_family, old.endpoint_path,
      old.scope_kind, old.scope_id, old.season, old.season_type_requested, old.page_index, old.attempt,
      old.parent_request_id, old.controller_enqueued_at, old.request_started_at, old.response_received_at,
      old.body_completed_at, old.http_status, old.transport_error, old.body_sha256, old.body_bytes,
      old.collector_name, old.collector_version, old.created_at) then
    raise exception 'raw.acquisition_requests evidence columns are write-once (request %)', old.request_id;
  end if;

  -- archived and immutability_conflict are terminal; archive_failed may later become archived
  -- (same envelope re-archived idempotently) or immutability_conflict (retry found a different object).
  if new.archive_status is distinct from old.archive_status then
    if old.archive_status in ('archived', 'immutability_conflict') then
      raise exception 'archive_status % is terminal for request %', old.archive_status, old.request_id;
    end if;
    if new.archive_status = 'pending' then
      raise exception 'archive_status cannot return to pending (request %)', old.request_id;
    end if;
    if not ((old.archive_status = 'pending'
             and new.archive_status in ('archived', 'archive_failed', 'immutability_conflict'))
         or (old.archive_status = 'archive_failed'
             and new.archive_status in ('archived', 'immutability_conflict'))) then
      raise exception 'archive_status transition % -> % is not allowed (request %)',
        old.archive_status, new.archive_status, old.request_id;
    end if;
  end if;

  if old.s3_key is not null and new.s3_key is distinct from old.s3_key then
    raise exception 's3_key is write-once (request %)', old.request_id;
  end if;
  if old.envelope_sha256 is not null and new.envelope_sha256 is distinct from old.envelope_sha256 then
    raise exception 'envelope_sha256 is write-once (request %)', old.request_id;
  end if;
  if old.archived_at is not null and new.archived_at is distinct from old.archived_at then
    raise exception 'archived_at is write-once (request %)', old.request_id;
  end if;

  if old.archive_status in ('archived', 'immutability_conflict')
     and (new.s3_key, new.envelope_sha256, new.archived_at)
         is distinct from (old.s3_key, old.envelope_sha256, old.archived_at) then
    raise exception 'archive evidence is immutable once archive_status is % (request %)',
      old.archive_status, old.request_id;
  end if;

  return new;
end;
$$;

create or replace function raw.acquisition_requests_block_truncate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'raw.acquisition_requests is append-only (truncate rejected)';
end;
$$;

drop trigger if exists acquisition_requests_guard_trg on raw.acquisition_requests;
create trigger acquisition_requests_guard_trg
  before update or delete on raw.acquisition_requests
  for each row execute function raw.acquisition_requests_guard();

drop trigger if exists acquisition_requests_block_truncate_trg on raw.acquisition_requests;
create trigger acquisition_requests_block_truncate_trg
  before truncate on raw.acquisition_requests
  for each statement execute function raw.acquisition_requests_block_truncate();

-- Defense in depth: the Data API roles never read or write the ledger. Schema-level access to
-- raw is intentionally not changed here (it would affect unrelated raw tables).
revoke all on table raw.acquisition_requests from public, anon, authenticated;

comment on table raw.acquisition_requests is
  'One row per provider HTTP attempt archived as acq_envelope.v1. Append-only, never pruned. Prune gates and research provenance join here.';
comment on column raw.acquisition_requests.controller_enqueued_at is
  'QUEUE/CONTROLLER_TIME. Null when unknown; never back-filled from another clock.';
comment on column raw.acquisition_requests.response_received_at is
  'OBSERVATION_TIME (headers received). Canonical as-of time for research.';
comment on column raw.acquisition_requests.body_sha256 is
  'SHA-256 of APPLICATION_RESPONSE_BODY_BYTES (decoded by the runtime if transport-encoded; not wire bytes).';
comment on column raw.acquisition_requests.archive_status is
  'pending -> archived | archive_failed | immutability_conflict; archive_failed -> archived | immutability_conflict. archived and immutability_conflict are terminal. Collectors must not normalize/serve unless archived.';
comment on column raw.acquisition_requests.parse_ok is
  'Set by the validation step after archive. Null = not yet validated.';
