import type { ResearchHistoricalOverview } from '@/lib/pregame-matchup/research-overview';
import { MatchupResearchSections } from '@/components/matchup/MatchupResearchSections';

/** Historical overview for Matchup Research. Presentation only: it does not fetch. */
export function ResearchMatchupOverview({ overview }: { overview: ResearchHistoricalOverview }) {
  return (
    <section id="section-historical-overview" className="scroll-mt-matchup min-w-0 space-y-4" aria-labelledby="historical-overview-heading">
      <div className="max-w-3xl">
        <h2 id="historical-overview-heading" className="type-section-heading text-[#063f46]">
          Matchup Overview
        </h2>
        <p className="type-metadata mt-1 text-pretty">
          2025–26 regular-season team identity. Ratings in the matchup section use that same 2025–26 research season.
        </p>
      </div>
      <MatchupResearchSections
        awayAbbr={overview.awayAbbr}
        homeAbbr={overview.homeAbbr}
        history={overview.history}
        historyNote={overview.historyNote}
        insights={overview.insights}
        roster={overview.roster}
        contributors={overview.contributors}
      />
    </section>
  );
}
