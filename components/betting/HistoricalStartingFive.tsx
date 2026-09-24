'use client';

import Link from 'next/link';
import { PlayerHeadshot } from '@/components/nba/PlayerHeadshot';
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
      <h3 className="type-secondary mb-2">{heading}</h3>
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
              className="type-table-data flex min-w-0 items-center gap-2.5 text-[#063f46] hover:text-[#075B5C]"
            >
              <PlayerHeadshot
                nbaPlayerId={row.nbaPlayerId}
                name={row.playerName || 'Player'}
                className="relative h-11 w-9 rounded-lg overflow-hidden bg-[#E8F0F1] border border-[#DCE9EA] shrink-0"
              />
              <span className="truncate font-medium">{row.playerName || 'Player'}</span>
              {row.position ? (
                <span className="type-metadata shrink-0">
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
      <div className="bg-white rounded-2xl border border-[#DCE9EA] shadow-sm overflow-hidden">
        <div className="px-3 py-2 border-b border-[#DCE9EA] bg-[#F8FBFA]">
          <h2 id="starting-five-heading" className="type-section-heading text-[#063f46]">
            Starting Five
          </h2>
          <p className="type-secondary mt-0.5">
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
