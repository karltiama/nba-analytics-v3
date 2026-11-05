import type { MatchupContributors } from '@/lib/pregame-matchup/membership';
import { mergeSeasonRows, presentMatchupOverview, type MatchupOverviewSource } from '@/lib/pregame-matchup/overview';
import { CompactComparison } from '@/components/matchup/CompactComparison';
import { ComparisonGrid } from '@/components/matchup/ComparisonGrid';
import { MatchupFindings } from '@/components/matchup/MatchupFindings';
import { MatchupStory } from '@/components/matchup/MatchupStory';
import { PersonnelSummary } from '@/components/matchup/PersonnelSummary';
import { PlayerContributors } from '@/components/matchup/PlayerContributors';
import { RosterContinuity } from '@/components/matchup/RosterContinuity';

type Props = MatchupOverviewSource & {
  contributors: MatchupContributors | null;
  /** Shown in the comparison when this season has too few games. */
  currentNote?: string | null;
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
  current = null,
  currentNote = null,
}: Props) {
  const overview = presentMatchupOverview({ awayAbbr, homeAbbr, history, historyNote, insights, roster, current });
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
        available={history != null || current != null}
        label={history?.label ?? null}
        currentLabel={current?.label ?? null}
        seasonLabel={current?.seasonLabel ?? null}
        possessionNote={overview.comparison.possessionNote}
        rows={mergeSeasonRows(current, history?.rows)}
        historyNote={historyNote}
        currentNote={currentNote}
      />
      <RosterContinuity roster={roster} />
      {contributors ? (
        <PlayerContributors awayAbbr={awayAbbr} homeAbbr={homeAbbr} contributors={contributors} />
      ) : null}
    </div>
  );
}
