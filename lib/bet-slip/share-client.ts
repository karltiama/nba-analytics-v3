/**
 * Client helper: create (or reuse) a shared slip via POST /api/shared-slips.
 */

import { canonicalBetLegFromSelectedParlayLeg } from './adapt-parlay-leg';
import { shareSlipFingerprint } from './share-fingerprint';
import {
  getCachedSharedSlip,
  setCachedSharedSlip,
  type CachedSharedSlip,
} from './share-session';
import type { CanonicalBetLeg, CanonicalBetSlipSource, PublicSharedBetSlip } from './types';
import type { SelectedParlayLeg } from '@/lib/parlay/selection';

export type EnsureSharedSlipResult =
  | { ok: true; share: PublicSharedBetSlip; reused: boolean }
  | {
      ok: false;
      code: 'EMPTY' | 'UNAUTHORIZED' | 'INVALID' | 'FAILED';
      message?: string;
      status?: number;
    };

export function legsToSharePayload(
  legs: SelectedParlayLeg[],
  source: CanonicalBetSlipSource,
  title?: string | null
): { legs: CanonicalBetLeg[]; fingerprint: string; source: CanonicalBetSlipSource; title: string | null } {
  const canonicalLegs = legs.map((leg) => canonicalBetLegFromSelectedParlayLeg(leg));
  return {
    legs: canonicalLegs,
    fingerprint: shareSlipFingerprint(canonicalLegs),
    source,
    title: title?.trim() || null,
  };
}

export async function ensureSharedSlipFromSelection(input: {
  legs: SelectedParlayLeg[];
  source: CanonicalBetSlipSource;
  title?: string | null;
}): Promise<EnsureSharedSlipResult> {
  if (!input.legs.length) return { ok: false, code: 'EMPTY', message: 'Add at least one leg to share.' };

  const payload = legsToSharePayload(input.legs, input.source, input.title);
  const cached = getCachedSharedSlip(payload.fingerprint);
  if (cached) {
    return {
      ok: true,
      reused: true,
      share: {
        shareId: cached.shareId,
        title: cached.title,
        source: input.source,
        snapshotVersion: 1,
        legs: payload.legs,
        createdAt: cached.createdAt,
        path: cached.path,
      },
    };
  }

  try {
    const res = await fetch('/api/shared-slips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        source: payload.source,
        title: payload.title,
        legs: payload.legs,
      }),
    });

    if (res.status === 401) {
      return { ok: false, code: 'UNAUTHORIZED', status: 401, message: 'Sign in to share this parlay.' };
    }

    const body = (await res.json().catch(() => ({}))) as {
      share?: PublicSharedBetSlip;
      error?: string;
      message?: string;
    };

    if (!res.ok || !body.share) {
      const code = res.status >= 400 && res.status < 500 ? 'INVALID' : 'FAILED';
      return {
        ok: false,
        code,
        status: res.status,
        message: body.message || body.error || 'Could not create share link.',
      };
    }

    const entry: CachedSharedSlip = {
      fingerprint: payload.fingerprint,
      shareId: body.share.shareId,
      path: body.share.path,
      title: body.share.title,
      createdAt: body.share.createdAt,
    };
    setCachedSharedSlip(entry);

    return { ok: true, share: body.share, reused: false };
  } catch (error) {
    return {
      ok: false,
      code: 'FAILED',
      message: error instanceof Error ? error.message : 'Could not create share link.',
    };
  }
}

export function absoluteShareUrl(path: string, origin?: string): string {
  const base =
    origin ??
    (typeof window !== 'undefined' ? window.location.origin : 'https://courtcontext.com');
  return `${base.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

export function displayShareHostPath(path: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `courtcontext.com${clean}`;
}
