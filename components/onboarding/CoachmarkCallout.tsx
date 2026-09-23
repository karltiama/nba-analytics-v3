'use client';

import { useEffect } from 'react';
import { COACHMARK_COPY } from '@/lib/onboarding/copy';
import type { CoachmarkId } from '@/lib/onboarding/contract';

export function CoachmarkCallout({
  id,
  onDismiss,
}: {
  id: CoachmarkId;
  onDismiss: () => void;
}) {
  const copy = COACHMARK_COPY[id];

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onDismiss();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby={`coachmark-title-${id}`}
      className="fixed z-[180] flex w-[min(100vw-1.5rem,22rem)] max-h-[min(24rem,calc(100dvh-5.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom)))] flex-col inset-x-3 top-[max(4.75rem,env(safe-area-inset-top))] lg:inset-x-auto lg:right-4 lg:bottom-[max(0.75rem,env(safe-area-inset-bottom))] lg:top-auto"
    >
      <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[#DCE9EA] bg-white shadow-lg">
        <div className="min-h-0 overflow-y-auto p-4 pb-2">
          <h2 id={`coachmark-title-${id}`} className="type-section-heading text-[#063f46]">
            {copy.title}
          </h2>
          <p className="type-body mt-1 text-[#063f46]">{copy.body}</p>
        </div>
        <div className="shrink-0 border-t border-[#DCE9EA] p-3">
          <button
            type="button"
            className="type-interactive inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[#063f46] px-3 text-white hover:bg-[#075B5C]"
            onClick={onDismiss}
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
