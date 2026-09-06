import Link from 'next/link';
import { TeamPageClient } from './components/TeamPageContent';
import { TeamRoster } from './components/TeamRoster';
import {
  resolveAnalyticsTeamId,
  getTeamById,
  getTeamSeasonAverages,
  getTeamRecentGames,
  getTeamTrendData,
} from '@/lib/teams/analytics-queries';
import { getTeamCompactSchedule } from '@/lib/teams/team-compact-schedule-queries';
import { getTeamSeasonSnapshot } from '@/lib/teams/team-season-snapshot-queries';
import { getTeamRosterContinuity } from '@/lib/teams/team-roster-continuity-queries';
import { getRosterChangeStory } from '@/lib/teams/roster-change-story-queries';
import { emptyRosterChangeStory } from '@/lib/teams/roster-change-story';
import {
  getPreviousSeasonBaseline,
  emptyPreviousSeasonBaseline,
} from '@/lib/teams/team-previous-season-baseline-queries';
import {
  listTeamPageSeasonChoices,
  resolveTeamPageSeason,
} from '@/lib/teams/team-page-season';
import { getAnalyticsSeason } from '@/lib/season';
import { emptyTeamSeasonSnapshot } from '@/lib/teams/team-season-snapshot';
import { computeRosterContinuity, previousAnalyticsSeason } from '@/lib/teams/team-roster-continuity';

async function loadTeamData(teamId: string, selectedSeason: string | null) {
  const analyticsTeamId = await resolveAnalyticsTeamId(teamId);
  const { season, seasonLabel } = resolveTeamPageSeason({
    selectedSeason,
  });
  const defaultSeason = getAnalyticsSeason();
  const seasonChoices = listTeamPageSeasonChoices();

  if (!analyticsTeamId) {
    const prev = previousAnalyticsSeason(season);
    const rosterContinuity = computeRosterContinuity({
      season,
      previousSeason: prev,
      current: [],
      previous: [],
      previousSeasonAvailable: false,
    });
    return {
      team: null,
      seasonAverages: null,
      recentGames: [] as Awaited<ReturnType<typeof getTeamRecentGames>>,
      trendData: [] as Awaited<ReturnType<typeof getTeamTrendData>>,
      compactSchedule: {
        season,
        upcoming: [],
        recent: [],
      } as Awaited<ReturnType<typeof getTeamCompactSchedule>>,
      seasonSnapshot: emptyTeamSeasonSnapshot(season),
      rosterContinuity,
      rosterChangeStory: emptyRosterChangeStory(rosterContinuity),
      previousBaseline: emptyPreviousSeasonBaseline(season),
      season,
      seasonLabel,
      defaultSeason,
      seasonChoices,
    };
  }

  // One page → one season: pass explicitly (never omit → latest-row fallback).
  const [
    team,
    seasonAverages,
    recentGames,
    trendData,
    compactSchedule,
    seasonSnapshot,
    rosterContinuity,
    previousBaseline,
  ] = await Promise.all([
    getTeamById(analyticsTeamId),
    getTeamSeasonAverages(analyticsTeamId, season),
    getTeamRecentGames(analyticsTeamId, 82, season),
    getTeamTrendData(analyticsTeamId, 82, season),
    getTeamCompactSchedule(analyticsTeamId, season),
    getTeamSeasonSnapshot(analyticsTeamId, season),
    getTeamRosterContinuity(analyticsTeamId, season),
    getPreviousSeasonBaseline(analyticsTeamId, season),
  ]);

  const rosterChangeStory = await getRosterChangeStory(
    analyticsTeamId,
    rosterContinuity
  );

  return {
    team,
    seasonAverages,
    recentGames,
    trendData,
    compactSchedule,
    seasonSnapshot,
    rosterContinuity,
    rosterChangeStory,
    previousBaseline,
    season,
    seasonLabel,
    defaultSeason,
    seasonChoices,
  };
}

export default async function TeamPage({
  params,
  searchParams,
}: {
  params: Promise<{ teamId: string }>;
  searchParams: Promise<{ season?: string }>;
}) {
  const { teamId } = await params;
  const { season: seasonParam } = await searchParams;
  const {
    team,
    seasonAverages,
    recentGames,
    trendData,
    compactSchedule,
    seasonSnapshot,
    rosterContinuity,
    rosterChangeStory,
    previousBaseline,
    season,
    seasonLabel,
    defaultSeason,
    seasonChoices,
  } = await loadTeamData(teamId, seasonParam ?? null);

  if (!team) {
    return (
      <div className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-12">
        <div className="glass-card rounded-xl border-l-4 border-l-[#ff4757] p-8 text-center">
          <h1 className="text-2xl font-bold text-white mb-3">Team not found</h1>
          <p className="text-muted-foreground mb-4">
            The requested team could not be located in the analytics database.
          </p>
          <Link href="/teams" className="text-[#00d4ff] hover:underline text-sm">
            &larr; Back to Teams
          </Link>
        </div>
      </div>
    );
  }

  return (
    <main className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-12">
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_20rem] gap-6">
        <TeamPageClient
          team={team}
          season={season}
          seasonLabel={seasonLabel}
          seasonAverages={seasonAverages}
          recentGames={recentGames}
          trendData={trendData}
          upcomingGames={compactSchedule.upcoming}
          recentScheduleGames={compactSchedule.recent}
          seasonSnapshot={seasonSnapshot}
          rosterContinuity={rosterContinuity}
          rosterChangeStory={rosterChangeStory}
          previousBaseline={previousBaseline}
          seasonChoices={seasonChoices}
          defaultSeason={defaultSeason}
          routeTeamId={teamId}
          roster={<TeamRoster teamId={team.team_id} season={season} />}
        />
      </div>
    </main>
  );
}
