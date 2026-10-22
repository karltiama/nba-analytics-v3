import { notFound } from 'next/navigation';
import { PregameMatchupView } from '@/components/scoreboard/PregameMatchupView';
import { isScoreboardGameId, parseSlateDate } from '@/lib/pregame-matchup/href';
import { loadPregameMatchup } from '@/lib/pregame-matchup/load';

export const dynamic = 'force-dynamic';

export default async function ScoreboardMatchupPage({
  params,
  searchParams,
}: {
  params: Promise<{ gameId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { gameId } = await params;
  const query = await searchParams;
  const rawDate = Array.isArray(query.date) ? query.date[0] : query.date;
  const slateDate = parseSlateDate(rawDate);
  if (!isScoreboardGameId(gameId)) notFound();
  const model = await loadPregameMatchup({ gameId, slateDate });
  if (!model) notFound();
  return <PregameMatchupView model={model} />;
}
