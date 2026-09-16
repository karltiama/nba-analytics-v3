'use client';

import { useCallback, useEffect, useState } from 'react';
import { Dialog } from 'radix-ui';
import Link from 'next/link';
import { EXISTING_USER_PROMPT, PRODUCT_MAP, XRAY_MAP_UNAVAILABLE } from '@/lib/onboarding/copy';
import { isPublicXrayExtractionReady, ONBOARDING_CHANGED_EVENT } from '@/lib/onboarding/contract';
import { patchOnboardingState, readOnboardingState, requestTourReplay } from '@/lib/onboarding/storage';
import { trackEvent } from '@/lib/product-analytics/track-event';

export function ProductTourDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const xrayReady = isPublicXrayExtractionReady();

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[200] bg-[#063f46]/40" />
        <Dialog.Content
          className="fixed z-[201] inset-x-0 bottom-0 max-h-[min(92dvh,36rem)] overflow-y-auto rounded-t-2xl border border-[#DCE9EA] bg-white p-5 shadow-xl sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[min(100vw-1.5rem,28rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl"
        >
          <Dialog.Title className="text-lg font-semibold text-[#063f46]">
            How Court Context works
          </Dialog.Title>
          <Dialog.Description className="text-sm text-[#4a6366] mt-1">
            Research offers, review a parlay, then analyze when you are ready.
          </Dialog.Description>
          <ul className="mt-4 space-y-2">
            {PRODUCT_MAP.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="block rounded-xl border border-[#DCE9EA] px-3 py-3 hover:bg-[#f7f9f7]"
                  onClick={() => onOpenChange(false)}
                >
                  <p className="text-sm font-medium text-[#063f46]">{item.title}</p>
                  <p className="text-xs text-[#4a6366] mt-0.5">{item.body}</p>
                </Link>
              </li>
            ))}
            <li className="rounded-xl border border-[#DCE9EA] px-3 py-3 bg-[#f7f9f7]">
              <p className="text-sm font-medium text-[#063f46]">{XRAY_MAP_UNAVAILABLE.title}</p>
              <p className="text-xs text-[#4a6366] mt-0.5">
                {xrayReady
                  ? 'Import a slip you have already built. Confirm stays the trust boundary.'
                  : XRAY_MAP_UNAVAILABLE.body}
              </p>
            </li>
          </ul>
          <div className="mt-4 flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              className="inline-flex items-center justify-center min-h-[44px] rounded-xl bg-[#063f46] px-4 text-sm font-semibold text-white hover:bg-[#075B5C]"
              onClick={() => {
                requestTourReplay();
                trackEvent('tour_replayed', { surface: 'onboarding', action: 'replay' });
                onOpenChange(false);
              }}
            >
              Take a quick tour
            </button>
            <Dialog.Close asChild>
              <button
                type="button"
                className="inline-flex items-center justify-center min-h-[44px] rounded-xl border border-[#DCE9EA] px-4 text-sm font-medium text-[#063f46] hover:bg-[#f7f9f7]"
              >
                Close
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ExistingUserPrompt() {
  const [visible, setVisible] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);

  const refresh = useCallback(() => {
    const state = readOnboardingState();
    setVisible(
      state.existingPromptEligible && !state.completed && !state.existingPromptDismissed
    );
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener(ONBOARDING_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(ONBOARDING_CHANGED_EVENT, refresh);
  }, [refresh]);

  if (!visible) return null;

  return (
    <section className="rounded-2xl border border-[#DCE9EA] bg-white shadow-sm p-4">
      <ProductTourDialog open={tourOpen} onOpenChange={setTourOpen} />
      <h2 className="text-sm font-semibold text-[#063f46]">{EXISTING_USER_PROMPT.title}</h2>
      <p className="text-sm text-[#4a6366] mt-1">{EXISTING_USER_PROMPT.body}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="inline-flex items-center justify-center min-h-[44px] rounded-xl bg-[#063f46] px-4 text-sm font-semibold text-white hover:bg-[#075B5C]"
          onClick={() => setTourOpen(true)}
        >
          {EXISTING_USER_PROMPT.cta}
        </button>
        <button
          type="button"
          className="inline-flex items-center justify-center min-h-[44px] rounded-xl border border-[#DCE9EA] px-4 text-sm text-[#063f46] hover:bg-[#f7f9f7]"
          onClick={() => {
            patchOnboardingState({ existingPromptDismissed: true });
            setVisible(false);
          }}
        >
          {EXISTING_USER_PROMPT.dismiss}
        </button>
      </div>
    </section>
  );
}
