import type { PregameMatchupModel } from '@/lib/pregame-matchup/compose';
import type { MatchupNavLink } from '@/components/matchup/MatchupHeader';
import { MatchupHeader } from '@/components/matchup/MatchupHeader';
import { ComparisonGrid } from '@/components/matchup/ComparisonGrid';
import { ContextSignals } from '@/components/matchup/ContextSignals';
import { PlayerContributors } from '@/components/matchup/PlayerContributors';
import { RosterContinuity } from '@/components/matchup/RosterContinuity';
import Link from 'next/link';

function sectionLinks(model: PregameMatchupModel): MatchupNavLink[] {
  const links: MatchupNavLink[] = [
    { href: '#matchup-overview', label: 'Overview' },
    { href: '#section-comparison', label: 'Teams' },
    { href: '#section-roster', label: 'Roster' },
  ];
  if (model.insights.length > 0) links.splice(2, 0, { href: '#section-signals', label: 'Signals' });
  if (model.contributors) links.push({ href: '#section-contributors', label: 'Contributors' });
  return links;
}

export function PregameMatchupView({ model }: { model: PregameMatchupModel }) {
  return (
    <main className="mx-auto grid max-w-[1800px] grid-cols-1 gap-4 px-4 pb-8 pt-6 sm:px-6 lg:px-8">
      <MatchupHeader
        away={{ abbr: model.awayAbbr, name: model.awayName }}
        home={{ abbr: model.homeAbbr, name: model.homeName }}
        statusLabel={model.statusLabel}
        whenLabel={model.tipLabel}
        seasonLabel={model.seasonLabel}
        updatedLabel={model.updatedLabel}
        backHref={model.returnHref}
        backLabel="Today's Games"
        market={model.quote}
        links={sectionLinks(model)}
      />

      <div className="mx-auto grid w-full max-w-[65rem] grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1.9fr)_minmax(16rem,1fr)]">
        <div className="min-w-0 max-w-3xl xl:max-w-none">
          <ComparisonGrid
            awayAbbr={model.awayAbbr}
            homeAbbr={model.homeAbbr}
            available={model.history != null}
            label={model.history?.label ?? null}
            possessionNote={model.history?.possessionNote ?? null}
            rows={model.history?.rows ?? []}
            historyNote={model.historyNote}
          />
        </div>
        <ContextSignals insights={model.insights} />
      </div>

      <div className="mx-auto grid w-full max-w-[65rem] grid-cols-1 gap-4">
        <RosterContinuity roster={model.roster} />
        {model.contributors ? (
          <PlayerContributors
            awayAbbr={model.awayAbbr}
            homeAbbr={model.homeAbbr}
            label={model.contributors.label}
            away={model.contributors.away}
            home={model.contributors.home}
          />
        ) : null}
        {!model.quote && model.quoteNote ? (
          <section className="overflow-hidden rounded-2xl border border-[#DCE9EA] bg-white shadow-sm" aria-labelledby="sportsbook">
            <div className="border-b border-[#DCE9EA] bg-[#F8FBFA] px-3 py-2">
              <h2 id="sportsbook" className="type-section-heading text-[#063f46]">
                Sportsbook quote
              </h2>
            </div>
            <p className="type-secondary p-3">{model.quoteNote}</p>
          </section>
        ) : null}
      </div>
    </main>
  );
}

export function PregameMatchupMissing({ returnHref }: { returnHref: string }) {
  return (
    <main className="mx-auto max-w-[1800px] px-4 py-16 sm:px-6">
      <div className="max-w-3xl rounded-2xl border border-[#DCE9EA] bg-white p-8 shadow-sm">
        <h1 className="type-page-title text-[#063F46]">Game not found</h1>
        <p className="type-body mt-3 text-[#063F46]">That game is not on the scoreboard.</p>
        <Link href={returnHref} className="type-interactive mt-6 inline-block text-[#075B5C] hover:underline">
          Today&apos;s Games
        </Link>
      </div>
    </main>
  );
}
