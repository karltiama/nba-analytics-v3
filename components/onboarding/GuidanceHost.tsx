'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { CoachmarkCallout } from '@/components/onboarding/CoachmarkCallout';
import {
  COACHMARK_IDS,
  ONBOARDING_CHANGED_EVENT,
  nextCoachmark,
  surfaceForPath,
  type CoachmarkId,
} from '@/lib/onboarding/contract';
import { dismissCoachmark, readOnboardingState } from '@/lib/onboarding/storage';
import { shouldSuppressProductPreviewAnalytics } from '@/lib/parlay/preview-fixture';
import { trackEvent } from '@/lib/product-analytics/track-event';

function presentCoachmarkIds(): CoachmarkId[] {
  if (typeof document === 'undefined') return [];
  const found: CoachmarkId[] = [];
  for (const id of COACHMARK_IDS) {
    if (document.querySelector(`[data-coachmark="${id}"]`)) found.push(id);
  }
  return found;
}

export function GuidanceHost() {
  const pathname = usePathname() || '';
  const previewFlag = useSearchParams().get('preview');
  const [active, setActive] = useState<CoachmarkId | null>(null);

  const refresh = useCallback(() => {
    const state = readOnboardingState();
    if (!state.completed && !state.replay) {
      setActive(null);
      return;
    }
    const next = nextCoachmark({
      surface: surfaceForPath(pathname),
      level: state.replay ? 'getting_started' : state.guidanceLevel,
      dismissed: state.dismissedCoachmarks,
      presentIds: presentCoachmarkIds(),
      replay: state.replay,
      previewFlag,
    });
    setActive(next);
  }, [pathname, previewFlag]);

  useEffect(() => {
    refresh();
    const onChange = () => {
      window.requestAnimationFrame(() => refresh());
    };
    window.addEventListener(ONBOARDING_CHANGED_EVENT, onChange);
    const observer = new MutationObserver(onChange);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-coachmark'],
    });
    return () => {
      window.removeEventListener(ONBOARDING_CHANGED_EVENT, onChange);
      observer.disconnect();
    };
  }, [refresh]);

  useEffect(() => {
    if (!active) return;
    if (shouldSuppressProductPreviewAnalytics(previewFlag)) return;
    trackEvent('coachmark_seen', { surface: 'onboarding', coachmark_id: active });
  }, [active, previewFlag]);

  if (!active) return null;

  return (
    <CoachmarkCallout
      id={active}
      onDismiss={() => {
        dismissCoachmark(active);
        setActive(null);
      }}
    />
  );
}
