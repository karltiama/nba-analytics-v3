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
      className="fixed inset-x-3 bottom-3 z-[180] sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[min(100vw-2rem,22rem)]"
    >
      <div className="rounded-2xl border border-[#DCE9EA] bg-white shadow-lg p-4">
        <h2 id={`coachmark-title-${id}`} className="text-sm font-semibold text-[#063f46]">
          {copy.title}
        </h2>
        <p className="text-sm text-[#4a6366] mt-1">{copy.body}</p>
        <button
          type="button"
          className="mt-3 inline-flex items-center justify-center min-h-[44px] px-3 text-sm font-semibold rounded-lg bg-[#063f46] text-white hover:bg-[#075B5C]"
          onClick={onDismiss}
        >
          Got it
        </button>
      </div>
    </div>
  );
}
