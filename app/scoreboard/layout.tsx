'use client';

import { BettingAppShell } from '@/components/betting/BettingAppShell';

/** Scoreboard matchup lives outside /betting and keeps the same app header. */
export default function ScoreboardLayout({ children }: { children: React.ReactNode }) {
  return <BettingAppShell>{children}</BettingAppShell>;
}
