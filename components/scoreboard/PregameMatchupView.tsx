import type { PregameMatchupModel } from '@/lib/pregame-matchup/compose';
import { mergeSeasonRows, presentMatchupOverview } from '@/lib/pregame-matchup/overview';
import type { MatchupNavLink } from '@/components/matchup/MatchupHeader';
import { MatchupHeader } from '@/components/matchup/MatchupHeader';
import { MatchupContextStrip, RAIL_CARD, RAIL_HEADER } from '@/components/matchup/MatchupContextStrip';
import { MatchupQuickStats } from '@/components/matchup/MatchupQuickStats';
import { MatchupStory } from '@/components/matchup/MatchupStory';
import { MatchupFindings } from '@/components/matchup/MatchupFindings';
import { ComparisonGrid } from '@/components/matchup/ComparisonGrid';
import { RosterContinuity } from '@/components/matchup/RosterContinuity';
import { PlayerContributors, type SideInjuries } from '@/components/matchup/PlayerContributors';
import { InjuryReport } from '@/components/matchup/InjuryReport';
import { LikelyStarters } from '@/components/matchup/LikelyStarters';
import { MarketMovement } from '@/components/matchup/MarketMovement';
import { GameRecap } from '@/components/matchup/GameRecap';
import { gamePropsHref } from '@/lib/pregame-matchup/href';
import Link from 'next/link';

/**
 * The roster section only repeats the Players note when continuity is unavailable.
 * membership.ts sets that note from roster.note, so one copy is enough.
 */
function showRosterSection(model: PregameMatchupModel): boolean {
  if (model.roster.status === 'shown') return true;
  const players = model.contributors;
  return !(players && players.membership !== 'shown' && players.unavailableNote === model.roster.note);
}

function sectionLinks(model: PregameMatchupModel, roster: boolean): MatchupNavLink[] {
  const links: MatchupNavLink[] = [
    ...(model.recap ? [{ href: '#section-recap', label: 'Recap' }] : []),
    ...(model.context ? [{ href: '#section-tonight', label: 'Tonight' }] : []),
    { href: '#section-story', label: 'Overview' },
  ];
  if (model.insights.length > 0) links.push({ href: '#section-signals', label: 'Findings' });
  if (model.starters) links.push({ href: '#section-starters', label: 'Starters' });
  if (model.injuryReport) links.push({ href: '#section-injuries', label: 'Injuries' });
  links.push({ href: '#section-comparison', label: 'Teams' });
  if (model.contributors) links.push({ href: '#section-contributors', label: 'Players' });
  if (roster) links.push({ href: '#section-roster', label: 'Roster' });
  links.push({ href: gamePropsHref(model.gameId), label: 'Props' });
  return links;
}

function sideInjuries(model: PregameMatchupModel, abbr: string): SideInjuries | undefined {
  const injuries = model.context?.injuries;
  if (!injuries || injuries.status === 'unavailable') return undefined;
  return injuries.teams?.find((team) => team.abbr === abbr)?.players;
}

export function PregameMatchupView({ model }: { model: PregameMatchupModel }) {
  const overview = presentMatchupOverview({
    awayAbbr: model.awayAbbr,
    homeAbbr: model.homeAbbr,
    history: model.history,
    historyNote: model.historyNote,
    insights: model.insights,
    roster: model.roster,
    current: model.current,
    currentStory: model.currentStory ?? null,
    injuryNotes: (model.injuryReport?.teams ?? []).flatMap((team) => (team.sampleNote ? [team.sampleNote] : [])),
  });
  const roster = showRosterSection(model);
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
        propsHref={gamePropsHref(model.gameId)}
        links={sectionLinks(model, roster)}
      />

      <div className="mx-auto grid w-full min-w-0 max-w-[90rem] grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start xl:grid-cols-[minmax(0,1fr)_23rem]">
        {/* First in source so phones get the quick reference under the header. */}
        <aside
          className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:sticky lg:top-[var(--matchup-scroll-offset,9rem)] lg:order-2 lg:max-h-[calc(100vh-var(--matchup-scroll-offset,9rem)-1rem)] lg:grid-cols-1 lg:overflow-y-auto"
          aria-label="Quick reference"
          data-matchup-rail
        >
          {model.context ? (
            <MatchupContextStrip context={model.context} moreHref={model.injuryReport ? '#section-injuries' : null} />
          ) : null}
          {model.quote ? <MarketMovement quote={model.quote} homeAbbr={model.homeAbbr} /> : null}
          <MatchupQuickStats awayAbbr={model.awayAbbr} homeAbbr={model.homeAbbr} comparison={overview.comparison} />
          {!model.quote && model.quoteNote ? (
            <section className={RAIL_CARD} aria-labelledby="sportsbook">
              <div className={RAIL_HEADER}>
                <h2 id="sportsbook" className="type-section-heading text-[#063f46]">
                  Sportsbook quote
                </h2>
              </div>
              <p className="type-secondary p-3">{model.quoteNote}</p>
            </section>
          ) : null}
        </aside>

        <div
          className="min-w-0 rounded-2xl border border-[#DCE9EA] bg-white p-4 shadow-sm sm:p-6 lg:order-1"
          data-matchup-main
        >
          {model.recap ? <GameRecap recap={model.recap} flow /> : null}
          <MatchupStory story={overview.story} flow />
          <MatchupFindings findings={overview.findings} flow />
          {model.starters ? <LikelyStarters starters={model.starters} flow /> : null}
          {model.injuryReport ? <InjuryReport report={model.injuryReport} flow /> : null}
          <ComparisonGrid
            flow
            awayAbbr={model.awayAbbr}
            homeAbbr={model.homeAbbr}
            available={model.history != null || model.current != null}
            label={model.history?.label ?? null}
            currentLabel={model.current?.label ?? null}
            seasonLabel={model.current?.seasonLabel ?? null}
            possessionNote={overview.comparison.possessionNote}
            rows={mergeSeasonRows(model.current, model.history?.rows)}
            historyNote={model.historyNote}
            currentNote={model.currentNote}
          />
          {model.contributors ? (
            <PlayerContributors
              flow
              awayAbbr={model.awayAbbr}
              homeAbbr={model.homeAbbr}
              contributors={model.contributors}
              current={model.currentPlayers ?? null}
              awayInjuries={sideInjuries(model, model.awayAbbr)}
              homeInjuries={sideInjuries(model, model.homeAbbr)}
            />
          ) : null}
          {roster ? <RosterContinuity roster={model.roster} flow /> : null}
        </div>
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
