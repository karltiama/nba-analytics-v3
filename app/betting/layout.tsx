'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { Header } from '@/components/betting';

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
    pathname.startsWith('/betting/research');

  return (
    <div className="min-h-screen bg-background gradient-mesh">
      {showLayoutHeader && (
        <Header
          isDarkMode={isDarkMode}
          onThemeToggle={() => setIsDarkMode(!isDarkMode)}
        />
      )}
      {children}
    </div>
  );
}
