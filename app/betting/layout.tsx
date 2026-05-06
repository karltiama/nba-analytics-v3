'use client';

import { Suspense, useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { Header, OnboardingGate } from '@/components/betting';

export default function BettingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [isDarkMode, setIsDarkMode] = useState(true);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  // Only show layout Header on dashboard and game page; player page renders its own (avoids double header)
  const showLayoutHeader =
    pathname === '/betting' ||
    pathname.startsWith('/betting/games/') ||
    pathname.startsWith('/betting/props-explorer') ||
    pathname.startsWith('/betting/bet-slip-analyzer') ||
    pathname.startsWith('/betting/research') ||
    pathname.startsWith('/betting/paper') ||
    pathname.startsWith('/betting/profile');

  const renderShell = () => (
    <div className="min-h-screen bg-background gradient-mesh">
      <div className="border-b border-[#00d4ff]/20 bg-[#00d4ff]/10">
        <div className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 py-2">
          <p className="text-xs sm:text-sm text-[#bfefff]">
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
