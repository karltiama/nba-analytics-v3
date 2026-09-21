import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { PlayerHeadshot } from '@/components/nba/PlayerHeadshot';
import { PreviewCard, PreviewSectionHeading } from './PreviewCard';
import type { PreviewPlayerToWatch } from '@/lib/teams/preseason-preview/types';

function playerHref(nbaPlayerId?: string | null) {
  if (!nbaPlayerId) return null;
  return `/betting/players/${encodeURIComponent(nbaPlayerId)}`;
}

export function PlayersToWatchSection({
  players,
}: {
  players: PreviewPlayerToWatch[];
}) {
  if (players.length === 0) return null;

  return (
    <PreviewCard id="players" className="scroll-mt-24">
      <PreviewSectionHeading
        title="Players to Watch"
        subtitle="Why each player matters entering preseason"
      />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {players.map((p) => {
          const href = playerHref(p.nbaPlayerId);
          return (
            <article
              key={p.name}
              className="rounded-xl border border-[#DCE9EA] bg-[#F8FBFA] p-4 flex flex-col"
            >
              <div className="flex gap-3">
                <PlayerHeadshot
                  nbaPlayerId={p.nbaPlayerId}
                  name={p.name}
                  className="relative w-14 h-[4.25rem] rounded-xl overflow-hidden bg-[#E8F0F1] border border-[#DCE9EA] shrink-0"
                />
                <div className="min-w-0">
                  {p.jerseyNumber ? (
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-[#8aa0a3]">
                      #{p.jerseyNumber}
                    </p>
                  ) : null}
                  <h3 className="text-base font-bold text-[#063f46] leading-tight">
                    {p.name}
                  </h3>
                  <p className="text-xs text-[#4a6366] mt-0.5">
                    {p.meta ?? p.position ?? null}
                  </p>
                </div>
              </div>

              <p className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-[#075B5C]">
                What we&apos;re watching
              </p>
              <p className="mt-1 text-sm leading-relaxed text-[#4a6366] flex-1">
                {p.watching}
              </p>

              {href ? (
                <Link
                  href={href}
                  className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-[#075B5C] hover:text-[#063f46] transition-colors"
                >
                  View Player
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              ) : null}
            </article>
          );
        })}
      </div>
    </PreviewCard>
  );
}
