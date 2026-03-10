'use client';

import { useState, useEffect } from 'react';
import { Header } from '@/components/betting';

export default function BettingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(true);

  useEffect(() => {
    setSelectedDate(new Date());
  }, []);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  return (
    <div className="min-h-screen bg-background gradient-mesh">
      <Header
        selectedDate={selectedDate ?? new Date()}
        onDateChange={setSelectedDate}
        isDarkMode={isDarkMode}
        onThemeToggle={() => setIsDarkMode(!isDarkMode)}
      />
      {children}
    </div>
  );
}
