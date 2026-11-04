import { NextRequest, NextResponse } from 'next/server';
import { requireBettingAuth } from '@/lib/auth/require-betting-auth';
import { resolveAnalyticsPlayerId } from '@/lib/players/analytics-queries';
import { loadTeammatesOut } from '@/lib/betting/teammates-out';

/**
 * GET /api/betting/players/[playerId]/teammates-out?gameId=...
 * Regular teammates listed out for this game, with the player's with/without split.
 * Auth required (private betting API).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ playerId: string }> }) {
  const gate = await requireBettingAuth(request);
  if (!gate.ok) return gate.response;

  const { playerId } = await params;
  const gameId = request.nextUrl.searchParams.get('gameId')?.trim() ?? '';
  if (!playerId?.trim() || !/^\d+$/.test(gameId)) {
    return NextResponse.json({ error: 'playerId and a numeric gameId are required' }, { status: 400 });
  }
  try {
    const resolved = await resolveAnalyticsPlayerId(playerId.trim());
    if (!resolved) return NextResponse.json({ error: 'Player not found' }, { status: 404 });
    return NextResponse.json(await loadTeammatesOut({ playerId: resolved, gameId }));
  } catch (error) {
    console.error('teammates-out:', error);
    return NextResponse.json({ error: 'Failed to load teammates out' }, { status: 500 });
  }
}
