'use client';

import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { LivePropsBoard, useLiveProps } from '@/components/betting/LivePropsBoard';
import type { LivePropsResponse } from '@/lib/betting/live-props-response';

type LiveState = { data: LivePropsResponse | null; error: boolean };

const LiveContext = createContext<LiveState | null>(null);

/**
 * One live-props poll for the whole matchup page (about once a minute while the tab is visible),
 * shared by the header score and the live board. When the game goes final, the page refreshes on the
 * server so it re-renders as the recap.
 */
export function LiveGameProvider({ gameId, children }: { gameId: string; children: ReactNode }) {
  const live = useLiveProps(gameId);
  const router = useRouter();
  const refreshed = useRef(false);
  const phase = live.data?.game?.phase ?? null;
  useEffect(() => {
    if (phase === 'final' && !refreshed.current) {
      refreshed.current = true;
      router.refresh();
    }
  }, [phase, router]);
  return <LiveContext.Provider value={live}>{children}</LiveContext.Provider>;
}

function useLive(): LiveState {
  return useContext(LiveContext) ?? { data: null, error: false };
}

/** Live score and clock between the teams; the server-rendered fallback ("@") until the game is live. */
export function LiveHeaderScore({ fallback }: { fallback: ReactNode }) {
  const game = useLive().data?.game;
  if (!game || game.phase !== 'live') return <>{fallback}</>;
  return (
    <span className="flex shrink-0 flex-col items-center px-1" data-live-score>
      <span className="text-xl font-bold tabular-nums text-[#063f46] sm:text-3xl">
        {game.visitor.score ?? '—'}
        <span className="px-1.5 text-[#9fb3b5] sm:px-2">–</span>
        {game.home.score ?? '—'}
      </span>
      <span className="type-badge mt-0.5 inline-flex items-center gap-1 text-[#dc2626]">
        <span className="h-1.5 w-1.5 rounded-full bg-[#dc2626]" aria-hidden />
        {game.clockLabel ?? 'Live'}
      </span>
    </span>
  );
}

/** The live props board, first in the main column while the game is live. */
export function LiveBoardSection({ expectLive }: { expectLive: boolean }) {
  const { data, error } = useLive();
  const live = data?.game?.phase === 'live';
  if (!live && !(expectLive && !data)) return null;
  return (
    <section
      id="section-live"
      className="min-w-0 pb-6"
      style={{ scrollMarginTop: 'var(--matchup-scroll-offset, 9rem)' }}
      aria-label="Live props"
      data-live-section
    >
      {live ? (
        <LivePropsBoard data={data} error={error} />
      ) : (
        <p className="type-secondary rounded-xl border border-[#DCE9EA] bg-[#F8FBFA] p-3">
          {error ? 'The live board is unavailable right now. The score on the scoreboard is still current.' : 'Loading the live board…'}
        </p>
      )}
    </section>
  );
}
