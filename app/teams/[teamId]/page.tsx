import { TeamPageContent } from './components/TeamPageContent';
import { TeamRoster } from './components/TeamRoster';

export default async function TeamPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;

  return (
    <TeamPageContent teamId={teamId} rosterSlot={<TeamRoster teamId={teamId} />} />
  );
}
