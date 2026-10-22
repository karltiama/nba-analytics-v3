import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { TeamLogo } from '@/components/nba/TeamLogo';
import { MatchupScrollOffset } from '@/components/matchup/MatchupScrollOffset';

export type MatchupHeaderSide = {
  abbr: string;
  name: string;
};

export type MatchupHeaderMarket = {
  caption: string | null;
  spreadAway: string;
  spreadHome: string;
  total: string;
  totalPrices: string;
  moneylineAway: string;
  moneylineHome: string;
  implied: string | null;
};

export type MatchupNavLink = {
  href: string;
  label: string;
};

export type MatchupHeaderProps = {
  away: MatchupHeaderSide;
  home: MatchupHeaderSide;
  statusLabel: string;
  whenLabel: string;
  seasonLabel?: string | null;
  updatedLabel?: string | null;
  backHref: string;
  backLabel: string;
  market?: MatchupHeaderMarket | null;
  links?: MatchupNavLink[];
};

function TeamSide({ team }: { team: MatchupHeaderSide }) {
  return (
    <div className="flex min-w-0 items-center gap-2 sm:gap-3">
      <TeamLogo team={team.abbr} size="md" decorative />
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-[#063f46] sm:text-lg">{team.abbr}</span>
        <span className="block truncate text-base font-bold leading-tight text-[#063f46] sm:text-xl">{team.name}</span>
      </span>
    </div>
  );
}

function MarketCell({ label, primary, secondary }: { label: string; primary: string; secondary?: string }) {
  return (
    <div className="min-w-0 bg-white px-2 py-2 text-center sm:px-3 sm:py-3">
      <div className="type-secondary mb-1">{label}</div>
      <div className="type-card-data break-words text-[#063f46]">{primary}</div>
      {secondary ? <div className="type-secondary mt-0.5 break-words">{secondary}</div> : null}
    </div>
  );
}

/** Presentational sticky header. No data fetching and no scroll-spy. */
export function MatchupHeader({
  away,
  home,
  statusLabel,
  whenLabel,
  seasonLabel,
  updatedLabel,
  backHref,
  backLabel,
  market,
  links = [],
}: MatchupHeaderProps) {
  const sourceLine = [market?.caption, updatedLabel].filter((part) => part && part.trim()).join(' · ');
  return (
    <div id="matchup-overview" className="sticky top-16 z-10 scroll-mt-16 overflow-hidden rounded-2xl border border-[#DCE9EA] bg-white/95 shadow-sm">
      <MatchupScrollOffset />
      <div className="flex min-w-0 flex-col gap-3 bg-[#F8FBFA] px-3 py-3 sm:flex-row sm:items-center sm:gap-6 sm:px-5 sm:py-4">
        <div className="flex min-w-0 shrink-0 items-center gap-2 sm:w-64 lg:w-80">
          <Link
            href={backHref}
            className="shrink-0 rounded-lg p-1.5 text-[#4a6366] transition-colors hover:bg-[#f7f9f7] hover:text-[#075B5C]"
            aria-label={backLabel}
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex min-w-0 items-center gap-2">
            <span className="type-secondary truncate">{whenLabel}</span>
            {statusLabel ? (
              <span className="type-badge shrink-0 whitespace-nowrap rounded-full border border-[#DCE9EA] bg-white px-2 py-0.5">
                {statusLabel}
              </span>
            ) : null}
            {seasonLabel ? (
              <span className="type-badge hidden shrink-0 whitespace-nowrap rounded-full border border-[#DCE9EA] bg-white px-2 py-0.5 md:inline-flex">
                {seasonLabel}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
          <TeamSide team={away} />
          <span className="type-secondary shrink-0 px-1">@</span>
          <TeamSide team={home} />
        </div>
      </div>

      {market ? (
        <div className="bg-[#F8FBFA] px-3 pb-3 sm:px-5" data-market-strip>
          {sourceLine ? <p className="type-metadata mb-2 text-center">{sourceLine}</p> : null}
          <div className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-[#DCE9EA] bg-[#DCE9EA] sm:grid-cols-3">
            <MarketCell label="Market spread" primary={market.spreadAway} secondary={market.spreadHome} />
            <MarketCell label="Market total" primary={market.total} secondary={market.totalPrices} />
            <MarketCell label="Market ML" primary={market.moneylineAway} secondary={market.moneylineHome} />
          </div>
          {market.implied ? <p className="type-secondary mt-2 text-center">{market.implied}</p> : null}
        </div>
      ) : null}

      {!market && updatedLabel ? <p className="type-metadata bg-[#F8FBFA] px-3 pb-2 text-center sm:px-5">{updatedLabel}</p> : null}

      {links.length > 0 ? (
        <nav className="flex flex-wrap items-center justify-center gap-1.5 border-t border-[#DCE9EA] bg-[#F8FBFA] px-3 py-2 sm:px-5" aria-label="Matchup sections">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="type-interactive rounded-lg border border-[#DCE9EA] bg-[#F8FBFA] px-3 py-1.5 text-[#4a6366] hover:bg-[#f7f9f7] hover:text-[#063f46]"
            >
              {link.label}
            </a>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
