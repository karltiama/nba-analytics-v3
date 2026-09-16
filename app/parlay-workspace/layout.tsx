'use client';

import { BettingAppShell } from '@/components/betting/BettingAppShell';

export default function ParlayWorkspaceLayout({ children }: { children: React.ReactNode }) {
  return <BettingAppShell>{children}</BettingAppShell>;
}
