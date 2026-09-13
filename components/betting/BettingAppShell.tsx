'use client';

import { Suspense, useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { Header } from '@/components/betting/Header';
import { OnboardingGate } from '@/components/betting/OnboardingGate';
import { shouldShowLayoutHeader } from '@/components/betting/betting-shell-paths';

/**
 * Shared chrome for betting primary destinations (incl. /teams).
 * Keeps Header/theme when navigating off /betting into the team directory.
 */
export function BettingAppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '';
  const [isDarkMode, setIsDarkMode] = useState(true);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  const showLayoutHeader = shouldShowLayoutHeader(pathname);

  const renderShell = () => (
    <div className="min-h-screen bg-[#f7f9f7] text-[#063f46]">
      <div className="border-b border-[#DCE9EA] bg-[#55ddb1]/20">
        <div className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 py-2">
          <p className="text-xs sm:text-sm text-[#063f46]">
            NBA analytics is in offseason mode. Live props and scheduler-driven updates are paused while we improve
            the platform for next season. Historical data, backtests, and saved research remain available.
          </p>
        </div>
      </div>
      {showLayoutHeader && (
        <Header
          isDarkMode={isDarkMode}
          onThemeToggle={() => setIsDarkMode(!isDarkMode)}
        />
      )}
      {children}
    </div>
  );

  return (
    <Suspense fallback={renderShell()}>
      <OnboardingGate>{renderShell()}</OnboardingGate>
    </Suspense>
  );
}
