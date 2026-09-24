/**
 * Strict outbound URL validation for sportsbook handoff destinations.
 * All URLs must be HTTPS on approved provider-owned hosts.
 */

import {
  HANDOFF_SPORTSBOOK_HOME_URLS,
  type SportsbookHandoffProvider,
} from './types';

/** Approved hosts for Phase 3 pinned destinations. */
export const HANDOFF_ALLOWED_HOSTS = [
  'sportsbook.draftkings.com',
  'sportsbook.fanduel.com',
  'sportsbook.caesars.com',
  'betfanatics.com',
  'www.betmgm.com',
] as const;

export type HandoffAllowedHost = (typeof HANDOFF_ALLOWED_HOSTS)[number];

const ALLOWED_HOST_SET = new Set<string>(HANDOFF_ALLOWED_HOSTS);

export type AssertHandoffUrlResult =
  | { ok: true; url: URL }
  | { ok: false; reason: string };

export function assertHandoffDestinationUrl(raw: string): AssertHandoffUrlResult {
  const trimmed = raw?.trim() ?? '';
  if (!trimmed) return { ok: false, reason: 'Empty URL' };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'Invalid URL' };
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: 'HTTPS required' };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'Credentials in URL are not allowed' };
  }

  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_HOST_SET.has(host)) {
    return { ok: false, reason: `Host not allowlisted: ${host}` };
  }

  return { ok: true, url: parsed };
}

/** Returns the pinned homepage URL only after allowlist validation. */
export function getVerifiedSportsbookHomeUrl(
  sportsbook: SportsbookHandoffProvider
): string {
  const raw = HANDOFF_SPORTSBOOK_HOME_URLS[sportsbook];
  const asserted = assertHandoffDestinationUrl(raw);
  if (!asserted.ok) {
    throw new Error(`Handoff homepage failed allowlist for ${sportsbook}: ${asserted.reason}`);
  }
  return asserted.url.toString();
}
