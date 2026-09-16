'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { OnboardingModal } from './OnboardingModal';
import {
  destinationForIntent,
  resolveEligibility,
  shouldAutoOpenOnboarding,
  SKIP_DESTINATION,
  type OnboardingEligibility,
} from '@/lib/onboarding/contract';
import type { GuidanceLevel, PrimaryIntent } from '@/lib/onboarding/contract';
import { markOnboardingComplete, patchOnboardingState, readOnboardingState } from '@/lib/onboarding/storage';

type ProfileResponse = {
  profile?: {
    onboardingCompletedAt?: string | null;
    createdAt?: string | null;
  };
};

type AuthState = 'loading' | 'guest' | 'authed';

const PROFILE_RETRY_ATTEMPTS = 8;
const PROFILE_RETRY_DELAY_MS = 200;

async function fetchProfileWithSessionWait(launchFromCta: boolean, signal?: AbortSignal): Promise<Response> {
  const maxAttempts = launchFromCta ? PROFILE_RETRY_ATTEMPTS : 1;
  let last!: Response;
  for (let i = 0; i < maxAttempts; i++) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    if (i > 0) {
      await new Promise((r) => setTimeout(r, PROFILE_RETRY_DELAY_MS));
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
    }
    last = await fetch('/api/user/profile', { credentials: 'include', cache: 'no-store', signal });
    if (last.status !== 401) break;
  }
  return last;
}

function stripOnboardParam(router: ReturnType<typeof useRouter>) {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  if (!params.has('onboard')) return;
  params.delete('onboard');
  const q = params.toString();
  const path = window.location.pathname;
  router.replace(q ? `${path}?${q}` : path);
}

export function OnboardingGate({ children }: { children?: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() || '/betting';
  const searchParams = useSearchParams();

  const fromCtaRef = useRef<boolean | undefined>(undefined);
  if (fromCtaRef.current === undefined) {
    fromCtaRef.current = searchParams.get('onboard') === '1';
  }
  const launchedFromCta = fromCtaRef.current === true;

  const [authState, setAuthState] = useState<AuthState>('loading');
  const [eligibility, setEligibility] = useState<OnboardingEligibility>('not_eligible');
  const [forceOpen, setForceOpen] = useState(launchedFromCta);

  const handleCompleted = useCallback(
    (input: {
      skipped: boolean;
      primaryIntent: PrimaryIntent | null;
      guidanceLevel: GuidanceLevel | null;
    }) => {
      markOnboardingComplete(input);
      setEligibility('completed');
      setForceOpen(false);
      stripOnboardParam(router);
      const dest = input.skipped ? SKIP_DESTINATION : destinationForIntent(input.primaryIntent);
      if (typeof window !== 'undefined' && window.location.pathname !== dest) {
        router.push(dest);
      }
    },
    [router]
  );

  useEffect(() => {
    const ac = new AbortController();

    (async () => {
      const local = readOnboardingState();
      try {
        const res = await fetchProfileWithSessionWait(launchedFromCta, ac.signal);
        if (ac.signal.aborted) return;

        if (res.status === 401 || !res.ok) {
          setAuthState('guest');
          const next = resolveEligibility({
            authenticated: false,
            localCompleted: local.completed,
          });
          setEligibility(next);
          if (next === 'completed') setForceOpen(false);
          stripOnboardParam(router);
          return;
        }

        const data = (await res.json()) as ProfileResponse;
        if (ac.signal.aborted) return;

        setAuthState('authed');
        const next = resolveEligibility({
          authenticated: true,
          onboardingCompletedAt: data.profile?.onboardingCompletedAt,
          createdAt: data.profile?.createdAt,
          localCompleted: local.completed,
        });
        setEligibility(next);
        if (next === 'completed') setForceOpen(false);
        if (next === 'existing_user_prompt') {
          patchOnboardingState({ existingPromptEligible: true });
        }
        stripOnboardParam(router);
      } catch (e) {
        if (ac.signal.aborted) return;
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setAuthState('guest');
        setEligibility(
          resolveEligibility({ authenticated: false, localCompleted: local.completed })
        );
        stripOnboardParam(router);
      }
    })();

    return () => ac.abort();
  }, [router, launchedFromCta]);

  const autoOpen =
    authState !== 'loading' &&
    shouldAutoOpenOnboarding(eligibility, pathname, searchParams.get('preview'));
  const ctaOpen = forceOpen && eligibility !== 'completed' && eligibility !== 'existing_user_prompt';
  const modalOpen = autoOpen || ctaOpen || (launchedFromCta && authState === 'loading');
  const modalPhase = launchedFromCta && authState === 'loading' ? 'loading' : 'ready';

  return (
    <>
      {children}
      <OnboardingModal open={modalOpen} phase={modalPhase} onCompleted={handleCompleted} />
    </>
  );
}
