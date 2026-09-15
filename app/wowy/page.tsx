import { getAnalyticsSeason } from '@/lib/season';
import { WowyExplorer } from './WowyExplorer';

export const metadata = {
  title: 'Game-level WOWY · Court Context',
  description:
    'Compare how a player performed in games a teammate played versus games that teammate had a verified did-not-play roster row. Game-level participation, not shared-court possessions.',
};

export default async function WowyPage({
  searchParams,
}: {
  searchParams: Promise<{
    subject?: string;
    teammate?: string;
    season?: string;
    teamId?: string;
    seasonType?: string;
  }>;
}) {
  const params = await searchParams;
  return (
    <WowyExplorer
      initialSubjectId={params.subject ?? ''}
      initialTeammateId={params.teammate ?? ''}
      initialSeason={params.season ?? getAnalyticsSeason()}
      initialTeamId={params.teamId ?? ''}
      initialSeasonType={params.seasonType === 'playoffs' || params.seasonType === 'all' ? params.seasonType : 'regular'}
    />
  );
}
