'use client';

import { BettingAppShell } from '@/components/betting/BettingAppShell';

export default function BillingLayout({ children }: { children: React.ReactNode }) {
  return <BettingAppShell>{children}</BettingAppShell>;
}
