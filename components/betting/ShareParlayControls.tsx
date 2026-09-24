'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  absoluteShareUrl,
  displayShareHostPath,
  ensureSharedSlipFromSelection,
  type EnsureSharedSlipResult,
} from '@/lib/bet-slip/share-client';
import type { CanonicalBetSlipSource } from '@/lib/bet-slip/types';
import type { SelectedParlayLeg } from '@/lib/parlay/selection';
import { PRODUCT_EVENTS, trackEvent } from '@/lib/product-analytics/track-event';
import type { SharedSlipSurface } from '@/lib/product-analytics/track-event';

type SharePhase = 'idle' | 'creating' | 'ready' | 'error';

function canNativeShare(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
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

export function ShareParlayControls({
  legs,
  source,
  surface,
  title,
  className,
}: {
  legs: SelectedParlayLeg[];
  source: CanonicalBetSlipSource;
  surface: SharedSlipSurface;
  title?: string | null;
  className?: string;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [phase, setPhase] = useState<SharePhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [sharePath, setSharePath] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const closeSheet = useCallback(() => {
    dialogRef.current?.close();
    setCopied(false);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onClose = () => {
      setPhase((p) => (p === 'creating' ? p : 'idle'));
    };
    dialog.addEventListener('close', onClose);
    return () => dialog.removeEventListener('close', onClose);
  }, []);

  const openReady = useCallback((path: string) => {
    setSharePath(path);
    setPhase('ready');
    setError(null);
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const handleCreateResult = useCallback(
    (result: EnsureSharedSlipResult) => {
      if (result.ok) {
        trackEvent(PRODUCT_EVENTS.SHARED_SLIP_CREATED, {
          surface,
          leg_count: result.share.legs.length,
          reused: result.reused,
        });
        openReady(result.share.path);
        return;
      }
      setPhase('error');
      if (result.code === 'UNAUTHORIZED') {
        setError('Sign in to share this parlay.');
        const next = encodeURIComponent(
          typeof window !== 'undefined' ? `${window.location.pathname}${window.location.search}` : '/betting'
        );
        window.location.assign(`/login?next=${next}`);
        return;
      }
      setError(result.message || 'Could not create share link.');
      const dialog = dialogRef.current;
      if (dialog && !dialog.open) dialog.showModal();
    },
    [openReady, surface]
  );

  const startShare = useCallback(async () => {
    if (legs.length === 0 || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setPhase('creating');
    setError(null);
    setCopied(false);
    try {
      const result = await ensureSharedSlipFromSelection({ legs, source, title });
      handleCreateResult(result);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [handleCreateResult, legs, source, title]);

  const onCopy = useCallback(async () => {
    if (!sharePath) return;
    const url = absoluteShareUrl(sharePath);
    const ok = await copyText(url);
    if (!ok) {
      setError('Could not copy link. Select and copy it manually.');
      return;
    }
    setCopied(true);
    trackEvent(PRODUCT_EVENTS.SHARED_SLIP_COPY_LINK, { surface });
    window.setTimeout(() => setCopied(false), 2000);
  }, [sharePath, surface]);

  const onNativeShare = useCallback(async () => {
    if (!sharePath || !canNativeShare()) return;
    const url = absoluteShareUrl(sharePath);
    try {
      await navigator.share({
        title: title?.trim() || 'Court Context parlay',
        text: 'Check out this Court Context prop slip',
        url,
      });
      trackEvent(PRODUCT_EVENTS.SHARED_SLIP_NATIVE_SHARE, { surface });
    } catch (err) {
      // User cancel is not a failure to surface aggressively.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const ok = await copyText(url);
      if (ok) {
        setCopied(true);
        trackEvent(PRODUCT_EVENTS.SHARED_SLIP_COPY_LINK, { surface });
      } else {
        setError('Sharing failed. Try copying the link instead.');
      }
    }
  }, [sharePath, surface, title]);

  const disabled = legs.length === 0 || busy;

  return (
    <>
      <button
        type="button"
        className={
          className ??
          'type-interactive inline-flex min-h-[44px] items-center justify-center rounded-lg border border-[#075B5C] bg-[#075B5C] px-3 py-2.5 text-center text-white hover:opacity-90 disabled:opacity-40'
        }
        onClick={() => void startShare()}
        disabled={disabled}
        aria-busy={busy}
        aria-haspopup="dialog"
      >
        {busy ? 'Sharing…' : 'Share'}
      </button>

      <dialog
        ref={dialogRef}
        className="w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-[#DCE9EA] bg-white p-0 text-[#063f46] shadow-lg backdrop:bg-[#063f46]/40"
        aria-labelledby={titleId}
        onClick={(e) => {
          if (e.target === dialogRef.current) closeSheet();
        }}
        onCancel={(e) => {
          e.preventDefault();
          closeSheet();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') closeSheet();
        }}
      >
        <div className="px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <h2 id={titleId} className="type-section-heading text-[#063f46]">
              Share this parlay
            </h2>
            <button
              type="button"
              className="type-interactive min-h-[32px] rounded-lg border border-[#DCE9EA] bg-white px-2 py-1 text-[#063f46] hover:bg-[#f7f9f7]"
              onClick={closeSheet}
            >
              Close
            </button>
          </div>

          {phase === 'creating' ? (
            <p className="type-secondary mt-3" role="status">
              Creating share link…
            </p>
          ) : null}

          {phase === 'error' && error ? (
            <p className="type-secondary mt-3 text-red-700" role="alert">
              {error}
            </p>
          ) : null}

          {phase === 'ready' && sharePath ? (
            <div className="mt-3 space-y-3">
              <p className="type-secondary break-all rounded-lg border border-[#DCE9EA] bg-[#F8FBFA] px-3 py-2 text-[#063f46]">
                {displayShareHostPath(sharePath)}
              </p>
              <p className="type-metadata">
                Lines and odds are frozen at share time. Editing your tray later will not change this
                link.
              </p>
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  className="type-interactive inline-flex min-h-[44px] items-center justify-center rounded-lg border border-[#075B5C] bg-[#075B5C] px-3 text-white hover:opacity-90"
                  onClick={() => void onCopy()}
                >
                  {copied ? 'Copied' : 'Copy link'}
                </button>
                {canNativeShare() ? (
                  <button
                    type="button"
                    className="type-interactive inline-flex min-h-[44px] items-center justify-center rounded-lg border border-[#075B5C] px-3 text-[#075B5C] hover:bg-[#55ddb1]/20"
                    onClick={() => void onNativeShare()}
                  >
                    Share…
                  </button>
                ) : null}
              </div>
              {copied ? (
                <p className="type-metadata text-[#075B5C]" role="status">
                  Link copied to clipboard.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </dialog>
    </>
  );
}
