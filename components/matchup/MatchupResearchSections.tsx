import type { MatchupContributors } from '@/lib/pregame-matchup/membership';
import { presentMatchupOverview, type MatchupOverviewSource } from '@/lib/pregame-matchup/overview';
import { CompactComparison } from '@/components/matchup/CompactComparison';
import { ComparisonGrid } from '@/components/matchup/ComparisonGrid';
import { MatchupFindings } from '@/components/matchup/MatchupFindings';
import { MatchupStory } from '@/components/matchup/MatchupStory';
import { PersonnelSummary } from '@/components/matchup/PersonnelSummary';
import { PlayerContributors } from '@/components/matchup/PlayerContributors';
import { RosterContinuity } from '@/components/matchup/RosterContinuity';

type Props = MatchupOverviewSource & {
  contributors: MatchupContributors | null;
};

/** Shared overview stack for the scoreboard page and the betting research block. */
export function MatchupResearchSections({
  awayAbbr,
  homeAbbr,
  history,
  historyNote,
  insights,
  roster,
  contributors,
}: Props) {
  const overview = presentMatchupOverview({ awayAbbr, homeAbbr, history, historyNote, insights, roster });
  return (
    <div className="mx-auto grid w-full min-w-0 max-w-[65rem] grid-cols-1 gap-4">
      <div className="max-w-3xl">
        <MatchupStory story={overview.story} />
      </div>
      <MatchupFindings findings={overview.findings} />
      <CompactComparison awayAbbr={awayAbbr} homeAbbr={homeAbbr} comparison={overview.comparison} />
      <PersonnelSummary personnel={overview.personnel} />
      <ComparisonGrid
        awayAbbr={awayAbbr}
        homeAbbr={homeAbbr}
        available={history != null}
        label={history?.label ?? null}
        possessionNote={history?.possessionNote ?? null}
        rows={history?.rows ?? []}
        historyNote={historyNote}
      />
      <RosterContinuity roster={roster} />
      {contributors ? (
        <PlayerContributors awayAbbr={awayAbbr} homeAbbr={homeAbbr} contributors={contributors} />
      ) : null}
    </div>
  );
}
