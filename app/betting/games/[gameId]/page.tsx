import Link from 'next/link';
import { GameDetailsPageClient } from './GameDetailsPageClient';

export default async function BettingGamePage({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = await params;
  return <GameDetailsPageClient gameId={gameId} />;
}
