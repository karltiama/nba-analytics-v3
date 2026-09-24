'use client';

import { BettingAppShell } from '@/components/betting/BettingAppShell';

/**
 * Dashboard lives at /dashboard. Reuse the app shell so Header/nav stay visible.
 */
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <BettingAppShell>{children}</BettingAppShell>;
}
