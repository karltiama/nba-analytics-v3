/**
 * Archiving /v1/games page adapter for game-status-sync (STEP 14D.DATA2E.1).
 *
 * Per page: rate-limit token (fetchBdlLive) → captureFetch of every HTTP attempt →
 * acq_envelope.v1 → ledger 'pending' → immutable archive → ledger outcome → only when
 * every attempt is ARCHIVED and ledgered: parse + validate the archived body bytes.
 *
 * Strict fail-closed: ARCHIVE_FAILED, IMMUTABILITY_CONFLICT, or any ledger failure sets
 * `acquisition.blockedReason`; runGameStatusSync then writes nothing for the whole cycle.
 */

import {
  archiveEnvelope,
  buildEnvelope,
  captureFetch,
  decodeBody,
  deriveDataMetaHints,
  ledgerRowFromEnvelope,
  newRequestId,
  queryScopeId,
  type AcqArchiveStore,
  type AcqEnvelopeV1,
  type CaptureResult,
  type CapturedResponse,
  type FetchLike,
} from '@/lib/acquisition';
import type { AcqLedgerWriter } from '@/lib/acquisition/ledger-pg';
import { fetchBdlLive, type LiveRateLimitStore } from '@/lib/balldontlie/live-rate-limit';
import type { ProviderGame, StatusSyncFetchPage, StatusSyncPageAcquisition } from './status-sync';
import { statusSyncFetchErrorResult } from './status-sync-fetch';

export const GAME_STATUS_SYNC_COLLECTOR = { name: 'game-status-sync', version: 'data2e1.v1' } as const;
export const GAME_STATUS_SYNC_PROVIDER = 'balldontlie';
export const GAME_STATUS_SYNC_LEAGUE = 'nba';
export const GAME_STATUS_SYNC_ENDPOINT_FAMILY = 'games';
const HTTP_TIMEOUT_MS = 15_000;

export type StatusSyncAcquisitionDeps = {
  env: Record<string, string | undefined>;
  apiKey: string;
  archiveStore: AcqArchiveStore;
  ledger: AcqLedgerWriter;
  rawPrefix?: string;
  fetchImpl?: FetchLike;
  rateLimitStore?: LiveRateLimitStore;
  rateLimitSleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  newRequestId?: () => string;
  /** Scheduler/controller time when the invocation carries one; never back-filled. */
  controllerEnqueuedAt?: string | null;
  logger?: Pick<Console, 'error'>;
};

type GamesPageJson = { data: ProviderGame[]; meta?: { next_cursor?: number | null } };

/** Validates the archived 2xx body: `{ data: object[], meta?: { next_cursor?: int|null } }`. */
export function parseGamesPageBody(
  response: CapturedResponse
): { ok: true; json: GamesPageJson } | { ok: false; error: string } {
  if (response.body_encoding !== 'utf8') return { ok: false, error: 'body is not UTF-8' };
  if (response.body_bytes === 0) return { ok: false, error: 'empty body' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeBody(response).toString('utf8'));
  } catch (err) {
    return { ok: false, error: `invalid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (typeof parsed !== 'object' || parsed == null || Array.isArray(parsed)) {
    return { ok: false, error: 'body is not a JSON object' };
  }
  const obj = parsed as { data?: unknown; meta?: unknown };
  if (!Array.isArray(obj.data)) return { ok: false, error: 'data is not an array' };
  if (obj.data.some((g) => typeof g !== 'object' || g == null || Array.isArray(g))) {
    return { ok: false, error: 'data contains a non-object item' };
  }
  if (obj.meta !== undefined) {
    if (typeof obj.meta !== 'object' || obj.meta == null || Array.isArray(obj.meta)) {
      return { ok: false, error: 'meta is not an object' };
    }
    const c = (obj.meta as { next_cursor?: unknown }).next_cursor;
    if (c !== undefined && c !== null && !(typeof c === 'number' && Number.isInteger(c))) {
      return { ok: false, error: 'meta.next_cursor is not an integer or null' };
    }
  }
  return { ok: true, json: obj as GamesPageJson };
}

function errText(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

export function createAcquiringStatusSyncFetchPage(deps: StatusSyncAcquisitionDeps): StatusSyncFetchPage {
  const now = deps.now ?? (() => new Date());
  const nextRequestId = deps.newRequestId ?? newRequestId;

  return async (url, ctx) => {
    const evidence: StatusSyncPageAcquisition = {
      requestIds: [],
      archiveStatuses: [],
      s3Keys: [],
      blockedReason: null,
    };
    if (!ctx) {
      evidence.blockedReason = 'missing page context';
      return { status: 0, ok: false, error: evidence.blockedReason, acquisition: evidence };
    }
    if (!deps.apiKey) {
      return { status: 0, ok: false, error: 'missing BALLDONTLIE_API_KEY', acquisition: evidence };
    }

    // Every real HTTP attempt happens after its rate-limit token and is captured here.
    const captures: CaptureResult[] = [];
    const capturingFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const capture = await captureFetch({ url: String(input), init, fetchImpl: deps.fetchImpl, now });
      captures.push(capture);
      if (!capture.response) {
        const err = new Error(capture.transport_error?.message ?? 'transport error');
        err.name = capture.transport_error?.name ?? 'Error';
        throw err;
      }
      const headers = new Headers();
      const retryAfter = capture.response.headers['retry-after'];
      if (retryAfter) headers.set('retry-after', retryAfter);
      return new Response(null, { status: capture.response.http_status, headers });
    };

    let thrown: unknown = null;
    try {
      await fetchBdlLive(
        url,
        { headers: { Authorization: deps.apiKey }, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) },
        {
          env: deps.env,
          worker: deps.env.BDL_RATE_LIMIT_WORKER ?? 'game-status-sync',
          fetchImpl: capturingFetch as typeof fetch,
          store: deps.rateLimitStore,
          sleepFn: deps.rateLimitSleep,
        }
      );
    } catch (err) {
      thrown = err;
    }

    const window: [string, string] | null =
      ctx.plan.startDate && ctx.plan.endDate ? [ctx.plan.startDate, ctx.plan.endDate] : null;
    let parentRequestId: string | null = null;
    for (let i = 0; i < captures.length; i += 1) {
      const capture = captures[i];
      const requestId = nextRequestId();
      evidence.requestIds.push(requestId);

      let envelope: AcqEnvelopeV1;
      try {
        envelope = buildEnvelope({
          collector: GAME_STATUS_SYNC_COLLECTOR,
          provider: GAME_STATUS_SYNC_PROVIDER,
          league: GAME_STATUS_SYNC_LEAGUE,
          endpoint_family: GAME_STATUS_SYNC_ENDPOINT_FAMILY,
          capture,
          page_index: ctx.pageIndex,
          cursor_in: ctx.cursor == null ? null : String(ctx.cursor),
          identity: {
            request_id: requestId,
            pull_run_id: ctx.pullRunId,
            attempt: i + 1,
            parent_request_id: parentRequestId,
          },
          scope: {
            kind: 'query',
            scope_id: queryScopeId(capture.request.path, capture.request.params),
            season: ctx.plan.targetSeason,
            season_type_requested: ctx.plan.seasonTypeRequested,
            date_window_et: window,
          },
          controller_enqueued_at: deps.controllerEnqueuedAt ?? null,
          derived_hints: deriveDataMetaHints(capture.response),
        });
      } catch (err) {
        evidence.archiveStatuses.push('ARCHIVE_FAILED');
        evidence.blockedReason ??= `envelope_invalid: ${errText(err)}`;
        parentRequestId = requestId;
        continue;
      }

      let pendingRecorded = true;
      try {
        await deps.ledger.insertRow(ledgerRowFromEnvelope(envelope, null));
      } catch {
        pendingRecorded = false;
      }

      const outcome = await archiveEnvelope({
        store: deps.archiveStore,
        envelope,
        rawPrefix: deps.rawPrefix,
        now,
        logger: deps.logger,
      });
      evidence.archiveStatuses.push(outcome.status);
      if (outcome.key) evidence.s3Keys.push(outcome.key);

      let ledgerError: string | null = null;
      try {
        const row = ledgerRowFromEnvelope(envelope, outcome);
        if (pendingRecorded) await deps.ledger.updateArchiveOutcome(row);
        else await deps.ledger.insertRow(row);
      } catch (err) {
        ledgerError = errText(err);
      }

      if (outcome.status === 'IMMUTABILITY_CONFLICT') {
        evidence.blockedReason ??= `IMMUTABILITY_CONFLICT at ${outcome.key}`;
      } else if (outcome.status === 'ARCHIVE_FAILED') {
        evidence.blockedReason ??= `ARCHIVE_FAILED (${outcome.reason})`;
      }
      if (ledgerError) evidence.blockedReason ??= `ledger_write_failed: ${ledgerError}`;
      parentRequestId = requestId;
    }

    const last = captures.at(-1);
    const lastStatus = last?.response?.http_status ?? 0;
    if (evidence.blockedReason) {
      return { status: lastStatus, ok: false, error: evidence.blockedReason, acquisition: evidence };
    }
    if (thrown != null) {
      return { ...statusSyncFetchErrorResult(thrown), acquisition: evidence };
    }
    if (!last?.response) {
      return { status: 0, ok: false, error: 'no HTTP response captured', acquisition: evidence };
    }
    const status = last.response.http_status;
    if (status < 200 || status >= 300) {
      return { status, ok: false, acquisition: evidence };
    }

    const parsed = parseGamesPageBody(last.response);
    const lastRequestId = evidence.requestIds[evidence.requestIds.length - 1];
    try {
      await deps.ledger.recordParseResult(lastRequestId, parsed.ok, parsed.ok ? null : parsed.error);
    } catch (err) {
      evidence.blockedReason = `ledger_parse_result_failed: ${errText(err)}`;
      return { status, ok: false, error: evidence.blockedReason, acquisition: evidence };
    }
    if (!parsed.ok) {
      return { status, ok: true, parseError: parsed.error, acquisition: evidence };
    }
    return { status, ok: true, json: parsed.json, acquisition: evidence };
  };
}
