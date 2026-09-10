'use client';

import Link from 'next/link';
import { playerResearchHref } from '@/lib/betting/research-journey';
import { shouldShowStartingFive } from '@/lib/betting/historical-starters';
import type { HistoricalStarterPlayer, HistoricalStarters } from '@/lib/betting/historical-starters';

function StarterList({
  heading,
  teamName,
  rows,
  gameId,
  date,
  season,
}: {
  heading: string;
  teamName: string;
  rows: HistoricalStarterPlayer[];
  gameId: string;
  date?: string;
  season?: string;
}) {
  return (
    <div className="min-w-0">
      <h3 className="text-xs font-semibold text-white tracking-wide mb-2">{heading}</h3>
      <p className="sr-only">{teamName} historical starting five</p>
      <ol className="space-y-1.5">
        {rows.map((row) => (
          <li key={`${row.teamId}-${row.playerId}`} className="min-w-0">
            <Link
              href={playerResearchHref({
                playerId: row.playerId,
                gameId,
                date,
                season,
              })}
              className="flex items-baseline gap-2 min-w-0 text-sm text-white hover:text-[#00d4ff]"
            >
              <span className="truncate font-medium">{row.playerName || 'Player'}</span>
              {row.position ? (
                <span className="shrink-0 text-[11px] text-muted-foreground font-medium">
                  {row.position}
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function HistoricalStartingFive({
  awayName,
  awayAbbr,
  homeName,
  homeAbbr,
  starters,
  gameId,
  date,
  season,
}: {
  awayName: string;
  awayAbbr: string;
  homeName: string;
  homeAbbr: string;
  starters: HistoricalStarters;
  gameId: string;
  date?: string;
  season?: string;
}) {
  if (!shouldShowStartingFive(starters)) return null;

  return (
    <section
      id="section-starters"
      className="scroll-mt-[10rem]"
      aria-labelledby="starting-five-heading"
    >
      <div className="glass-card rounded-xl border border-white/5 overflow-hidden">
        <div className="px-3 py-2 border-b border-white/5 bg-white/[0.02]">
          <h2 id="starting-five-heading" className="text-sm font-semibold text-white">
            Starting Five
          </h2>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Historical designated starters for this game. Not projected, and not a full roster.
          </p>
        </div>
        <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <StarterList
            heading={awayAbbr}
            teamName={awayName}
            rows={starters.away}
            gameId={gameId}
            date={date}
            season={season}
          />
          <StarterList
            heading={homeAbbr}
            teamName={homeName}
            rows={starters.home}
            gameId={gameId}
            date={date}
            season={season}
          />
        </div>
      </div>
    </section>
  );
}
