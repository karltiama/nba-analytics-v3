import Link from 'next/link';
import { cn } from '@/lib/utils';
import type { TeamPageSeasonChoice } from '@/lib/teams/team-page-season';
import { teamPageSeasonHref } from '@/lib/teams/team-page-season';

type TeamSeasonSwitcherProps = {
  teamId: string;
  currentSeason: string;
  defaultSeason: string;
  choices: TeamPageSeasonChoice[];
  className?: string;
};

/** Compact season chips — navigates via ?season= without changing Production pin. */
export function TeamSeasonSwitcher({
  teamId,
  currentSeason,
  defaultSeason,
  choices,
  className,
}: TeamSeasonSwitcherProps) {
  return (
    <div
      className={cn('inline-flex items-center gap-1', className)}
      role="group"
      aria-label="Season"
    >
      {choices.map((c) => {
        const active = c.season === currentSeason;
        return (
          <Link
            key={c.season}
            href={teamPageSeasonHref({
              teamId,
              season: c.season,
              defaultSeason,
            })}
            scroll={false}
            className={cn(
              'text-[10px] px-2 py-0.5 rounded-full font-semibold transition-colors',
              active
                ? 'bg-[#063f46] text-white'
                : 'bg-[#f7f9f7] border border-[#DCE9EA] text-[#4a6366] hover:text-[#063f46] hover:bg-white'
            )}
            aria-current={active ? 'page' : undefined}
          >
            {c.seasonLabel}
          </Link>
        );
      })}
    </div>
  );
}
