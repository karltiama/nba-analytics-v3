import { GameDetailsPageClient } from './GameDetailsPageClient';
import { loadResearchOverview } from '@/lib/pregame-matchup/from-analytics-game';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

async function researchSessionPresent(): Promise<boolean> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    return !error && Boolean(data.user?.id);
  } catch (error: unknown) {
    console.error('[research-overview] session check failed', {
      error: error instanceof Error ? error.name : 'unknown',
    });
    return false;
  }
}

export default async function BettingGamePage({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = await params;
  const signedIn = await researchSessionPresent();
  const historicalOverview = signedIn ? await loadResearchOverview({ gameId }) : null;
  return <GameDetailsPageClient gameId={gameId} historicalOverview={historicalOverview} />;
}
