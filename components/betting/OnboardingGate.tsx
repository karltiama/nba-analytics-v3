'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  resolveEligibility,
  shouldRouteToWelcome,
  welcomeHref,
  type OnboardingEligibility,
} from '@/lib/onboarding/contract';
import { patchOnboardingState, readOnboardingState } from '@/lib/onboarding/storage';

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

function currentPathWithoutOnboard(): string {
  if (typeof window === 'undefined') return '/dashboard';
  const params = new URLSearchParams(window.location.search);
  params.delete('onboard');
  const q = params.toString();
  return q ? `${window.location.pathname}?${q}` : window.location.pathname;
}

function stripOnboardParam(router: ReturnType<typeof useRouter>) {
  if (typeof window === 'undefined') return;
  if (!new URLSearchParams(window.location.search).has('onboard')) return;
  router.replace(currentPathWithoutOnboard());
}

/**
 * First-run routing. Signed-in users who have not finished setup are sent to the
 * /welcome page once (E9 modal retired). Guests are never interrupted.
 */
export function OnboardingGate({ children }: { children?: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() || '/dashboard';
  const searchParams = useSearchParams();

  const fromCtaRef = useRef<boolean | undefined>(undefined);
  if (fromCtaRef.current === undefined) {
    fromCtaRef.current = searchParams.get('onboard') === '1';
  }
  const launchedFromCta = fromCtaRef.current === true;

  const [authState, setAuthState] = useState<AuthState>('loading');
  const [eligibility, setEligibility] = useState<OnboardingEligibility>('not_eligible');

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
        if (next === 'existing_user_prompt') {
          patchOnboardingState({ existingPromptEligible: true });
        }
        if (!shouldRouteToWelcome(next, window.location.pathname, searchParams.get('preview'), launchedFromCta)) {
          stripOnboardParam(router);
        }
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
    // searchParams is read once at mount; re-running on every query change would refetch the profile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, launchedFromCta]);

  const routeToWelcome =
    authState === 'authed' &&
    shouldRouteToWelcome(eligibility, pathname, searchParams.get('preview'), launchedFromCta);

  useEffect(() => {
    if (!routeToWelcome) return;
    router.replace(welcomeHref({ next: currentPathWithoutOnboard() }));
  }, [routeToWelcome, router]);

  return <>{children}</>;
}
