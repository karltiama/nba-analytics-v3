'use client';

import { BettingAppShell } from '@/components/betting/BettingAppShell';

/**
 * Teams routes live outside /betting/* but are primary-nav destinations.
 * Reuse the betting shell so Header/nav do not disappear on /teams.
 */
export default function TeamsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <BettingAppShell>{children}</BettingAppShell>;
}
