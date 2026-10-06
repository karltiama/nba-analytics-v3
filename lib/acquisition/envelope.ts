/**
 * acq_envelope.v1: provider-neutral, immutable record of ONE HTTP attempt (DATA1 §1).
 *
 * The archived `response.body` is the evidence. `derived_hints` are conveniences
 * computed from it and are never authoritative; replays must re-derive from the body.
 * Provider-updated timestamps are NOT envelope fields; they live inside the body.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { CaptureResult, CapturedRequest, CapturedResponse, CapturedTransportError } from './capture';

export const ACQ_ENVELOPE_VERSION = 'acq_envelope.v1' as const;

export type AcqScopeKind = 'game' | 'date' | 'global' | 'query';
export const ACQ_SCOPE_KINDS: readonly AcqScopeKind[] = ['game', 'date', 'global', 'query'];

export type AcqEnvelopeV1 = {
  envelope_version: typeof ACQ_ENVELOPE_VERSION;
  collector: { name: string; version: string };
  provider: string;
  league: string;
  endpoint_family: string;
  request: CapturedRequest & {
    page_index: number;
    cursor_in: string | null;
  };
  identity: {
    /** Unique per HTTP attempt. */
    request_id: string;
    pull_run_id: string;
    attempt: number;
    parent_request_id: string | null;
  };
  scope: {
    kind: AcqScopeKind;
    /** game id, ET date, "all", or a query hash; used in the S3 key. */
    scope_id: string;
    /** Season the request asked for. null = genuinely unknown; never guessed. */
    season: number | null;
    /** Provider's own season-type value as sent in the request, verbatim. */
    season_type_requested: string | null;
    game_id: string | null;
    game_date_et: string | null;
    date_window_et: [string, string] | null;
  };
  times: {
    /** QUEUE/CONTROLLER_TIME. null when the caller has none; never back-filled. */
    controller_enqueued_at: string | null;
    request_started_at: string;
    response_received_at: string | null;
    body_completed_at: string | null;
  };
  response: CapturedResponse | null;
  transport_error: CapturedTransportError | null;
  derived_hints: {
    authoritative: false;
    json_parse_ok: boolean | null;
    [key: string]: unknown;
  };
};

export type BuildEnvelopeInput = {
  collector: { name: string; version: string };
  provider: string;
  league: string;
  endpoint_family: string;
  capture: CaptureResult;
  page_index: number;
  cursor_in?: string | null;
  identity: {
    request_id: string;
    pull_run_id: string;
    attempt: number;
    parent_request_id?: string | null;
  };
  scope: {
    kind: AcqScopeKind;
    scope_id: string;
    season: number | null;
    season_type_requested?: string | null;
    game_id?: string | null;
    game_date_et?: string | null;
    date_window_et?: [string, string] | null;
  };
  controller_enqueued_at?: string | null;
  /** Extra non-authoritative hints (e.g. from deriveDataMetaHints). */
  derived_hints?: Record<string, unknown>;
};

export class AcqEnvelopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AcqEnvelopeError';
  }
}

export function newRequestId(): string {
  return randomUUID();
}

export function buildEnvelope(input: BuildEnvelopeInput): AcqEnvelopeV1 {
  const { capture } = input;
  const extraHints = { ...(input.derived_hints ?? {}) };
  delete extraHints.authoritative;
  delete extraHints.json_parse_ok;

  const envelope: AcqEnvelopeV1 = {
    envelope_version: ACQ_ENVELOPE_VERSION,
    collector: { name: input.collector.name, version: input.collector.version },
    provider: input.provider,
    league: input.league,
    endpoint_family: input.endpoint_family,
    request: {
      ...capture.request,
      params: capture.request.params.map(([k, v]) => [k, v] as [string, string]),
      redacted_param_names: [...capture.request.redacted_param_names],
      page_index: input.page_index,
      cursor_in: input.cursor_in ?? null,
    },
    identity: {
      request_id: input.identity.request_id,
      pull_run_id: input.identity.pull_run_id,
      attempt: input.identity.attempt,
      parent_request_id: input.identity.parent_request_id ?? null,
    },
    scope: {
      kind: input.scope.kind,
      scope_id: input.scope.scope_id,
      season: input.scope.season,
      season_type_requested: input.scope.season_type_requested ?? null,
      game_id: input.scope.game_id ?? null,
      game_date_et: input.scope.game_date_et ?? null,
      date_window_et: input.scope.date_window_et ?? null,
    },
    times: {
      controller_enqueued_at: input.controller_enqueued_at ?? null,
      request_started_at: capture.times.request_started_at,
      response_received_at: capture.times.response_received_at,
      body_completed_at: capture.times.body_completed_at,
    },
    response: capture.response ? { ...capture.response, headers: { ...capture.response.headers } } : null,
    transport_error: capture.transport_error ? { ...capture.transport_error } : null,
    derived_hints: {
      ...extraHints,
      authoritative: false,
      json_parse_ok: jsonParseOk(capture.response),
    },
  };
  assertEnvelopeV1(envelope);
  return envelope;
}

const ID_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA256 = /^[0-9a-f]{64}$/;

/** Structural check. Throws AcqEnvelopeError on the first violation. */
export function assertEnvelopeV1(env: AcqEnvelopeV1): void {
  const fail = (msg: string): never => {
    throw new AcqEnvelopeError(msg);
  };
  if (env.envelope_version !== ACQ_ENVELOPE_VERSION) fail('envelope_version must be acq_envelope.v1');
  for (const [name, v] of [
    ['collector.name', env.collector?.name],
    ['collector.version', env.collector?.version],
    ['provider', env.provider],
    ['league', env.league],
    ['endpoint_family', env.endpoint_family],
    ['scope.scope_id', env.scope?.scope_id],
  ] as const) {
    if (typeof v !== 'string' || v.trim() === '') fail(`${name} is required`);
  }
  if (!ID_TOKEN.test(env.identity.request_id)) fail('identity.request_id must be a safe id token');
  if (!ID_TOKEN.test(env.identity.pull_run_id)) fail('identity.pull_run_id must be a safe id token');
  if (!Number.isInteger(env.identity.attempt) || env.identity.attempt < 1) fail('identity.attempt must be an integer >= 1');
  if (!Number.isInteger(env.request.page_index) || env.request.page_index < 0 || env.request.page_index > 9999) {
    fail('request.page_index must be an integer in [0, 9999]');
  }
  if (!ACQ_SCOPE_KINDS.includes(env.scope.kind)) fail(`scope.kind must be one of ${ACQ_SCOPE_KINDS.join(', ')}`);
  if (env.scope.season != null && !(Number.isInteger(env.scope.season) && env.scope.season >= 1900 && env.scope.season <= 2999)) {
    fail('scope.season must be a 4-digit year or null');
  }

  assertIso('times.request_started_at', env.times.request_started_at, false, fail);
  assertIso('times.controller_enqueued_at', env.times.controller_enqueued_at, true, fail);
  assertIso('times.response_received_at', env.times.response_received_at, true, fail);
  assertIso('times.body_completed_at', env.times.body_completed_at, true, fail);

  if (env.response && env.transport_error) fail('response and transport_error are mutually exclusive');
  if (!env.response && !env.transport_error) fail('one of response or transport_error is required');
  if (env.response) {
    if (env.times.response_received_at == null || env.times.body_completed_at == null) {
      fail('a captured response requires response_received_at and body_completed_at');
    }
    if (!Number.isInteger(env.response.http_status)) fail('response.http_status must be an integer');
    if (!SHA256.test(env.response.body_sha256)) fail('response.body_sha256 must be lowercase hex sha256');
    if (env.response.body_encoding !== 'utf8' && env.response.body_encoding !== 'base64') fail('invalid body_encoding');
  }
  if ((env.derived_hints as { authoritative?: unknown }).authoritative !== false) {
    fail('derived_hints.authoritative must be false');
  }
  if ('provider_updated_at' in (env as Record<string, unknown>) || 'provider_updated_at' in env.times) {
    fail('provider_updated_at is not an envelope field');
  }
}

function assertIso(name: string, v: string | null, nullable: boolean, fail: (m: string) => never): void {
  if (v == null) {
    if (!nullable) fail(`${name} is required`);
    return;
  }
  if (typeof v !== 'string' || Number.isNaN(Date.parse(v)) || new Date(v).toISOString() !== v) {
    fail(`${name} must be an ISO-8601 UTC timestamp (toISOString form)`);
  }
}

function jsonParseOk(response: CapturedResponse | null): boolean | null {
  if (!response || response.body_encoding !== 'utf8' || response.body_bytes === 0) return null;
  try {
    JSON.parse(response.body);
    return true;
  } catch {
    return false;
  }
}

/**
 * Optional, non-authoritative hints for `{ data: [...], meta: { next_cursor } }` style
 * bodies. Returns {} for anything else. Never used as evidence.
 */
export function deriveDataMetaHints(response: CapturedResponse | null): Record<string, unknown> {
  if (!response || response.body_encoding !== 'utf8') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed == null || Array.isArray(parsed)) return {};
  const obj = parsed as { data?: unknown; meta?: { next_cursor?: unknown } };
  const hints: Record<string, unknown> = {};
  if (Array.isArray(obj.data)) hints.row_count = obj.data.length;
  if (obj.meta && typeof obj.meta === 'object' && 'next_cursor' in obj.meta) {
    const c = obj.meta.next_cursor;
    hints.next_cursor = typeof c === 'number' || typeof c === 'string' ? c : null;
  }
  return hints;
}

/** Recursively key-sorted JSON so the same envelope always serializes identically. */
export function serializeEnvelope(env: AcqEnvelopeV1): string {
  return stableStringify(env);
}

export function envelopeSha256(env: AcqEnvelopeV1): string {
  return createHash('sha256').update(serializeEnvelope(env), 'utf8').digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value === undefined ? null : value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}
