import { getTeamInfo } from '@/lib/teams/queries';
import { TeamHeader } from './components/TeamHeader';
import { TeamSchedule } from './components/TeamSchedule';
import { TeamRoster } from './components/TeamRoster';
import { BBRefStats } from './components/BBRefStats';
import { BBRefSeasonStats } from './components/BBRefSeasonStats';
import Link from 'next/link';

export default async function TeamPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;
  const team = await getTeamInfo(teamId);

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

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <TeamHeader team={team} />
        <TeamSchedule teamId={teamId} />
        <TeamRoster teamId={teamId} />
        <BBRefSeasonStats teamId={teamId} teamAbbr={team.abbreviation} />
        <BBRefStats teamId={teamId} />
      </div>
    </div>
  );
}
