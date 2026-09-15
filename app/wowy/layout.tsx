'use client';

import { BettingAppShell } from '@/components/betting/BettingAppShell';

export default function WowyLayout({ children }: { children: React.ReactNode }) {
  return <BettingAppShell>{children}</BettingAppShell>;
}
