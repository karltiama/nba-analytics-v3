import type { ResearchHistoricalOverview } from '@/lib/pregame-matchup/research-overview';
import { ComparisonGrid } from '@/components/matchup/ComparisonGrid';
import { ContextSignals } from '@/components/matchup/ContextSignals';
import { PlayerContributors } from '@/components/matchup/PlayerContributors';
import { RosterContinuity } from '@/components/matchup/RosterContinuity';

/** Historical overview for Matchup Research. Presentation only: it does not fetch. */
export function ResearchMatchupOverview({ overview }: { overview: ResearchHistoricalOverview }) {
  const signals = overview.insights.length > 0;
  return (
    <section id="section-historical-overview" className="scroll-mt-[10rem] space-y-4" aria-labelledby="historical-overview-heading">
      <div>
        <h2 id="historical-overview-heading" className="type-section-heading text-[#063f46]">
          Matchup Overview
        </h2>
        <p className="type-metadata mt-1">
          2025–26 regular-season team identity. Ratings in the matchup section use the labeled research season.
        </p>
      </div>
      <div
        className={`grid grid-cols-1 items-start gap-4 ${
          signals ? 'xl:grid-cols-[minmax(0,1.9fr)_minmax(16rem,1fr)]' : ''
        }`}
      >
        <div className="min-w-0 max-w-3xl xl:max-w-none">
          <ComparisonGrid
            awayAbbr={overview.awayAbbr}
            homeAbbr={overview.homeAbbr}
            available={overview.history != null}
            label={overview.history?.label ?? null}
            possessionNote={overview.history?.possessionNote ?? null}
            rows={overview.history?.rows ?? []}
            historyNote={overview.historyNote}
          />
        </div>
        <ContextSignals insights={overview.insights} />
      </div>
      <RosterContinuity roster={overview.roster} />
      {overview.contributors ? (
        <PlayerContributors
          awayAbbr={overview.awayAbbr}
          homeAbbr={overview.homeAbbr}
          label={overview.contributors.label}
          away={overview.contributors.away}
          home={overview.contributors.home}
        />
      ) : null}
    </section>
  );
}
