'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';
import { CHECKLIST_COPY } from '@/lib/onboarding/copy';
import {
  checklistItems,
  ONBOARDING_CHANGED_EVENT,
  type ChecklistItemId,
} from '@/lib/onboarding/contract';
import { patchOnboardingState, readOnboardingState } from '@/lib/onboarding/storage';

export function GettingStartedChecklist() {
  const [visible, setVisible] = useState(false);
  const [done, setDone] = useState<Partial<Record<ChecklistItemId, boolean>>>({});

  const refresh = useCallback(() => {
    const state = readOnboardingState();
    const show =
      (state.completed || state.replay) &&
      !state.checklistDismissed &&
      (state.replay || state.guidanceLevel !== 'advanced');
    setVisible(show);
    setDone(state.checklist);
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener(ONBOARDING_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(ONBOARDING_CHANGED_EVENT, refresh);
  }, [refresh]);

  if (!visible) return null;

  const items = checklistItems();
  const completedCount = items.filter((item) => done[item.id]).length;

  return (
    <section
      aria-labelledby="getting-started-heading"
      className="rounded-2xl border border-[#DCE9EA] bg-white shadow-sm p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="getting-started-heading" className="text-sm font-semibold text-[#063f46]">
            Getting started
          </h2>
          <p className="text-xs text-[#4a6366] mt-1">
            Optional. {completedCount} of {items.length} done.
          </p>
        </div>
        <button
          type="button"
          className="min-h-[44px] min-w-[44px] rounded-lg text-[#4a6366] hover:bg-[#f7f9f7] flex items-center justify-center"
          aria-label="Dismiss getting started checklist"
          onClick={() => {
            patchOnboardingState({ checklistDismissed: true });
            setVisible(false);
          }}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <ul className="mt-3 space-y-2">
        {items.map((item) => {
          const checked = Boolean(done[item.id]);
          return (
            <li key={item.id}>
              <Link
                href={item.href}
                className="flex items-center gap-2 min-h-[44px] rounded-xl px-2 text-sm text-[#063f46] hover:bg-[#f7f9f7]"
              >
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] ${
                    checked
                      ? 'border-[#075B5C] bg-[#55ddb1] text-[#063f46]'
                      : 'border-[#DCE9EA] text-transparent'
                  }`}
                  aria-hidden
                >
                  ✓
                </span>
                <span className={checked ? 'text-[#4a6366] line-through' : ''}>
                  {CHECKLIST_COPY[item.id]}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
