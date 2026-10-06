/**
 * Acquisition-zone S3 keys (DATA1 §3.1). New `entity=acq_*` zone only;
 * no existing prefix is renamed, reused, or written.
 *
 * raw/source={provider}/league={league}/season={season|unknown}/entity=acq_{endpoint_family}/
 *   obs_date={UTC YYYY-MM-DD}/scope={kind}/scope_id={id}/
 *   obs={YYYYMMDDTHHMMSSmmmZ}__run={pull_run_id}__req={request_id}__p={0000}.json.gz
 *
 * Transport failures (no response) use `att=` (request_started_at) in place of `obs=`
 * so a key never claims an observation that did not happen. obs_date then follows
 * the attempt start.
 */

import { createHash } from 'node:crypto';
import type { AcqEnvelopeV1 } from './envelope';
import { assertEnvelopeV1 } from './envelope';

export const ACQ_DEFAULT_RAW_PREFIX = 'raw';
export const ACQ_ENTITY_PREFIX = 'acq_';
export const ACQ_OBJECT_SUFFIX = '.json.gz';

export class AcqKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AcqKeyError';
  }
}

const LOWER_TOKEN = /^[a-z0-9][a-z0-9_]{0,63}$/;
const ID_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** provider / league / endpoint_family: lowercase [a-z0-9_]. Throws instead of silently rewriting. */
export function lowerToken(name: string, value: string): string {
  const v = value.trim().toLowerCase();
  if (!LOWER_TOKEN.test(v)) throw new AcqKeyError(`${name} must match ${LOWER_TOKEN} (got ${JSON.stringify(value)})`);
  return v;
}

/** request_id / pull_run_id: must already be safe; never rewritten (uniqueness depends on it). */
export function idToken(name: string, value: string): string {
  if (!ID_TOKEN.test(value)) throw new AcqKeyError(`${name} must match ${ID_TOKEN}`);
  return value;
}

/** scope_id: free-form caller value reduced to [A-Za-z0-9._-]; never "." or "..". */
export function sanitizeScopeId(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[._-]+/, '')
    .slice(0, 128);
  if (!cleaned || cleaned === '.' || cleaned === '..') throw new AcqKeyError('scope_id is empty after sanitization');
  return cleaned;
}

/** Stable 8-hex id for scope=query from (path, redacted params excluding cursor). */
export function queryScopeId(path: string, params: Array<[string, string]>): string {
  const canonical = params
    .filter(([k]) => k !== 'cursor')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .sort()
    .join('&');
  return createHash('sha256').update(`${path}?${canonical}`, 'utf8').digest('hex').slice(0, 8);
}

export function compactUtcTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new AcqKeyError(`invalid timestamp ${iso}`);
  const s = d.toISOString(); // YYYY-MM-DDTHH:MM:SS.mmmZ
  return `${s.slice(0, 4)}${s.slice(5, 7)}${s.slice(8, 10)}T${s.slice(11, 13)}${s.slice(14, 16)}${s.slice(17, 19)}${s.slice(20, 23)}Z`;
}

function normalizeRawPrefix(prefix: string): string {
  const p = prefix.trim().replace(/^\/+|\/+$/g, '');
  if (!p || p.split('/').some((seg) => !seg || seg === '.' || seg === '..')) {
    throw new AcqKeyError(`invalid raw prefix ${JSON.stringify(prefix)}`);
  }
  return p;
}

export function buildAcquisitionKey(env: AcqEnvelopeV1, opts: { rawPrefix?: string } = {}): string {
  assertEnvelopeV1(env);
  const rawPrefix = normalizeRawPrefix(opts.rawPrefix ?? ACQ_DEFAULT_RAW_PREFIX);
  const provider = lowerToken('provider', env.provider);
  const league = lowerToken('league', env.league);
  const family = lowerToken('endpoint_family', env.endpoint_family);
  if (family.startsWith(ACQ_ENTITY_PREFIX)) {
    throw new AcqKeyError('endpoint_family must not include the acq_ prefix');
  }
  const season = env.scope.season == null ? 'unknown' : String(env.scope.season);

  const observed = env.times.response_received_at;
  const anchorIso = observed ?? env.times.request_started_at;
  const anchorToken = observed ? 'obs' : 'att';
  const obsDate = new Date(anchorIso).toISOString().slice(0, 10);

  const run = idToken('pull_run_id', env.identity.pull_run_id);
  const req = idToken('request_id', env.identity.request_id);
  const page = String(env.request.page_index).padStart(4, '0');

  return [
    rawPrefix,
    `source=${provider}`,
    `league=${league}`,
    `season=${season}`,
    `entity=${ACQ_ENTITY_PREFIX}${family}`,
    `obs_date=${obsDate}`,
    `scope=${env.scope.kind}`,
    `scope_id=${sanitizeScopeId(env.scope.scope_id)}`,
    `${anchorToken}=${compactUtcTimestamp(anchorIso)}__run=${run}__req=${req}__p=${page}${ACQ_OBJECT_SUFFIX}`,
  ].join('/');
}
