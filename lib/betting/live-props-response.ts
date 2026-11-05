import type { LivePropRow } from '@/lib/betting/live-props';

type LiveTeam = { teamId: string; abbr: string | null; score: number | null };

/** GET /api/betting/games/[gameId]/live-props. `game` is null when the scoreboard has no row for it. */
export type LivePropsResponse = {
  game: {
    gameId: string;
    /** Game phase from the live scoreboard. The board shows only while 'live'. */
    phase: 'pregame' | 'live' | 'final' | 'other';
    /** "Q3 3:28", "OT", or null (halftime and unknown clocks). */
    clockLabel: string | null;
    period: number | null;
    home: LiveTeam;
    visitor: LiveTeam;
    /** When the live box score was last read. */
    boxObservedAt: string | null;
    observedAt: string | null;
  } | null;
  rows: LivePropRow[];
};
