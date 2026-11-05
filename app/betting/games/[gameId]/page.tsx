import { notFound, redirect } from 'next/navigation';
import { isScoreboardGameId, scoreboardMatchupHref } from '@/lib/pregame-matchup/href';
import { oneGamePageRedirect } from '@/lib/pregame-matchup/load';

export const dynamic = 'force-dynamic';

/**
 * Old game URL. Every game has one page, /scoreboard/games/{id}: scoreboard games keep their slate date,
 * past-season Finals come from analytics.games. A failed lookup still sends the id there, where an unknown
 * game is a 404.
 */
export default async function BettingGamePage({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  if (!isScoreboardGameId(gameId)) notFound();
  redirect((await oneGamePageRedirect(gameId)) ?? scoreboardMatchupHref(gameId));
}
