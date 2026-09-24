/**
 * Structural validation of provider-returned outcome links (no navigation).
 */

import { assertHandoffDestinationUrl } from '@/lib/sportsbook-handoff/allowlist';
import {
  HANDOFF_SPORTSBOOK_HOME_URLS,
  type SportsbookHandoffProvider,
} from '@/lib/sportsbook-handoff/types';
import type { LinkValidityRecord } from './types';

/** Mask query values while preserving param names for shape verification. */
export function maskUrlShape(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const params = [...url.searchParams.keys()];
  const q = params.length ? `?${params.map((k) => `${k}=…`).join('&')}` : '';
  const path = url.pathname.replace(/\/[0-9]{5,}/g, '/…');
  return `${url.protocol}//${url.hostname}${path}${q}`;
}

export function validateOutcomeLink(
  raw: string | null | undefined,
  sportsbook: SportsbookHandoffProvider
): LinkValidityRecord {
  const trimmed = raw?.trim() ?? '';
  if (!trimmed) {
    return {
      host: null,
      https: false,
      allowlisted: false,
      providerHostMatch: null,
      reason: 'empty',
      urlShape: null,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      host: null,
      https: false,
      allowlisted: false,
      providerHostMatch: null,
      reason: 'invalid_url',
      urlShape: null,
    };
  }

  const https = parsed.protocol === 'https:';
  const host = parsed.hostname.toLowerCase();
  const asserted = assertHandoffDestinationUrl(trimmed);
  const homeHost = new URL(HANDOFF_SPORTSBOOK_HOME_URLS[sportsbook]).hostname.toLowerCase();
  const providerHostMatch = host === homeHost || host.endsWith(`.${homeHost}`) || homeHost.endsWith(`.${host}`);

  return {
    host,
    https,
    allowlisted: asserted.ok,
    providerHostMatch,
    reason: asserted.ok ? undefined : asserted.reason,
    urlShape: maskUrlShape(trimmed),
  };
}
