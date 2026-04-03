'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { OnboardingModal } from './OnboardingModal';

type ProfileResponse = {
  profile?: {
    onboardingCompletedAt?: string | null;
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

export function OnboardingGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const fromWinningCtaRef = useRef<boolean | undefined>(undefined);
  if (fromWinningCtaRef.current === undefined) {
    fromWinningCtaRef.current = searchParams.get('onboard') === '1';
  }
  const launchedFromCta = fromWinningCtaRef.current === true;

  const [authState, setAuthState] = useState<AuthState>('loading');
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  const handleCompleted = useCallback(() => {
    setNeedsOnboarding(false);
  }, []);

  useEffect(() => {
    const ac = new AbortController();

    const stripOnboardFromUrl = () => {
      if (!launchedFromCta || typeof window === 'undefined') return;
      const params = new URLSearchParams(window.location.search);
      if (!params.has('onboard')) return;
      params.delete('onboard');
      const q = params.toString();
      const path = window.location.pathname;
      router.replace(q ? `${path}?${q}` : path);
    };

    (async () => {
      try {
        const res = await fetchProfileWithSessionWait(launchedFromCta, ac.signal);
        if (ac.signal.aborted) return;

        if (res.status === 401) {
          setAuthState('guest');
          setNeedsOnboarding(false);
          return;
        }

        if (!res.ok) {
          setAuthState('guest');
          setNeedsOnboarding(false);
          stripOnboardFromUrl();
          return;
        }

        const data = (await res.json()) as ProfileResponse;
        if (ac.signal.aborted) return;

        const completed = data.profile?.onboardingCompletedAt;
        setAuthState('authed');
        setNeedsOnboarding(completed == null);
        stripOnboardFromUrl();
      } catch (e) {
        if (ac.signal.aborted) return;
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setAuthState('guest');
        setNeedsOnboarding(false);
        stripOnboardFromUrl();
      }
    })();

    return () => ac.abort();
  }, [router, launchedFromCta]);

  const showLoadingShell = launchedFromCta && authState === 'loading';
  const showSignInShell = launchedFromCta && authState === 'guest';
  const modalOpen = showLoadingShell || showSignInShell || (authState === 'authed' && needsOnboarding);

  const modalPhase =
    showLoadingShell ? 'loading' : showSignInShell ? 'signin_required' : 'ready';

  return (
    <>
      {children}
      <OnboardingModal open={modalOpen} phase={modalPhase} onCompleted={handleCompleted} />
    </>
  );
}
