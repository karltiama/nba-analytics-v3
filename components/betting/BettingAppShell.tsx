'use client';

import { Suspense, useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { Header } from '@/components/betting/Header';
import { OnboardingGate } from '@/components/betting/OnboardingGate';
import { GuidanceHost } from '@/components/onboarding/GuidanceHost';
import { shouldShowLayoutHeader } from '@/components/betting/betting-shell-paths';

/**
 * Shared chrome for betting primary destinations (incl. /teams).
 * Keeps Header/theme when navigating off /betting into the team directory.
 *
 * Header must stay outside the OnboardingGate Suspense boundary. Gate uses
 * useSearchParams(), which suspends during SSR; putting Radix menus in that
 * fallback vs resolved tree mismatches useId (hydration warning).
 */
export function BettingAppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '';
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [offseason, setOffseason] = useState(false);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/season-notice')
      .then((response) => (response.ok ? response.json() : null))
      .then((body: unknown) => {
        if (!cancelled && body && typeof body === 'object' && (body as { offseason?: unknown }).offseason === true) {
          setOffseason(true);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const showLayoutHeader = shouldShowLayoutHeader(pathname);

  return (
    <div className="min-h-screen bg-[#f7f9f7] text-[#063f46]">
      {offseason ? (
        <div className="border-b border-[#DCE9EA] bg-[#55ddb1]/20" data-season-notice="offseason">
          <div className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 py-2">
            <p className="text-xs sm:text-sm text-[#063f46]">
              NBA analytics is in offseason mode. Live props and scheduler-driven updates are paused while we improve
              the platform for next season. Historical data, backtests, and saved research remain available.
            </p>
          </div>
        </div>
      ) : null}
      {showLayoutHeader && (
        <Header
          isDarkMode={isDarkMode}
          onThemeToggle={() => setIsDarkMode(!isDarkMode)}
        />
      )}
      {children}
      <Suspense fallback={null}>
        <OnboardingGate />
        <GuidanceHost />
      </Suspense>
    </div>
  );
}
