import { redirect } from 'next/navigation';
import { gameDetailHref } from '@/lib/betting/research-journey';

/** Legacy `/games/:id` → canonical betting matchup. */
export default async function LegacyGamePage({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = await params;
  redirect(gameDetailHref(gameId));
}
