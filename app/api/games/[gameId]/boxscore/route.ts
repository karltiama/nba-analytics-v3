import { NextRequest, NextResponse } from 'next/server';
import { getGameBoxScoreFromAnalytics } from '@/lib/analytics/games-queries';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  try {
    const { gameId } = await params;

    const data = await getGameBoxScoreFromAnalytics(gameId);
    if (!data) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    const { game, boxscore } = data;
    return NextResponse.json({ game, boxscore });
  } catch (error: any) {
    console.error('Error fetching box score:', error);
    return NextResponse.json(
      { error: 'Failed to fetch box score', message: error.message },
      { status: 500 }
    );
  }
}

