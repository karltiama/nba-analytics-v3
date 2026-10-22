import type { PregameMatchupModel } from '@/lib/pregame-matchup/compose';
import type { MatchupNavLink } from '@/components/matchup/MatchupHeader';
import { MatchupHeader } from '@/components/matchup/MatchupHeader';
import { MatchupResearchSections } from '@/components/matchup/MatchupResearchSections';
import Link from 'next/link';

function sectionLinks(model: PregameMatchupModel): MatchupNavLink[] {
  const links: MatchupNavLink[] = [
    { href: '#section-story', label: 'Overview' },
    { href: '#section-comparison', label: 'Teams' },
    { href: '#section-roster', label: 'Roster' },
  ];
  if (model.insights.length > 0) links.splice(1, 0, { href: '#section-signals', label: 'Findings' });
  if (model.contributors) links.push({ href: '#section-contributors', label: 'Players' });
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

      <MatchupResearchSections
        awayAbbr={model.awayAbbr}
        homeAbbr={model.homeAbbr}
        history={model.history}
        historyNote={model.historyNote}
        insights={model.insights}
        roster={model.roster}
        contributors={model.contributors}
      />

      {!model.quote && model.quoteNote ? (
        <section className="mx-auto w-full max-w-[65rem] overflow-hidden rounded-2xl border border-[#DCE9EA] bg-white shadow-sm" aria-labelledby="sportsbook">
          <div className="border-b border-[#DCE9EA] bg-[#F8FBFA] px-3 py-2">
            <h2 id="sportsbook" className="type-section-heading text-[#063f46]">
              Sportsbook quote
            </h2>
          </div>
          <p className="type-secondary p-3">{model.quoteNote}</p>
        </section>
      ) : null}
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
