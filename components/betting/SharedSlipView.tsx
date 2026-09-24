'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  absoluteShareUrl,
  displayShareHostPath,
} from '@/lib/bet-slip/share-client';
import { importSharedBetLegsToStore } from '@/lib/bet-slip/adapt-shared-import';
import {
  formatSharedOdds,
  sharedLegHeadline,
} from '@/lib/bet-slip/shared-slip-present';
import type { PublicSharedBetSlip } from '@/lib/bet-slip/types';
import { SendToSportsbookControls } from '@/components/betting/SendToSportsbookControls';
import { displayVendor } from '@/lib/betting/market-movement';
import { PARLAY_WORKSPACE_HREF } from '@/lib/parlay/selection';
import { handoffSheetLegFromCanonical } from '@/lib/sportsbook-handoff';
import { PRODUCT_EVENTS, trackEvent } from '@/lib/product-analytics/track-event';
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through
  }
  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.left = '-9999px';
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

export function SharedSlipView({
  share,
  signedIn,
}: {
  share: PublicSharedBetSlip;
  signedIn: boolean;
}) {
  const router = useRouter();
  const tracked = useRef(false);
  const [copied, setCopied] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);

  useEffect(() => {
    if (tracked.current) return;
    tracked.current = true;
    trackEvent(PRODUCT_EVENTS.SHARED_SLIP_VIEWED, {
      surface: 'shared_slip',
      leg_count: share.legs.length,
    });
  }, [share.legs.length]);

  const heading = share.title?.trim() || 'Shared Parlay';
  const loginHref = `/login?next=${encodeURIComponent(share.path)}`;

  const onCopy = async () => {
    const ok = await copyText(absoluteShareUrl(share.path));
    if (!ok) {
      setImportError('Could not copy link.');
      return;
    }
    setCopied(true);
    trackEvent(PRODUCT_EVENTS.SHARED_SLIP_COPY_LINK, { surface: 'shared_slip' });
    window.setTimeout(() => setCopied(false), 2000);
  };

  const onNativeShare = async () => {
    const url = absoluteShareUrl(share.path);
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: heading,
          text: 'Check out this Court Context prop slip',
          url,
        });
        trackEvent(PRODUCT_EVENTS.SHARED_SLIP_NATIVE_SHARE, { surface: 'shared_slip' });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
      }
    }
    await onCopy();
  };

  const onAddToCourtContext = () => {
    trackEvent(PRODUCT_EVENTS.SHARED_SLIP_CTA_CLICKED, {
      surface: 'shared_slip',
      action: 'add_to_court_context',
    });
    if (!signedIn) {
      trackEvent(PRODUCT_EVENTS.SHARED_SLIP_CTA_CLICKED, {
        surface: 'shared_slip',
        action: 'sign_in',
      });
      router.push(loginHref);
      return;
    }
    setImportBusy(true);
    setImportError(null);
    try {
      const result = importSharedBetLegsToStore(share.legs);
      if (!result.ok) {
        setImportError(result.message);
        return;
      }
      router.push(PARLAY_WORKSPACE_HREF);
    } finally {
      setImportBusy(false);
    }
  };

  const onOpenExplorer = () => {
    trackEvent(PRODUCT_EVENTS.SHARED_SLIP_CTA_CLICKED, {
      surface: 'shared_slip',
      action: 'open_props_explorer',
    });
    if (!signedIn) {
      router.push(`/login?next=${encodeURIComponent('/betting/props-explorer')}`);
      return;
    }
    router.push('/betting/props-explorer');
  };

  return (
    <div className="mx-auto w-full max-w-xl px-4 pb-16 pt-6 sm:px-6">
      <p className="type-metadata uppercase tracking-wide text-[#4a6366]">Shared Parlay</p>
      <h1 className="type-page-title mt-2 break-words text-[#063f46]">{heading}</h1>
      <p className="type-body mt-2 text-cc-secondary">
        {share.legs.length} leg{share.legs.length === 1 ? '' : 's'} · Court Context does not place
        wagers.
      </p>

      <ul className="mt-6 space-y-3">
        {share.legs.map((leg) => (
          <li
            key={`${leg.selectionKey}|${leg.selectedAt}|${leg.selectedSportsbook ?? ''}`}
            className="rounded-2xl border border-[#DCE9EA] bg-white p-4 shadow-sm"
          >
            <p className="type-card-data break-words text-[#063f46]">
              {leg.playerName?.trim() || `Player ${leg.playerId}`}
            </p>
            <p className="type-card-data mt-1 text-[#063f46]">{sharedLegHeadline(leg)}</p>
            <p className="type-secondary mt-2 break-words">
              {leg.selectedSportsbook
                ? `${displayVendor(leg.selectedSportsbook)} · ${formatSharedOdds(leg.selectedOdds)}`
                : `Odds ${formatSharedOdds(leg.selectedOdds)}`}
              {leg.gameLabel ? ` · ${leg.gameLabel}` : null}
            </p>
          </li>
        ))}
      </ul>

      <p className="type-metadata mt-5 text-[#4a6366]">
        Lines and odds shown are from when this slip was shared.
      </p>
      <p className="type-metadata mt-1 text-[#4a6366]">
        Shared{' '}
        {new Date(share.createdAt).toLocaleString('en-US', { timeZone: 'America/New_York' })} ET
      </p>

      <div className="mt-8 flex flex-col gap-2">
        <button
          type="button"
          className="type-interactive inline-flex min-h-[44px] items-center justify-center rounded-lg border border-[#075B5C] bg-[#075B5C] px-4 text-white hover:opacity-90 disabled:opacity-40"
          onClick={onAddToCourtContext}
          disabled={importBusy}
          aria-busy={importBusy}
        >
          {signedIn
            ? importBusy
              ? 'Opening…'
              : 'Add to Court Context'
            : 'Sign in to add to Court Context'}
        </button>
        <button
          type="button"
          className="type-interactive inline-flex min-h-[44px] items-center justify-center rounded-lg border border-[#075B5C] px-4 text-[#075B5C] hover:bg-[#55ddb1]/20"
          onClick={onOpenExplorer}
        >
          Open Props Explorer
        </button>
        <SendToSportsbookControls
          legs={share.legs.map(handoffSheetLegFromCanonical)}
          spikeLegs={share.legs}
          slip={{
            legs: share.legs,
            source: 'shared_slip',
            title: share.title,
          }}
          surface="shared_slip"
          fromSharedSnapshot
          className="type-interactive inline-flex min-h-[44px] items-center justify-center rounded-lg border border-[#075B5C] px-4 text-[#075B5C] hover:bg-[#55ddb1]/20"
        />
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            className="type-interactive inline-flex min-h-[44px] flex-1 items-center justify-center rounded-lg border border-[#DCE9EA] bg-white px-4 text-[#063f46] hover:bg-[#f7f9f7]"
            onClick={() => void onCopy()}
          >
            {copied ? 'Copied' : 'Copy link'}
          </button>
          <button
            type="button"
            className="type-interactive inline-flex min-h-[44px] flex-1 items-center justify-center rounded-lg border border-[#DCE9EA] bg-white px-4 text-[#063f46] hover:bg-[#f7f9f7]"
            onClick={() => {
              trackEvent(PRODUCT_EVENTS.SHARED_SLIP_CTA_CLICKED, {
                surface: 'shared_slip',
                action: 'share',
              });
              void onNativeShare();
            }}
          >
            Share
          </button>
        </div>
      </div>

      {importError ? (
        <p className="type-secondary mt-3 text-red-700" role="alert">
          {importError}
        </p>
      ) : null}

      <p className="type-metadata mt-6 break-all text-[#4a6366]">
        {displayShareHostPath(share.path)}
      </p>
    </div>
  );
}
