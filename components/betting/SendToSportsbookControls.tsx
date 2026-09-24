'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { CanonicalBetLeg, CanonicalBetSlip } from '@/lib/bet-slip/types';
import {
  HANDOFF_PROVIDER_DISPLAY,
  isLiveSportsbookResolutionAvailable,
  listHandoffProviders,
  openSportsbookLabel,
  resolveSportsbookHandoff,
  type SportsbookHandoffProvider,
} from '@/lib/sportsbook-handoff';
import type { HandoffSheetLeg } from '@/lib/sportsbook-handoff/present';
import { isOddsApiHandoffSpikeEnabled } from '@/lib/sportsbook-selection-deeplink';
import { PRODUCT_EVENTS, trackEvent } from '@/lib/product-analytics/track-event';
import type { SportsbookHandoffSurface } from '@/lib/product-analytics/track-event';
import { SendToSportsbookLevel3Spike } from '@/components/betting/SendToSportsbookLevel3Spike';

export function SendToSportsbookControls({
  legs,
  slip,
  surface,
  fromSharedSnapshot = false,
  className,
  /** Optional canonical legs for flag-gated Level-3 spike only. */
  spikeLegs,
}: {
  legs: HandoffSheetLeg[];
  /** Optional slip for resolver context; never mutated. */
  slip?: CanonicalBetSlip | null;
  surface: SportsbookHandoffSurface;
  fromSharedSnapshot?: boolean;
  className?: string;
  spikeLegs?: CanonicalBetLeg[] | null;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const providers = listHandoffProviders();
  const spikeEnabled = isOddsApiHandoffSpikeEnabled();
  const [spikeBook, setSpikeBook] = useState<SportsbookHandoffProvider>('fanduel');

  const closeSheet = useCallback(() => {
    dialogRef.current?.close();
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onClose = () => undefined;
    dialog.addEventListener('close', onClose);
    return () => dialog.removeEventListener('close', onClose);
  }, []);

  const openSheet = useCallback(() => {
    trackEvent(PRODUCT_EVENTS.SPORTSBOOK_HANDOFF_OPENED, {
      surface,
      leg_count: legs.length,
      live_resolution_available: isLiveSportsbookResolutionAvailable(),
    });
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, [legs.length, surface]);

  const onProviderClick = useCallback(
    (provider: SportsbookHandoffProvider) => {
      trackEvent(PRODUCT_EVENTS.SPORTSBOOK_HANDOFF_PROVIDER_SELECTED, {
        surface,
        provider,
        leg_count: legs.length,
        live_resolution_available: false,
      });

      const destination = resolveSportsbookHandoff({
        sportsbook: provider,
        slip: slip ?? null,
      });

      trackEvent(PRODUCT_EVENTS.SPORTSBOOK_HANDOFF_OUTBOUND_CLICKED, {
        surface,
        provider,
        handoff_level: destination.level,
        leg_count: legs.length,
        live_resolution_available: false,
      });

      window.open(destination.url, '_blank', 'noopener,noreferrer');
    },
    [legs.length, slip, surface]
  );

  const disabled = legs.length === 0;

  return (
    <>
      <button
        type="button"
        className={
          className ??
          'type-interactive inline-flex min-h-[44px] items-center justify-center rounded-lg border border-[#075B5C] px-3 text-[#075B5C] hover:bg-[#55ddb1]/20 disabled:opacity-40'
        }
        onClick={openSheet}
        disabled={disabled}
        aria-haspopup="dialog"
      >
        Send to Sportsbook
      </button>

      <dialog
        ref={dialogRef}
        className="w-[min(26rem,calc(100vw-2rem))] max-h-[min(90vh,40rem)] overflow-y-auto rounded-2xl border border-[#DCE9EA] bg-white p-0 text-[#063f46] shadow-lg backdrop:bg-[#063f46]/40"
        aria-labelledby={titleId}
        onClick={(e) => {
          if (e.target === dialogRef.current) closeSheet();
        }}
        onCancel={(e) => {
          e.preventDefault();
          closeSheet();
        }}
      >
        <div className="px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id={titleId} className="type-section-heading text-[#063f46]">
                Send to Sportsbook
              </h2>
              <p className="type-secondary mt-1">Choose where you&apos;d like to continue.</p>
            </div>
            <button
              type="button"
              className="type-interactive min-h-[32px] shrink-0 rounded-lg border border-[#DCE9EA] bg-white px-2 py-1 text-[#063f46] hover:bg-[#f7f9f7]"
              onClick={closeSheet}
            >
              Close
            </button>
          </div>

          <p className="type-metadata mt-3 text-[#4a6366]">
            Your Court Context selections won&apos;t be automatically loaded yet. Confirm the current
            lines and odds in your sportsbook.
          </p>

          {legs.length > 0 ? (
            <div className="mt-4 rounded-xl border border-[#DCE9EA] bg-[#F8FBFA] px-3 py-3">
              <p className="type-metadata text-[#4a6366]">
                {legs.length} selection{legs.length === 1 ? '' : 's'}
              </p>
              <ul className="mt-2 space-y-2">
                {legs.map((leg) => (
                  <li key={leg.key} className="min-w-0">
                    <p className="type-card-data break-words text-[#063f46]">{leg.playerName}</p>
                    <p className="type-secondary break-words">{leg.sideLineMarket}</p>
                    {leg.originallySelectedLabel ? (
                      <p className="type-metadata mt-0.5">
                        Originally selected: {leg.originallySelectedLabel}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <ul className="mt-4 space-y-2">
            {providers.map((provider) => (
              <li key={provider}>
                <div className="flex items-center justify-between gap-3 rounded-xl border border-[#DCE9EA] bg-white px-3 py-2.5">
                  <span className="type-card-data text-[#063f46]">
                    {HANDOFF_PROVIDER_DISPLAY[provider]}
                  </span>
                  <button
                    type="button"
                    className="type-interactive inline-flex min-h-[40px] shrink-0 items-center justify-center rounded-lg border border-[#075B5C] bg-[#075B5C] px-3 text-white hover:opacity-90"
                    onClick={() => onProviderClick(provider)}
                  >
                    {openSportsbookLabel(provider)}
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {spikeEnabled && spikeLegs && spikeLegs.length > 0 ? (
            <div className="mt-4">
              <label className="type-metadata text-[#4a6366]">
                Spike book{' '}
                <select
                  className="ml-1 rounded border border-[#DCE9EA] bg-white px-1 py-0.5"
                  value={spikeBook}
                  onChange={(e) => setSpikeBook(e.target.value as SportsbookHandoffProvider)}
                >
                  {providers.map((p) => (
                    <option key={p} value={p}>
                      {HANDOFF_PROVIDER_DISPLAY[p]}
                    </option>
                  ))}
                </select>
              </label>
              <SendToSportsbookLevel3Spike
                legs={spikeLegs}
                sportsbook={spikeBook}
                resolveSelection={async ({ leg, sportsbook, game }) => {
                  const res = await fetch('/api/spike/odds-api-selection', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ leg, sportsbook, game }),
                  });
                  if (!res.ok) throw new Error('spike resolve failed');
                  const json = (await res.json()) as {
                    resolution: import('@/lib/sportsbook-selection-deeplink').SportsbookSelectionResolution;
                  };
                  return json.resolution;
                }}
              />
            </div>
          ) : null}

          <p className="type-metadata mt-4 text-[#4a6366]">
            Lines and odds may have changed. Confirm all selections in your sportsbook before placing
            a wager.
          </p>
          {fromSharedSnapshot ? (
            <p className="type-metadata mt-1 text-[#4a6366]">
              These lines and odds reflect when the slip was shared.
            </p>
          ) : null}
        </div>
      </dialog>
    </>
  );
}
