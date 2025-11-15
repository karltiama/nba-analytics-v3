import { getTeamInfo, getTeamStats } from '@/lib/teams/queries';
import { TeamHeader } from './components/TeamHeader';
import { SeasonStats } from './components/SeasonStats';
import { HomeAwaySplits } from './components/HomeAwaySplits';
import { RecentForm } from './components/RecentForm';
import { QuarterStrengths } from './components/QuarterStrengths';
import Link from 'next/link';

export default async function TeamPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;
  const [team, stats] = await Promise.all([
    getTeamInfo(teamId),
    getTeamStats(teamId),
  ]);

  if (!team) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-black p-8">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-2xl font-bold mb-4">Team not found</h1>
          <Link href="/games" className="text-blue-600 dark:text-blue-400 hover:underline">
            ← Back to Games
          </Link>
        </div>
      </div>
    );
  }

  const seasonStats = stats?.season_stats || {};
  const rankings = stats?.rankings || {};
  const splits = stats?.splits || {};
  const recentForm = stats?.recent_form || {};
  const quarterStrengths = stats?.quarter_strengths || {};

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <TeamHeader team={team} />
        <SeasonStats seasonStats={seasonStats} rankings={rankings} />
        <HomeAwaySplits splits={splits} />
        <RecentForm recentForm={recentForm} />
        <QuarterStrengths quarterStrengths={quarterStrengths} />

        {!stats && (
          <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
            <p className="text-zinc-600 dark:text-zinc-400">
              No statistics available yet for this team.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
