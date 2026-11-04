/** Client-safe types and display helpers for the Props Explorer "Teammates out" section. */
import type { WowySupportTier } from '@/lib/wowy/types';

export const INJURY_REPORT_UNAVAILABLE = 'Injury report unavailable';

export type TeammateOutStatus = 'Out' | 'Doubtful' | 'Q';

export type SplitStats = { minutes: number | null; pts: number | null; reb: number | null; ast: number | null; tpm: number | null };

export type TeammateOutSplit = {
  season: string;
  tier: WowySupportTier;
  withGames: number;
  withoutGames: number;
  with: SplitStats;
  without: SplitStats;
};

export type TeammateOut = {
  playerId: string;
  name: string;
  status: TeammateOutStatus;
  avgMinutes: number;
  split: TeammateOutSplit | null;
  wowyHref: string;
};

export type TeammatesOutResponse =
  | { status: 'unavailable'; reason: string }
  | {
      status: 'ok';
      teamId: string;
      teamAbbr: string | null;
      asOfLabel: string | null;
      /** Sum of usual minutes for teammates listed Out or Doubtful. */
      minutesFreed: number;
      teammates: TeammateOut[];
    };

/** The split value for the sidebar's active stat tab (PRA is the sum, threes are made threes). */
export function splitMetricValue(stats: SplitStats, metric: 'pts' | 'reb' | 'ast' | '3pm' | 'pra'): number | null {
  if (metric === '3pm') return stats.tpm;
  if (metric !== 'pra') return stats[metric];
  if (stats.pts == null || stats.reb == null || stats.ast == null) return null;
  return stats.pts + stats.reb + stats.ast;
}

/** "2025-26" from the analytics start year. */
export function seasonLabel(season: string): string {
  const y = Number(season);
  return Number.isFinite(y) ? `${y}-${String((y + 1) % 100).padStart(2, '0')}` : season;
}
