/**
 * Response capture for the acquisition contract (DATA1 §1, §2).
 *
 * Body semantics: APPLICATION_RESPONSE_BODY_BYTES = the bytes `Response.arrayBuffer()`
 * exposes to the application. When the runtime transparently decoded a transport
 * `content-encoding` (gzip/br/deflate), these are the decoded bytes, NOT the HTTP wire
 * bytes. The received `content-encoding` header is kept so that fact stays visible.
 *
 * The body is read before any JSON.parse / zod. Nothing here parses the body.
 */

import { createHash } from 'node:crypto';
import { filterResponseHeaders } from './headers';

export const APPLICATION_RESPONSE_BODY_BYTES = 'application_response_body_bytes' as const;

export type BodyEncoding = 'utf8' | 'base64';

export type CapturedRequest = {
  method: string;
  base_url: string;
  path: string;
  /** Query params in request order, sensitive names removed. */
  params: Array<[string, string]>;
  /** Names (never values) of params removed by redaction. */
  redacted_param_names: string[];
};

export type CapturedBody = {
  body_semantics: typeof APPLICATION_RESPONSE_BODY_BYTES;
  body_encoding: BodyEncoding;
  body_bytes: number;
  body_sha256: string;
  /** UTF-8 text when body_encoding = utf8, base64 otherwise. */
  body: string;
};

export type CapturedResponse = CapturedBody & {
  http_status: number;
  headers: Record<string, string>;
  content_encoding_received: string | null;
};

export type CapturedTransportError = {
  name: string;
  message: string;
};

export type CaptureTimes = {
  request_started_at: string;
  /** Headers received. null when the request never produced a response. */
  response_received_at: string | null;
  /** Body fully read. null when the body was never fully read. */
  body_completed_at: string | null;
};

export type CaptureResult = {
  request: CapturedRequest;
  times: CaptureTimes;
  response: CapturedResponse | null;
  transport_error: CapturedTransportError | null;
};

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const SENSITIVE_PARAM = /(^|[_-])(api[_-]?key|apikey|key|token|access[_-]?token|secret|signature|sig|password|auth|authorization|session)$/i;

export function isSensitiveParamName(name: string): boolean {
  return SENSITIVE_PARAM.test(name.trim());
}

export function describeRequest(url: string, method = 'GET'): CapturedRequest {
  const parsed = new URL(url);
  const params: Array<[string, string]> = [];
  const redacted: string[] = [];
  parsed.searchParams.forEach((value, key) => {
    if (isSensitiveParamName(key)) {
      if (!redacted.includes(key)) redacted.push(key);
      return;
    }
    params.push([key, value]);
  });
  return {
    method: method.toUpperCase(),
    // URL.origin never includes userinfo, so embedded credentials are dropped.
    base_url: parsed.origin,
    path: parsed.pathname,
    params,
    redacted_param_names: redacted,
  };
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function encodeBody(bytes: Uint8Array): CapturedBody {
  let encoding: BodyEncoding = 'utf8';
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    encoding = 'base64';
    text = Buffer.from(bytes).toString('base64');
  }
  return {
    body_semantics: APPLICATION_RESPONSE_BODY_BYTES,
    body_encoding: encoding,
    body_bytes: bytes.byteLength,
    body_sha256: sha256Hex(bytes),
    body: text,
  };
}

/** Inverse of encodeBody: returns the exact application body bytes. */
export function decodeBody(body: Pick<CapturedBody, 'body' | 'body_encoding'>): Buffer {
  return body.body_encoding === 'base64' ? Buffer.from(body.body, 'base64') : Buffer.from(body.body, 'utf8');
}

/**
 * Perform one HTTP attempt and capture it. Never throws for HTTP or transport
 * failures; those are returned as evidence. Throws only for an invalid URL.
 */
export async function captureFetch(args: {
  url: string;
  init?: RequestInit;
  fetchImpl?: FetchLike;
  now?: () => Date;
}): Promise<CaptureResult> {
  const now = args.now ?? (() => new Date());
  const fetchImpl = args.fetchImpl ?? ((u: string, i?: RequestInit) => fetch(u, i));
  const request = describeRequest(args.url, args.init?.method ?? 'GET');

  const request_started_at = now().toISOString();
  let res: Response;
  try {
    res = await fetchImpl(args.url, args.init);
  } catch (err) {
    return {
      request,
      times: { request_started_at, response_received_at: null, body_completed_at: null },
      response: null,
      transport_error: toTransportError(err, args.url),
    };
  }
  const response_received_at = now().toISOString();

  const headers = filterResponseHeaders(res.headers);
  const contentEncoding = res.headers.get('content-encoding');
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    return {
      request,
      times: { request_started_at, response_received_at, body_completed_at: null },
      response: null,
      transport_error: toTransportError(err, args.url),
    };
  }
  const body_completed_at = now().toISOString();

  return {
    request,
    times: { request_started_at, response_received_at, body_completed_at },
    response: {
      http_status: res.status,
      headers,
      content_encoding_received: contentEncoding,
      ...encodeBody(bytes),
    },
    transport_error: null,
  };
}

function toTransportError(err: unknown, url: string): CapturedTransportError {
  const name = err instanceof Error ? err.name || 'Error' : 'Error';
  const raw = err instanceof Error ? err.message : String(err);
  // Runtime error messages can echo the request URL, which may carry secret params.
  return { name, message: raw.split(url).join('<request-url-redacted>') };
}
