import { getAnalyticsSeason } from '@/lib/season';
import { countFinalGames } from '@/lib/wowy/queries';
import { chooseWowyDefaultSeason, resolveWowySeason, wowySeasonOptions } from '@/lib/wowy/season-default';
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
  const currentSeason = getAnalyticsSeason();
  // A failed count only changes the default season; the page still renders.
  const currentSeasonFinalGames = await countFinalGames(currentSeason).catch(() => 0);
  const seasons = wowySeasonOptions(currentSeason);
  const defaultSeason = chooseWowyDefaultSeason(currentSeason, currentSeasonFinalGames);
  return (
    <WowyExplorer
      initialSubjectId={params.subject ?? ''}
      initialTeammateId={params.teammate ?? ''}
      initialSeason={resolveWowySeason(params.season, seasons, defaultSeason)}
      seasons={seasons}
      currentSeason={currentSeason}
      currentSeasonFinalGames={currentSeasonFinalGames}
      initialTeamId={params.teamId ?? ''}
      initialSeasonType={params.seasonType === 'playoffs' || params.seasonType === 'all' ? params.seasonType : 'regular'}
    />
  );
}
