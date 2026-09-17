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
  const previewMode = shouldSuppressProductPreviewAnalytics(previewFlag);
  const [active, setActive] = useState<CoachmarkId | null>(null);
  const [previewDismissed, setPreviewDismissed] = useState<CoachmarkId[]>([]);

  const refresh = useCallback(() => {
    if (previewMode) {
      const next = nextCoachmark({
        surface: surfaceForPath(pathname),
        level: 'getting_started',
        dismissed: previewDismissed,
        presentIds: presentCoachmarkIds(),
        replay: true,
        previewFlag,
      });
      setActive(next);
      return;
    }
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
  }, [pathname, previewFlag, previewMode, previewDismissed]);

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
    if (previewMode) return;
    trackEvent('coachmark_seen', { surface: 'onboarding', coachmark_id: active });
  }, [active, previewMode]);

  if (!active) return null;

  return (
    <CoachmarkCallout
      id={active}
      onDismiss={() => {
        if (previewMode) {
          const dismissed = previewDismissed.includes(active)
            ? previewDismissed
            : [...previewDismissed, active];
          setPreviewDismissed(dismissed);
          setActive(
            nextCoachmark({
              surface: surfaceForPath(pathname),
              level: 'getting_started',
              dismissed,
              presentIds: presentCoachmarkIds(),
              replay: true,
              previewFlag,
            })
          );
          return;
        }
        const after = dismissCoachmark(active);
        if (!after.completed && !after.replay) {
          setActive(null);
          return;
        }
        setActive(
          nextCoachmark({
            surface: surfaceForPath(pathname),
            level: after.replay ? 'getting_started' : after.guidanceLevel,
            dismissed: after.dismissedCoachmarks,
            presentIds: presentCoachmarkIds(),
            replay: after.replay,
            previewFlag,
          })
        );
      }}
    />
  );
}
